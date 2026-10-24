import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useReducedMotion } from "motion/react";

import { LoginForm } from "@/components/auth/login-form";
import { RegisterForm } from "@/components/auth/register-form";
import ForgotPasswordPage from "@/pages/auth/forgot-password";
import { AppModal } from "@/components/ui/product/app-modal";
import { isProtectedWorkspacePath } from "@/lib/guest-workspace";
import { openWorkspaceAuth, safeAuthNext, WORKSPACE_AUTH_OPEN_EVENT, type WorkspaceAuthMode, type WorkspaceAuthOpenDetail } from "@/lib/workspace-auth";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { useUserStore } from "@/stores/use-user-store";

import "./workspace-auth-modal.css";

type AuthState = { open: boolean; mode: WorkspaceAuthMode; next: string | null };
type CarouselSlide = { id: string; kind: "image" | "video"; url: string; posterUrl: string; title: string; subtitle: string };

const CLOSED: AuthState = { open: false, mode: "login", next: null };
const AUTH_RETURN_KEY = "workspace-auth:return";
/** `/login`、`/register`、`/forgot-password` 现在只是「把弹窗顶起来」的深链，不再是可以停留的页面。 */
const AUTH_ROUTES = new Set(["/login", "/register", "/forgot-password"]);

/** 深链地址 → 弹窗里的表单。 */
function modeOfPathname(pathname: string): WorkspaceAuthMode {
    if (pathname === "/register") return "register";
    if (pathname === "/forgot-password") return "recovery";
    return "login";
}

function modeOfDetail(mode: WorkspaceAuthMode | undefined): WorkspaceAuthMode {
    return mode === "register" || mode === "recovery" ? mode : "login";
}
/** 自动切换间隔：与首页画廊一致，太快会让人来不及读标题。 */
const SLIDE_INTERVAL_MS = 6000;

function readReturnTarget() {
    try {
        return window.sessionStorage.getItem(AUTH_RETURN_KEY) || "/";
    } catch {
        return "/";
    }
}

/**
 * 弹窗左侧要放什么：优先用后台配置的轮播；一条都没配就退到内置登录影片，
 * 这样新装实例也不至于左侧一片空白。
 */
function carouselSlides(carousel: CarouselSlide[] | undefined, fallbackVideo: string, fallbackPoster: string): CarouselSlide[] {
    if (carousel && carousel.length) return carousel;
    if (fallbackVideo) {
        return [{ id: "builtin-video", kind: "video", url: fallbackVideo, posterUrl: fallbackPoster, title: "", subtitle: "" }];
    }
    if (fallbackPoster) {
        return [{ id: "builtin-poster", kind: "image", url: fallbackPoster, posterUrl: "", title: "", subtitle: "" }];
    }
    return [];
}

/**
 * 登录弹窗宿主，挂在工作台外壳（`AppWorkspaceShell`）。职责与 `WorkspaceSettingsHost` 对齐：
 *
 * 1. 监听 `openWorkspaceAuth()` —— 顶栏「登录」、创作页登录门、命令面板等入口用事件打开弹窗，
 *    入口自己不需要持有弹窗开关状态。
 * 2. 拦截 `/login` 与 `/register` 路由 —— `RequireAuth` 的跳转、`/forgot-password` 的
 *    「返回登录」、外部深链仍然走 URL，这里接住它、开弹窗，再把地址替换回**打开前那一页**，
 *    于是登录从「一个单独的页面」变成「盖在当前内容上的浮层」。
 */
