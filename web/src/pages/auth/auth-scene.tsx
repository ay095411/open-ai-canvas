import { motion, useReducedMotion } from "motion/react";
import { Tabs } from "antd";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";

import { SiteComplianceFooter } from "@/components/layout/site-compliance-footer";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { useAppearanceStore } from "@/stores/use-appearance-store";

const AUTH_TABS = [
    { key: "login", label: "登录" },
    { key: "register", label: "注册" },
];

const authCopy = {
    login: { title: "登录" },
    register: { title: "注册" },
    recovery: { title: "重新设置密码" },
} as const;

export function LinuxDOIcon() {
    return (
        <span
            aria-hidden
            className="size-5 shrink-0 rounded-full"
            style={{
                background: "linear-gradient(to bottom, #1d1d1f 0 33.333%, #efefef 33.333% 66.666%, #feb005 66.666% 100%)",
                boxShadow: "0 0 0 1px rgba(255,255,255,.14)",
            }}
        />
    );
}

export function AuthScene() {
    const appearance = useAppearanceStore((state) => state.appearance);
    const location = useLocation();
    const navigate = useNavigate();
    const reducedMotion = useReducedMotion();
    const [failedPosterURL, setFailedPosterURL] = useState("");
    const recovery = location.pathname === "/forgot-password";
    const activeTab = location.pathname === "/register" ? "register" : "login";
    const copy = recovery ? authCopy.recovery : activeTab === "register" ? authCopy.register : authCopy.login;
    // 只保留静音自动播放：原先那颗「播放品牌影片 / 创作正在发生」按钮和自动播放表达的是
    // 同一件事，却让这一屏多出一个控件和一个状态。关掉自动播放或用户偏好减少动效时，
    // 退到静态首帧（poster）。
    const videoActive = Boolean(appearance.authVideoUrl && appearance.authVideoAutoplay && !reducedMotion);

    return (
        <main className="auth-scene h-dvh min-h-0 overflow-y-auto lg:overflow-hidden">
            <div className="grid min-h-full lg:h-full lg:grid-cols-[minmax(0,1fr)_minmax(640px,720px)]">
                <section className="auth-scene-hero relative min-h-[200px] overflow-hidden sm:min-h-[260px] lg:min-h-0" aria-label={`${appearance.brandName}品牌影片`}>
                    {videoActive && appearance.authVideoUrl ? <video className="absolute inset-0 size-full object-cover" src={appearance.authVideoUrl} poster={appearance.authVideoPosterUrl || undefined} autoPlay muted loop playsInline preload="metadata" /> : appearance.authVideoPosterUrl && failedPosterURL !== appearance.authVideoPosterUrl ? <img className="absolute inset-0 size-full object-cover" src={appearance.authVideoPosterUrl} alt="" decoding="async" onError={() => setFailedPosterURL(appearance.authVideoPosterUrl)} /> : null}
                </section>

                {/* min-h-[660px] 之类的固定高度是为了让登录/注册切换时卡片不跳动，
                    代价是登录态下方留一大片空白——简化后内容本来就少，直接让卡片按内容高度走。
                    items-center 来自上游「修复缩放时版权栏遮挡表单」：卡片在剩余空间里居中，
                    底部版权栏（shrink-0）不再与卡片重叠。内边距仍由内层 motion.div 承担。 */}
                <section className="auth-scene-form-pane relative flex min-h-[660px] flex-col items-center overflow-y-auto">
                    <Link to="/" className="auth-scene-return absolute right-5 top-5 z-20 inline-flex h-9 items-center gap-2 rounded-full px-4 text-xs backdrop-blur-xl transition lg:right-8 lg:top-8">
                        <ArrowLeft className="size-3.5" />
                        返回首页
                    </Link>

                    <motion.div
                        initial={reducedMotion ? false : { opacity: 0, y: 14 }}
                        animate={{ opacity: 1, y: 0 }}
                        layout={!reducedMotion}
                        transition={{ duration: aceternityMotion.duration.panel, ease: aceternityMotion.easing.enter }}
                        className="flex flex-1 shrink-0 items-center justify-center px-4 pb-8 pt-20 sm:px-8 lg:px-10"
                    >
                        {/* rounded-2xl（16px）：控件统一 12px（--r-lg），卡片要比控件更圆一档，
                            否则圆角层级会倒过来。
                            backdrop-blur 跟着底色一起去掉了：没有底色可透，留着只是白付一次
                            合成开销。 */}
                        <div className="auth-scene-card my-auto h-auto w-full max-w-[600px] overflow-hidden rounded-2xl">
                            <div className="px-6 pt-6 text-center sm:px-8 sm:pt-7">
                                <Link to="/" className="auth-scene-brand inline-flex max-w-full flex-col items-center justify-center gap-2 transition-opacity hover:opacity-80" aria-label="Navo AI首页">
                                    <img src="/auth/navo-ai-icon.png" alt="" width={664} height={467} className="auth-scene-brand-logo" />
                                    <h1 className="text-2xl font-semibold leading-tight tracking-tight">Navo AI</h1>
                                </Link>
                                <p className="auth-scene-muted mt-4 text-sm leading-6 lg:whitespace-nowrap">
                                    为创作者而生，为创意而造。你的创意伙伴，越用越懂你
                                </p>
                            </div>
                            <section aria-label={copy.title} className="flex flex-col">
                                {/* 卡片标题与标签栏写的是同一个词（登录 / 注册），标题下面 40px
                                    再出现一次同样的字，是这一屏最扎眼的重复。标签栏本身已经回答
                                    「这一屏是什么」，所以有标签栏时标题降级成仅供读屏的隐藏标题
                                    （保留语义与 aria 结构、保留页面标题），只有不带标签栏的
                                    找回密码页才把标题显示出来。 */}
                                <header className={`px-6 pt-6 sm:px-8 sm:pt-7 ${recovery ? "pb-3" : "sr-only"}`}>
                                    <h2 className="text-xl font-semibold">{copy.title}</h2>
                                </header>
                                {!recovery ? (
                                    <div className="px-6 pt-6 sm:px-8 sm:pt-8">
                                        <Tabs className="auth-card-tabs" activeKey={activeTab} items={AUTH_TABS} onChange={(key) => navigate({ pathname: key === "register" ? "/register" : "/login", search: location.search })} />
                                    </div>
                                ) : null}
                                <div key={location.pathname} className="px-6 py-6 sm:px-8 sm:py-8">
                                    <Outlet />
                                </div>
                            </section>
                        </div>
                    </motion.div>
                    <SiteComplianceFooter variant="auth" className="shrink-0" />
                </section>
            </div>
        </main>
    );
}
