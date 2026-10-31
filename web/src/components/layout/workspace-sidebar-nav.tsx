import { Popover } from "antd";
import { ArrowUpRight, Bell, ChevronDown, ChevronRight, Infinity as InfinityIcon, PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import { LayoutGroup, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";

import { BrandLogoFrame } from "@/components/brand/brand-logo";
import { CoalAvatar } from "@/components/brand/coal-avatar";
import { UserAvatar } from "@/components/layout/user-avatar";
import { UserGroupAvatarRing } from "@/components/layout/user-group-badge";
import { Kbd } from "@/components/ui/base/kbd";
import { navigationBadges, type WorkspaceNavBadge } from "@/constant/navigation-badges";
import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { useWorkspaceLogout } from "@/hooks/use-workspace-logout";
import { SystemAnnouncementCenter } from "@/components/layout/system-announcement-center";
import { cn } from "@/lib/utils";
import { interceptAuthLink } from "@/lib/workspace-auth";
import { preloadWorkspaceRoute } from "@/lib/workspace-route-modules";
import { useUserStore, type FeatureAvailability } from "@/stores/use-user-store";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { WorkspaceAccountCard } from "./workspace-account-card";
import { WorkspaceSidebarCheckin } from "./workspace-sidebar-checkin";
import { openWorkspaceWallet } from "@/lib/workspace-wallet";
import { AssetsNavIcon, CanvasNavIcon, CreateNavIcon, HistoryNavIcon, PluginsNavIcon, ProjectNavIcon, SkillsNavIcon, ToolboxNavIcon } from "./workspace-sidebar-icons";

export type WorkspaceNavItem = {
    id: string;
    title: string;
    icon?: ComponentType<{ className?: string; strokeWidth?: number }>;
    to?: string;
    shortcut?: string;
    badge?: WorkspaceNavBadge;
    action?: "search" | "logout";
    children?: WorkspaceNavItem[];
};

type WorkspaceNavGroup = {
    heading?: string;
    items: WorkspaceNavItem[];
};

const sidebarIcons: Partial<Record<NavigationToolSlug, WorkspaceNavItem["icon"]>> = {
    create: CreateNavIcon,
    projects: ProjectNavIcon,
    canvas: CanvasNavIcon,
    assets: AssetsNavIcon,
    skills: SkillsNavIcon,
    plugins: PluginsNavIcon,
    tasks: HistoryNavIcon,
};

function toolItem(slug: NavigationToolSlug, to: string): WorkspaceNavItem {
    const tool = navigationTools.find((item) => item.slug === slug);
    return { id: slug, title: tool?.label ?? slug, icon: sidebarIcons[slug] ?? tool?.icon, to };
}

function buildNav(features: FeatureAvailability): { groups: WorkspaceNavGroup[]; footer: WorkspaceNavItem[] } {
    const toolboxTo = features.imageWorkbenchEnabled ? "/toolbox/image" : features.videoWorkbenchEnabled ? "/toolbox/video" : "";
    const groups: WorkspaceNavGroup[] = [
        {
            items: [
                { ...toolItem("create", "/"), id: "home", title: "创作" },
                ...(toolboxTo ? [{ id: "toolbox", title: "创作影棚", icon: ToolboxNavIcon, to: toolboxTo }] : []),
                { ...toolItem("canvas", "/canvas"), title: "自由画布" },
                { ...toolItem("projects", "/projects"), title: "短剧 Agent" },
                ...(features.videoRemakeEnabled ? [toolItem("remakes", "/remakes")] : []),
            ],
        },
        {
            heading: "资源与工具",
            items: [
                { ...toolItem("assets", "/assets"), title: "资产" },
                ...(features.taskCenterEnabled ? [{ ...toolItem("tasks", "/tasks"), title: "创作历史" }] : []),
                { ...toolItem("skills", "/skills"), title: "Skills" },
                ...(features.pluginCenterEnabled ? [{ ...toolItem("plugins", "/plugins"), title: "插件" }] : []),
            ],
        },
    ];

    // 管理、设置和退出登录不再占据参考站式侧栏底部，而是通过用户卡片菜单进入。
    // 路由和写操作仍保留，避免把用户端导航变成无法访问的装饰。
    // 角标按 id 从 constant/navigation-badges.ts 挂载，导航结构里不写死文案与配色。
    for (const group of groups) {
        group.items = group.items.map((item) => (navigationBadges[item.id] ? { ...item, badge: navigationBadges[item.id] } : item));
    }
    return { groups, footer: [] };
}

function WorkspaceSidebarProfile({ collapsed, user }: { collapsed: boolean; user: NonNullable<ReturnType<typeof useUserStore.getState>["user"]> | null }) {
    const [menuOpen, setMenuOpen] = useState(false);
    const profileName = user?.displayName || user?.username || "未登录";

    if (!user) {
        // 游客态：登录入口 + 公告铃铛（公告列表对游客公开，查看不标记已读）。
        return (
            <div className={cn("app-workspace-sidebar-profile-row", collapsed && "is-collapsed")}>
                {/* 游客态的头像也用品牌角色「黑煤球」，与登录后的默认头像同一个盒子
                    （`.app-workspace-sidebar-profile-avatar`），尺寸与圆形裁切因此一致；
                    斜箭头保留「这是一次跳转」的语义（中键 / 新标签页仍走 `/login` 深链），
                    但左键点击会被拦截成就地开弹窗 —— 真跳 `/login` 会让整页卸载重建、闪一下。
                    折叠态只留头像：文字和箭头会挤爆 42px 的方框。 */}
                <Link to="/login" onClick={(event) => interceptAuthLink(event)} className={cn("app-workspace-sidebar-profile", collapsed && "is-collapsed")} aria-label="登录" title="登录">
                    <span className="app-workspace-sidebar-profile-avatar"><CoalAvatar /></span>
                    {!collapsed ? <span className="app-workspace-sidebar-profile-copy"><strong>登录</strong></span> : null}
                    {!collapsed ? <ArrowUpRight className="app-workspace-sidebar-profile-arrow" /> : null}
                </Link>
                {!collapsed ? <SystemAnnouncementCenter className="app-workspace-sidebar-notification" /> : null}
            </div>
        );
    }

    const content = <WorkspaceAccountCard onNavigate={() => setMenuOpen(false)} onWallet={() => { setMenuOpen(false); openWorkspaceWallet(); }} />;

    return (
        <div className={cn("app-workspace-sidebar-account", collapsed && "is-collapsed")}>
            <WorkspaceSidebarCheckin collapsed={collapsed} />
            <div className={cn("app-workspace-sidebar-profile-row", collapsed && "is-collapsed")}>
                <Popover open={menuOpen} onOpenChange={setMenuOpen} trigger="click" placement="topLeft" arrow={false} rootClassName="workspace-account-popover" content={content}>
                    <button type="button" className={cn("app-workspace-sidebar-profile", collapsed && "is-collapsed")} aria-label="打开账户菜单" title={profileName}>
                        <UserGroupAvatarRing><UserAvatar user={user} className="app-workspace-sidebar-profile-avatar" /></UserGroupAvatarRing>
                        {/* 侧栏常驻行只显示名字，不放副标题（邮箱 / 账号标识）——
                            账号信息在点开的账户弹窗里给，常驻行保持单行且不在侧栏泄露账号标识。
                            外层 profile-copy 不能因为只剩一个子节点就拍平：它承载 min-w-0，
                            拍平后长名字的省略号会失效。 */}
                        {!collapsed ? <span className="app-workspace-sidebar-profile-copy"><strong>{profileName}</strong></span> : null}
                    </button>
                </Popover>
                {/* autoOpen 从顶栏通知按钮继承过来：公告的「未读自动浮出」是投递行为，
                    与通知按钮挂在哪一侧无关，顶栏清空后不应静默丢掉。 */}
                {!collapsed ? <SystemAnnouncementCenter userId={user.id} className="app-workspace-sidebar-notification" autoOpen /> : <span className="app-workspace-sidebar-notification-spacer" aria-hidden />}
            </div>
        </div>
    );
}

function WorkspaceSwitcher({ collapsed, onNavigate, onExpand, onCollapse }: { collapsed: boolean; onNavigate: () => void; onExpand: () => void; onCollapse: () => void }) {
    const appearance = useAppearanceStore((state) => state.appearance);

    // 折叠态头部默认呈现品牌标记，hover / 键盘聚焦时才过渡成「展开侧栏」图标：
    // 窄轨只放一个功能符号，会让品牌在折叠后彻底消失。
    if (collapsed) {
        return (
            <div className="app-workspace-sidebar-rail-header shrink-0">
                <button type="button" className="app-workspace-sidebar-rail-button" aria-label="展开侧栏菜单" title="展开侧栏菜单" onClick={onExpand}>
                    <BrandLogoFrame className="app-workspace-brand-mark app-workspace-sidebar-rail-mark grid size-9 shrink-0 place-items-center rounded-[var(--r-sm)] shadow-sm" logoClassName="size-6 object-contain" alt="" fallback={<InfinityIcon className="size-5" strokeWidth={2.2} />} />
                    <PanelLeftOpen className="app-workspace-sidebar-rail-reveal size-4" strokeWidth={1.7} aria-hidden />
                </button>
            </div>
        );
    }

    return (
        <div className="app-workspace-sidebar-brand-row relative shrink-0 px-3 pt-3">
            <Link to="/" onClick={onNavigate} className="app-workspace-sidebar-brand-button group" aria-label={`${appearance.brandName}首页`}>
                <span className="flex min-w-0 items-center gap-2.5">
                    <BrandLogoFrame className="app-workspace-brand-mark grid size-9 shrink-0 place-items-center rounded-[10px] shadow-sm" logoClassName="size-6 object-contain" alt="" fallback={<InfinityIcon className="size-5" strokeWidth={2.2} />} />
                    {/* 只保留品牌字标。外层 flex-col 即使只剩一个子节点也保留：超长品牌名依赖该层的 min-w-0 才能触发 truncate。 */}
                    <span className="flex min-w-0 flex-col">
                        <span className="app-workspace-brand-wordmark truncate text-[16px] leading-none font-semibold">{appearance.brandName}</span>
                    </span>
                </span>
            </Link>
            <button type="button" className="app-workspace-sidebar-collapse-button" aria-label="收起侧栏" title="收起侧栏" onClick={onCollapse}>
                <PanelLeftClose className="size-4" strokeWidth={1.7} />
            </button>
        </div>
    );
}

/**
 * 折叠态窄轨里的两字标题。
 *
 * ⚠️ 「一键复刻」不能交给最后的 `title.slice(0, 2)` 兜底：截出来是「一键」，
 * 而窄轨里这一格代表的是「复刻」这条流水线，不是「一键」这种副词前缀。
 * 带独立语义的菜单统一在这里登记，没登记的才退回前两字。
 */
const COLLAPSED_NAV_TITLES: Record<string, string> = {
    home: "创作",
    projects: "短剧",
    canvas: "画布",
    remakes: "复刻",
    toolbox: "影棚",
    assets: "资产",
    skills: "Skills",
    plugins: "插件",
    tasks: "历史",
};

function collapsedNavTitle(item: WorkspaceNavItem): string {
    return COLLAPSED_NAV_TITLES[item.id] ?? item.title.slice(0, 2);
}

function NavItem({
    item,
    activeId,
    onSelect,
    onOpenSearch,
    onLogout,
    level = 0,
    collapsed = false,
}: {
    item: WorkspaceNavItem;
    activeId: string;
    onSelect: (id: string) => void;
    onOpenSearch: () => void;
    onLogout: () => void;
    level?: number;
    collapsed?: boolean;
}) {
    const isActive = activeId === item.id || (item.id === "settings" && activeId.startsWith("settings:"));
    const hasChildren = Boolean(item.children?.length);
    const [isOpen, setIsOpen] = useState(false);

    // 激活分支自动展开（如设置分区子项），保证当前位置可见。
    useEffect(() => {
        if (isActive && hasChildren) setIsOpen(true);
    }, [isActive, hasChildren]);

    const Icon = item.icon;
    const rowStyle = collapsed ? undefined : ({ paddingLeft: `${level * 12 + 10}px` } as CSSProperties);

    const collapsedTitle = collapsedNavTitle(item);
    // 收起侧栏后文字胶囊会被藏掉，只剩图标上的色点，提示语因此要并进 title，避免角标信息丢失。
    const collapsedHint = item.badge ? `${item.title} · ${item.badge.title ?? item.badge.label}` : item.title;
    const rowContent = (
        <>
            <span className="app-workspace-nav-main flex min-w-0 items-center gap-2.5">
                {Icon ? (
                    <span className="app-workspace-nav-icon" aria-hidden>
                        <Icon className="size-4 shrink-0" strokeWidth={2} />
                        {collapsed && item.badge ? <span className={cn("app-workspace-nav-badge-dot", `is-${item.badge.tone}`)} /> : null}
                    </span>
                ) : (
                    <span className="size-1.5 shrink-0 rounded-full bg-current opacity-40" aria-hidden />
                )}
                {/* 角标紧贴菜单名（而不是甩到行尾 meta 列）：它注释的是这一项是什么，
                    不是这一项有多少条数据；标题可截断，角标永远留在标题右侧不被吃掉。 */}
                <span className="app-workspace-nav-label flex min-w-0 items-center gap-1.5">
                    <span className="app-workspace-nav-title truncate">{collapsed ? collapsedTitle : item.title}</span>
                    {item.badge && !collapsed ? (
                        <span className={cn("app-workspace-nav-badge", `is-${item.badge.tone}`)} title={item.badge.title}>
                            {item.badge.label}
                        </span>
                    ) : null}
                </span>
            </span>
            <span className="app-workspace-nav-meta flex shrink-0 items-center gap-2">
                {item.shortcut ? (
                    <Kbd className="hidden group-hover:inline-flex">{item.shortcut}</Kbd>
                ) : null}
                {hasChildren ? <ChevronRight className={cn("size-3.5 shrink-0 text-foreground/40 transition-transform duration-200", isOpen && "rotate-90")} strokeWidth={2} /> : null}
            </span>
        </>
    );

    const rowClassName = cn(
        "app-workspace-nav-link group relative isolate flex min-h-11 w-full items-center justify-between gap-2 rounded-[var(--r-md)] px-3 py-2 text-[var(--fs-body)] select-none",
        collapsed && "is-collapsed",
        isActive ? "is-active font-medium" : "text-foreground/62 hover:bg-surface-hover hover:text-foreground",
    );
    const activePill = isActive ? (
        <motion.span
            layoutId="workspace-nav-active-pill"
            className="app-workspace-nav-active-pill"
            aria-hidden
            /* 选中背景直接切换，不做滑动过渡（用户要求）。 */
            transition={{ duration: 0 }}
        />
    ) : null;

    const handleClick = () => {
        if (item.action === "search") {
            onOpenSearch();
            return;
        }
        if (item.action === "logout") {
            onLogout();
            return;
        }
        if (hasChildren) {
            setIsOpen((open) => !open);
            return;
        }
        onSelect(item.id);
    };

    // 局部 const：闭包内 TS 保留窄化，供 preload 回调使用。
    const linkTo = item.to;

    return (
        <div className="flex w-full flex-col">
            {linkTo ? (
                <Link
                    to={linkTo}
                    className={rowClassName}
                    data-nav-id={item.id}
                    style={rowStyle}
                    aria-label={collapsed ? collapsedHint : undefined}
                    aria-current={isActive ? "page" : undefined}
                    title={collapsed ? collapsedHint : undefined}
                    onClick={handleClick}
                    onFocus={() => preloadWorkspaceRoute(linkTo)}
                    onPointerDown={() => preloadWorkspaceRoute(linkTo)}
                    onPointerEnter={() => preloadWorkspaceRoute(linkTo)}
                >
                    {activePill}
                    {rowContent}
                </Link>
            ) : (
                <button type="button" className={rowClassName} data-nav-id={item.id} style={rowStyle} aria-label={collapsed ? collapsedHint : undefined} title={collapsed ? collapsedHint : undefined} onClick={handleClick} aria-expanded={hasChildren ? isOpen : undefined}>
                    {activePill}
                    {rowContent}
                </button>
            )}

            {hasChildren && !collapsed ? (
                <div className={cn("grid transition-[grid-template-rows,opacity] duration-300 ease-in-out", isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
                    <div className="relative flex min-h-0 flex-col gap-0.5 overflow-hidden pt-0.5">
                        <span className="app-workspace-nav-guide-line" style={{ left: `${(level + 1) * 12 + 12.5}px` }} />
                        {item.children!.map((child) => (
                            <NavItem key={child.id} item={child} activeId={activeId} onSelect={onSelect} onOpenSearch={onOpenSearch} onLogout={onLogout} level={level + 1} collapsed={false} />
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function NavGroup({ group, activeId, onNavigate, onOpenSearch, onLogout, collapsed }: { group: WorkspaceNavGroup; activeId: string; onNavigate: () => void; onOpenSearch: () => void; onLogout: () => void; collapsed: boolean }) {
    const content = (
        <div className="flex flex-col gap-1">
            {group.items.map((item) => (
                <NavItem key={item.id} item={item} activeId={activeId} onSelect={onNavigate} onOpenSearch={onOpenSearch} onLogout={onLogout} collapsed={collapsed} />
            ))}
        </div>
    );

    // 无标题分组（核心导航入口）或折叠侧栏常驻展示，不做折叠。
    if (!group.heading || collapsed) {
        return <div className="app-workspace-nav-group flex shrink-0 flex-col" data-nav-group-heading={group.heading || ""}>{content}</div>;
    }

    // 分组标题（如“资源与工具”）作为静态分类标签常驻展示，不可点击隐藏子菜单，不渲染折叠箭头。
    return (
        <div className="app-workspace-nav-group flex shrink-0 flex-col" data-nav-group-heading={group.heading}>
            <div className="app-workspace-nav-group-toggle select-none cursor-default" aria-hidden="true">
                <span className="app-workspace-nav-group-label">{group.heading}</span>
            </div>
            <div className="pt-0.5">{content}</div>
        </div>
    );
}

// /toolbox、/toolbox/image 和 /toolbox/video 统一命中侧栏「创作影棚」单入口。
export function workspaceNavActiveId(pathname: string, section?: string | null) {
    const segments = pathname.split("/").filter(Boolean);
    if (segments[0] === "toolbox") return "toolbox";
    const slug = segments[0] || "home";
    if (slug === "create") return "home";
    return slug === "settings" && section ? `settings:${section}` : slug;
}

export function WorkspaceSidebarNav({ collapsed, onNavigate, onOpenSearch, onExpand, onCollapse }: { collapsed: boolean; onNavigate: () => void; onOpenSearch: () => void; onExpand: () => void; onCollapse: () => void }) {
    const { pathname } = useLocation();
    const [searchParams] = useSearchParams();
    const features = useUserStore((state) => state.features);
    const user = useUserStore((state) => state.user);
    const { handleLogout } = useWorkspaceLogout();
    const { groups, footer } = useMemo(() => buildNav(features), [features]);

    const section = searchParams.get("section");
    const activeId = workspaceNavActiveId(pathname, section);

    const scrollRef = useRef<HTMLDivElement>(null);
    const [scrollState, setScrollState] = useState({ hasTopFade: false, hasBottomFade: false });
    const handleScroll = () => {
        const element = scrollRef.current;
        if (!element) return;
        const { scrollTop, scrollHeight, clientHeight } = element;
        setScrollState({
            hasTopFade: scrollTop > 0,
            hasBottomFade: scrollTop + clientHeight < scrollHeight - 1,
        });
    };
    useEffect(() => {
        handleScroll();
    }, [groups]);

    return (
        <div className={cn("app-workspace-sidebar-nav flex h-full shrink-0 flex-col", collapsed && "is-collapsed")}>
            <WorkspaceSwitcher collapsed={collapsed} onNavigate={onNavigate} onExpand={onExpand} onCollapse={onCollapse} />

            <LayoutGroup id="workspace-sidebar-nav">
            <div
                ref={scrollRef}
                onScroll={handleScroll}
                className={cn("app-workspace-sidebar-scroll-area flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 pb-3 pt-7", collapsed && "is-collapsed", scrollState.hasTopFade && "has-top-fade", scrollState.hasBottomFade && "has-bottom-fade")}
            >
                {groups.map((group, index) => (
                    <NavGroup key={index} group={group} activeId={activeId} onNavigate={onNavigate} onOpenSearch={onOpenSearch} onLogout={() => void handleLogout()} collapsed={collapsed} />
                ))}
            </div>
            </LayoutGroup>

            <div className="app-workspace-sidebar-footer shrink-0 px-3 py-3">
                <WorkspaceSidebarProfile collapsed={collapsed} user={user} />
                {footer.length ? <div className="mt-2 flex flex-col gap-0.5">
                    {footer.map((item) => (
                        <NavItem key={item.id} item={item} activeId={activeId} onSelect={onNavigate} onOpenSearch={onOpenSearch} onLogout={() => void handleLogout()} collapsed={collapsed} />
                    ))}
                </div> : null}
            </div>
        </div>
    );
}
