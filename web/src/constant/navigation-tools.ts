// label 是中文源文案（用于搜索与兜底），界面显示用 labelKey 经 i18n 翻译。
import { Blocks, CircleDollarSign, Clapperboard, Images, LibraryBig, ListTodo, PanelsTopLeft, Settings, PenTool, ShoppingBag } from "lucide-react";

export const navigationTools = [
    {
        slug: "create",
        label: "创作",
        labelKey: "nav.tools.create",
        icon: PenTool,
        section: "创作空间",
    },
    {
        slug: "projects",
        label: "短剧创作",
        labelKey: "nav.tools.projects",
        icon: Clapperboard,
        section: "创作空间",
    },
    {
        slug: "canvas",
        label: "画布",
        labelKey: "nav.tools.canvas",
        icon: PanelsTopLeft,
        section: "创作空间",
    },
    {
        // 侧栏显示名是「创作影棚」，slug 仍叫 ecommerce：路由、鉴权前缀和
        // 后台「电商 Agent 配置」都以 ecommerce 为标识，改 slug 只会制造无收益的迁移。
        slug: "ecommerce",
        label: "创作影棚",
        icon: ShoppingBag,
        section: "创作空间",
    },
    {
        slug: "tasks",
        label: "任务",
        labelKey: "nav.tools.tasks",
        icon: ListTodo,
        section: "创作空间",
    },
    {
        slug: "assets",
        label: "素材",
        labelKey: "nav.tools.assets",
        icon: Images,
        section: "创作空间",
    },
    {
        slug: "skills",
        label: "技能库",
        labelKey: "nav.tools.skills",
        icon: LibraryBig,
        section: "工作台管理",
    },
    {
        slug: "plugins",
        label: "插件中心",
        labelKey: "nav.tools.plugins",
        icon: Blocks,
        section: "工作台管理",
    },
    {
        slug: "wallet",
        label: "积分中心",
        labelKey: "nav.tools.wallet",
        icon: CircleDollarSign,
        section: "工作台管理",
    },
    {
        slug: "settings",
        label: "设置",
        labelKey: "nav.tools.settings",
        icon: Settings,
        section: "工作台管理",
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
