/**
 * Linux.do 的三段式圆标（黑 / 白 / 橙）。
 *
 * 从 `pages/auth/auth-scene.tsx` 搬出来：登录页变成弹窗后，这个图标同时被登录、注册两个
 * 表单模块引用，继续留在 AuthScene 里会让「表单 → 整页外壳」形成一条没必要的依赖。
 */
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
