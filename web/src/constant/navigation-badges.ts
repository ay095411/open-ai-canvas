/**
 * 侧栏菜单角标配置。
 *
 * 角标是「模块状态」的注释，不是装饰：只挂在确实需要提示的入口上，按 nav id 配置，
 * 上下线一个角标只改这里（`workspace-sidebar-nav.tsx` 的 buildNav 会自动挂载）。
 *
 * tone 决定视觉语义：
 * - `new`  ：新上线（暖金渐变，与积分金币同一色系）
 * - `hot`  ：高频/主推（玫红渐变）
 * - `beta` ：试用中（无底色描边，视觉最轻，不抢主线）
 * - `count`：数量（数字胶囊，用于历史/待处理这类可计数入口）
 */
export type NavBadgeTone = "new" | "hot" | "beta" | "count";

export type WorkspaceNavBadge = {
    /** 胶囊里的文字，建议全大写且不超过 5 个字符，收起侧栏时只留一个色点。 */
    label: string;
    tone: NavBadgeTone;
    /** hover 提示，说明这个角标为什么在这；收起侧栏时并进菜单项的 title。 */
    title?: string;
};

export const navigationBadges: Record<string, WorkspaceNavBadge> = {
    toolbox: { label: "NEW", tone: "new", title: "创作影棚 · 新上线" },
    projects: { label: "HOT", tone: "hot", title: "短剧 Agent · 主推" },
    canvas: { label: "BETA", tone: "beta", title: "自由画布 · 试用中" },
    plugins: { label: "NEW", tone: "new", title: "插件中心 · 新上线" },
};