export function WorkspaceAuthHost() {
    const { pathname, search } = useLocation();
    const navigate = useNavigate();
    const user = useUserStore((state) => state.user);
    const hydrated = useUserStore((state) => state.hydrated);
    const [state, setState] = useState<AuthState>(CLOSED);
    // 回跳目标同时记在 sessionStorage：直接访问 /login 或整页刷新时 ref 会归零，
    // 落回首页比落回用户原本那一页糟得多。
    const returnToRef = useRef<string>(readReturnTarget());

    useEffect(() => {
        if (AUTH_ROUTES.has(pathname)) return;
        const target = `${pathname}${search}`;
        returnToRef.current = target;
        try {
            window.sessionStorage.setItem(AUTH_RETURN_KEY, target);
        } catch {
            // 隐私模式/禁用 storage 时忽略：ref 仍然有效，只是刷新后回落到首页。
        }
    }, [pathname, search]);

    useEffect(() => {
        const handleOpen = (raw: Event) => {
            const detail = (raw as CustomEvent<WorkspaceAuthOpenDetail>).detail || {};
            setState({
                open: true,
                mode: modeOfDetail(detail.mode),
                next: safeAuthNext(detail.next ?? null),
            });
        };
        window.addEventListener(WORKSPACE_AUTH_OPEN_EVENT, handleOpen);
        return () => window.removeEventListener(WORKSPACE_AUTH_OPEN_EVENT, handleOpen);
    }, []);

    /**
     * 点向「要登录才能看的页面」的链接，在**导航发生前**截住。
     *
     * 不拦的话链路是这样的：`pushState /skills` → `RequireAuth` 拦下 → `replaceState
     * /login?next=%2Fskills` → 本宿主接住地址 → `replaceState /`。实测 32ms 内 5 次 history
     * 变更，`UserLayout` 整棵（含侧栏）卸载重建，主内容有 2 帧是空的——这就是用户说的「闪烁」。
     *
     * 拦下来之后一步导航都不发生：弹窗直接盖在当前页上，登录成功后按 `next` 去原本要去的页面。
     * capture 阶段挂在 document 上：要比 React 的事件委托（挂在根容器）更早，
     * 这样 `preventDefault()` 能让 react-router 的 `<Link>` 处理器直接放弃导航。
     */
    useEffect(() => {
        const handleClick = (event: MouseEvent) => {
            // 中键 / Ctrl+点击 / 右键一律放行：那些是「在新标签页打开」的语义。
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            const anchor = (event.target as Element | null)?.closest?.("a[href]");
            if (!(anchor instanceof HTMLAnchorElement)) return;
            if (anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
            const url = new URL(anchor.href, window.location.href);
            if (url.origin !== window.location.origin) return;
            if (!isProtectedWorkspacePath(url.pathname)) return;
            const { hydrated, user } = useUserStore.getState();
            // 还没水合完就交给 RequireAuth 决定（它会先显示 loading），已登录则照常放行。
            if (!hydrated || user) return;
            event.preventDefault();
            openWorkspaceAuth({ next: `${url.pathname}${url.search}${url.hash}` });
        };
        document.addEventListener("click", handleClick, true);
        return () => document.removeEventListener("click", handleClick, true);
    }, []);

    useEffect(() => {
        if (!AUTH_ROUTES.has(pathname)) return;
        const params = new URLSearchParams(search);
        setState({
            open: true,
            mode: modeOfPathname(pathname),
            next: safeAuthNext(params.get("next")),
        });
        // 深链落地（直接访问 `/login` 等）：URL 必须换回一个能正常渲染的页面，否则关掉弹窗
        // 就只剩空壳。统一换回首页，不走 `returnToRef`——那个目标可能需要登录，换回去会被
        // `RequireAuth` 立刻弹回 `/login`，与本行凑成来回跳转的死循环（页面会卡死）。
        // 登录成功后照样按 `next` / 打开弹窗前那一页跳，这里只决定「背景页」。
        navigate("/", { replace: true });
    }, [navigate, pathname, search]);

    // `next` 优先；没带就回到打开弹窗时所在的那一页。
    const next = state.next ?? returnToRef.current;

    const finish = useCallback(() => {
        setState(CLOSED);
        navigate(next, { replace: true });
    }, [navigate, next]);

    const close = useCallback(() => setState(CLOSED), []);

    // 已经登录就不该再看登录表单：Linux.do 回调返回、或另一个标签页登录完成后都会命中。
    useEffect(() => {
        if (!state.open || !hydrated || !user) return;
        finish();
    }, [state.open, hydrated, user, finish]);

    return <WorkspaceAuthModal open={state.open} mode={state.mode} next={next} onModeChange={(mode) => setState((current) => ({ ...current, mode }))} onClose={close} onSuccess={finish} />;
}

export function WorkspaceAuthModal({ open, mode, next, onModeChange, onClose, onSuccess }: { open: boolean; mode: WorkspaceAuthMode; next: string; onModeChange: (mode: WorkspaceAuthMode) => void; onClose: () => void; onSuccess: () => void }) {
    const appearance = useAppearanceStore((state) => state.appearance);
    // 顶栏标题用后台「站点及外观」里的项目名，与浏览器标题、侧栏品牌保持同一来源。
    const brandName = appearance.brandName || "平台";

    return (
        <AppModal
            flush
            open={open}
            title={null}
            footer={null}
            // 外壳自带关闭按钮，关掉 AntD 默认那颗，否则两颗 X 会叠在一起。
            closable={false}
            centered
            // 参考图是左右等分的横版卡片（约 1.5:1）。高度固定，不跟表单内容走：
            // 登录 / 注册 / 找回密码三张表单高度差很多，跟着内容走弹窗会一跳一跳的。
            // 宽度与高度都按「注册表单不用滚就能一次看全」定的，见 workspace-auth-modal.css。
            width="min(1120px, calc(100vw - 32px))"
            rootClassName="workspace-auth-modal"
            onCancel={onClose}
        >
            <div className="workspace-auth-frame">
                {/* 关闭按钮放在最前面：AntD 打开弹窗时会把焦点给第一个可聚焦元素，
                    若让轮播指示条先拿到焦点，`onFocusCapture` 会立刻把自动播放停掉
                    （实测就是「轮播永远停在第一张」）。它本身是绝对定位，DOM 顺序不影响观感。 */}
                <button type="button" className="workspace-auth-close" onClick={onClose} aria-label="关闭登录">
                    <X aria-hidden="true" />
                </button>

                <AuthCarousel slides={carouselSlides(appearance.authCarousel, appearance.authVideoUrl, appearance.authVideoPosterUrl)} />

                <section className="workspace-auth-pane" aria-label={mode === "register" ? "注册" : mode === "recovery" ? "找回密码" : "登录"}>
                    <div className="workspace-auth-scroll">
                        {/* 顶栏：左项目标题、右登录/注册切换。放同一行是为了不吃高度——
                            表单最挤时（双通道验证 + Linux.do + 协议）滚动区只剩个位数余量，
                            标题单独占一行会把提交按钮顶到折线以下。 */}
                        <div className="workspace-auth-head">
                            <h2 className="workspace-auth-title" title={brandName}>
                                {brandName}
                            </h2>
                            {mode === "recovery" ? (
                                <div className="workspace-auth-tabs" role="tablist" aria-label="找回密码">
                                    <button type="button" role="tab" aria-selected onClick={() => onModeChange("login")}>
                                        ← 返回登录
                                    </button>
                                </div>
                            ) : (
                                <div className="workspace-auth-tabs" role="tablist" aria-label="登录或注册">
                                    <button type="button" role="tab" aria-selected={mode === "login"} onClick={() => onModeChange("login")}>
                                        登录
                                    </button>
                                    <button type="button" role="tab" aria-selected={mode === "register"} onClick={() => onModeChange("register")}>
                                        注册
                                    </button>
                                </div>
                            )}
                        </div>
                        {/* 复用 `.auth-scene-card`：输入框高度、圆角、主按钮这些控件规则都挂在它下面，
                            弹窗与登录页因此共用同一套样式，不必再维护第二份。 */}
                        <div className="auth-scene-card">
                            {mode === "login" ? (
                                <LoginForm next={next} onSuccess={onSuccess} />
                            ) : mode === "recovery" ? (
                                // 重置成功后就地切回登录表单，不再跳 `/login?next=…`：
                                // 找回密码整条链路都留在弹窗里，不换页面。
                                <ForgotPasswordPage next={next} onCompleted={() => onModeChange("login")} />
                            ) : (
                                <RegisterForm next={next} onSuccess={onSuccess} />
                            )}
                        </div>
                    </div>
                </section>
            </div>
        </AppModal>
    );
}

/**
 * 左侧轮播：图片与视频混排，自动切换、悬停暂停。
 * 视频一律静音循环播放——登录页不该突然发出声音；开了「减少动效」就只停在封面。
 */
function AuthCarousel({ slides }: { slides: CarouselSlide[] }) {
    const [active, setActive] = useState(0);
    const [paused, setPaused] = useState(false);
    const reducedMotion = useReducedMotion();
    const count = slides.length;

    useEffect(() => {
        if (count < 2 || paused || reducedMotion) return;
        const timer = window.setInterval(() => setActive((current) => (current + 1) % count), SLIDE_INTERVAL_MS);
        return () => window.clearInterval(timer);
    }, [count, paused, reducedMotion]);

    // 条目变少（后台改了配置）时把越界的下标收回来。
    useEffect(() => {
        if (active >= count) setActive(0);
    }, [active, count]);

    if (!count) return <div className="workspace-auth-media is-empty" aria-hidden="true" />;

    const current = slides[Math.min(active, count - 1)];

    return (
        <div className="workspace-auth-media" onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)} onBlurCapture={() => setPaused(false)}>
            {slides.map((slide, index) => {
                const isActive = index === active;
                return (
                    <div key={slide.id || index} className={`workspace-auth-slide ${isActive ? "is-active" : ""}`} aria-hidden={!isActive}>
                        {slide.kind === "video" ? (
                            // 只有当前这一张挂 video：否则 N 段视频同时解码，首屏直接卡住。
                            isActive ? (
                                <video className="workspace-auth-slide-media" src={slide.url} poster={slide.posterUrl || undefined} autoPlay={!reducedMotion} muted loop playsInline preload="metadata" />
                            ) : slide.posterUrl ? (
                                <img className="workspace-auth-slide-media" src={slide.posterUrl} alt="" decoding="async" />
                            ) : null
                        ) : (
                            <img className="workspace-auth-slide-media" src={slide.url} alt="" decoding="async" />
                        )}
                    </div>
                );
            })}

            <div className="workspace-auth-media-scrim" aria-hidden="true" />

            {current.title || current.subtitle ? (
                <div className="workspace-auth-media-caption">
                    {current.title ? <strong>{current.title}</strong> : null}
                    {current.subtitle ? <span>{current.subtitle}</span> : null}
                </div>
            ) : null}

            {count > 1 ? (
                <div className="workspace-auth-media-bars" role="tablist" aria-label="登录页轮播">
                    {slides.map((slide, index) => (
                        <button
                            key={slide.id || index}
                            type="button"
                            role="tab"
                            aria-selected={index === active}
                            aria-label={slide.title || `第 ${index + 1} 张`}
                            className={`workspace-auth-media-bar ${index === active ? "is-active" : ""}`}
                            onClick={() => setActive(index)}
                        />
                    ))}
                </div>
            ) : null}
        </div>
    );
}
