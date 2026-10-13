import { Infinity as InfinityIcon, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { LoginForm } from "@/components/auth/login-form";
import { RegisterForm } from "@/components/auth/register-form";
import { BrandLogoFrame } from "@/components/brand/brand-logo";
import { SiteComplianceFooter } from "@/components/layout/site-compliance-footer";
import { AppModal } from "@/components/ui/product/app-modal";
import { openWorkspaceAuth, safeAuthNext, WORKSPACE_AUTH_OPEN_EVENT, type WorkspaceAuthMode, type WorkspaceAuthOpenDetail } from "@/lib/workspace-auth";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { useUserStore } from "@/stores/use-user-store";

type AuthState = { open: boolean; mode: WorkspaceAuthMode; next: string | null };

const CLOSED: AuthState = { open: false, mode: "login", next: null };
const AUTH_RETURN_KEY = "workspace-auth:return";
/** `/login`、`/register` 现在只是「把弹窗顶起来」的深链，不再是可以停留的页面。 */
const AUTH_ROUTES = new Set(["/login", "/register"]);

function readReturnTarget() {
    try {
        return window.sessionStorage.getItem(AUTH_RETURN_KEY) || "/";
    } catch {
        return "/";
    }
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
                mode: detail.mode === "register" ? "register" : "login",
                next: safeAuthNext(detail.next ?? null),
            });
        };
        window.addEventListener(WORKSPACE_AUTH_OPEN_EVENT, handleOpen);
        return () => window.removeEventListener(WORKSPACE_AUTH_OPEN_EVENT, handleOpen);
    }, []);

    useEffect(() => {
        if (!AUTH_ROUTES.has(pathname)) return;
        const params = new URLSearchParams(search);
        setState({
            open: true,
            mode: pathname === "/register" ? "register" : "login",
            next: safeAuthNext(params.get("next")),
        });
        navigate(returnToRef.current, { replace: true });
    }, [navigate, pathname, search]);

    // `next` 优先；没带就回到打开弹窗时所在的那一页。
    const next = state.next ?? returnToRef.current;

    const finish = useCallback(() => {
        setState(CLOSED);
        navigate(next, { replace: true });
    }, [navigate, next]);

    const close = useCallback(() => setState(CLOSED), []);

    // 已经登录就不该再看登录表单：Linux.do 回调返回、或另一个标签页登录完成后都会命中。
    // 此时直接按 `finish` 的语义把人送到目标页，与旧登录页「已登录就跳走」的行为一致。
    useEffect(() => {
        if (!state.open || !hydrated || !user) return;
        finish();
    }, [state.open, hydrated, user, finish]);

    return (
        <WorkspaceAuthModal
            open={state.open}
            mode={state.mode}
            next={next}
            onModeChange={(mode) => setState((current) => ({ ...current, mode }))}
            onClose={close}
            onSuccess={finish}
        />
    );
}

export function WorkspaceAuthModal({
    open,
    mode,
    next,
    onModeChange,
    onClose,
    onSuccess,
}: {
    open: boolean;
    mode: WorkspaceAuthMode;
    next: string;
    onModeChange: (mode: WorkspaceAuthMode) => void;
    onClose: () => void;
    onSuccess: () => void;
}) {
    const brandName = useAppearanceStore((state) => state.appearance.brandName) || "Navo AI";
    const posterUrl = useAppearanceStore((state) => state.appearance.authVideoPosterUrl);

    return (
        <AppModal
            flush
            open={open}
            title={null}
            footer={null}
            // 外壳自带关闭按钮（与标签栏同一行），关掉 AntD 默认那颗，否则两颗 X 会叠在一起。
            closable={false}
            centered
            // 宽度与积分中心 / 账户与设置弹窗完全一致；高度矮一档（那两处是 min(90vh,900px)，
            // 这里 min(86vh,780px)）—— 登录只有一张约 208px 的表单，同高会把它悬在一片空里。
            // 改尺寸要同步改 chrome：globals.css 里 .workspace-auth-modal / .workspace-auth-frame
            // 的 max-height、height，以及另一个 .tsx 的 width。
            width="min(1320px, calc(100vw - 32px))"
            rootClassName="workspace-auth-modal"
            onCancel={onClose}
        >
            <div className="workspace-auth-frame">
                {/* 左侧品牌舞台：弹窗在这一侧承接原登录页的「灵感放映厅」，
                    窄屏直接不渲染——小屏上没有第二列的空间，硬塞只会把表单挤扁。 */}
                <aside className="workspace-auth-brand" aria-label={`${brandName}品牌介绍`}>
                    {posterUrl ? <div className="workspace-auth-brand-poster" style={{ backgroundImage: `url("${posterUrl}")` }} aria-hidden /> : null}
                    <div className="workspace-auth-brand-glow" aria-hidden />
                    <div className="workspace-auth-brand-body">
                        <span className="workspace-auth-brand-mark">
                            <BrandLogoFrame className="grid size-9 shrink-0 place-items-center rounded-[var(--r-md)]" logoClassName="size-5 object-contain" alt="" fallback={<InfinityIcon className="size-5" strokeWidth={2.2} />} />
                            <span className="workspace-auth-brand-wordmark">{brandName}</span>
                        </span>
                        <h2>进入创作者中心</h2>
                        <p>登录即送新用户创作额度，立即执导第一部 AI 短剧。</p>
                    </div>
                    <SiteComplianceFooter variant="auth" className="workspace-auth-brand-foot" />
                </aside>

                <section className="workspace-auth-pane" aria-label={mode === "register" ? "注册" : "登录"}>
                    <header className="workspace-auth-pane-head">
                        <div className="workspace-auth-tabs" role="tablist" aria-label="登录或注册">
                            <button type="button" role="tab" aria-selected={mode === "login"} onClick={() => onModeChange("login")}>
                                登录
                            </button>
                            <button type="button" role="tab" aria-selected={mode === "register"} onClick={() => onModeChange("register")}>
                                注册
                            </button>
                        </div>
                        <button type="button" className="workspace-auth-close" onClick={onClose} aria-label="关闭登录">
                            <X className="size-4" strokeWidth={2} aria-hidden />
                        </button>
                    </header>

                    <div className="workspace-auth-scroll">
                        {/* 复用 `.auth-scene-card`：输入框高度、圆角、白底黑字主按钮、
                            验证码那一行的样式都挂在它下面，弹窗与整页因此共用同一套控件规则。
                            （弹窗是恒深色表面，token 由 .workspace-auth-modal 重新给一份。） */}
                        <div className="auth-scene-card">
                            {mode === "login" ? <LoginForm next={next} onSuccess={onSuccess} onClose={onClose} /> : <RegisterForm next={next} onSuccess={onSuccess} />}
                        </div>
                    </div>
                </section>
            </div>
        </AppModal>
    );
}
