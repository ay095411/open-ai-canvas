import { AppModal } from "@/components/ui/product/app-modal";
import { App, Button, Input } from "antd";

import { ArrowLeft, Check, ChevronRight, FolderPlus, Globe2, Info, Plus, Search, Sparkles, Trash2, Upload, UserRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { PaginationBar, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceState } from "@/components/layout/workspace-state";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { fallbackSkillCategories } from "@/pages/skills/skill-catalog";
import { SkillCard, SkillSkeleton } from "@/pages/skills/skill-card";
import { SkillDetailModal } from "@/pages/skills/skill-detail-drawer";
import { SkillEditorDrawer } from "@/pages/skills/skill-editor-drawer";
import { SkillInstallModal } from "@/pages/skills/skill-install-modal";
import { addSkill, createSkillLibraryCategory, deleteSkill, deleteSkillLibraryCategory, getSkill, likeSkill, listSkillLibraryCategories, listSkills, removeSkill, setSkillLibraryCategory, syncSkill, unlikeSkill, type Skill, type SkillCategory, type SkillLibraryCategory, type SkillLibraryCategoryList, type SkillScope, type SkillSort } from "@/services/api/skills";
import { useUserStore } from "@/stores/use-user-store";
import { Select } from "@/components/ui/base/select";
import { SkillCurationBrowser, useSkillCuration, curationQuery, effectiveCurationRoot } from "@/components/skills/skill-curation-browser";
import { SkillRecommendationsModal } from "@/components/skills/skill-recommendations-modal";
import "./skills-page.css";

const scopeOptions: { label: string; value: SkillScope }[] = [
    { label: "全部", value: "mine" },
    { label: "我创建的", value: "created" },
    { label: "我的收藏", value: "favorites" },
];

const sortOptions: { label: string; value: SkillSort }[] = [
    { label: "最多加入", value: "popular" },
    { label: "最新发布", value: "new" },
    { label: "最近更新", value: "updated" },
];

export default function SkillsPage() {
    const { curation, error: curationError, retry: retryCuration } = useSkillCuration();
    const [platformCategory, setPlatformCategory] = useState("");
    const { message, modal } = App.useApp();
    const [scope, setScope] = useState<SkillScope>("public");
    const [sort, setSort] = useState<SkillSort>("popular");
    const [search, setSearch] = useState("");
    const debouncedSearch = useDebouncedValue(search, 250);
    const [tag, setTag] = useState("all");
    useEffect(() => { if (curation?.enabled) setTag("all"); }, [curation?.enabled]);
    const [libraryCategoryId, setLibraryCategoryId] = useState("all");
    const [libraryCategoryList, setLibraryCategoryList] = useState<SkillLibraryCategoryList | null>(null);
    const [libraryCategoryError, setLibraryCategoryError] = useState("");
    const [categoryEditorOpen, setCategoryEditorOpen] = useState(false);
    const [categoryName, setCategoryName] = useState("");
    const [categoryScope, setCategoryScope] = useState<"personal" | "platform">("personal");
    const [categorySaving, setCategorySaving] = useState(false);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [skills, setSkills] = useState<Skill[]>([]);
    const [categories, setCategories] = useState<SkillCategory[]>(fallbackSkillCategories);
    const [total, setTotal] = useState(0);
    const [previewSkills, setPreviewSkills] = useState<Skill[]>([]);
    const [previewTotal, setPreviewTotal] = useState<number | null>(null);
    const [previewLoading, setPreviewLoading] = useState(true);
    const [previewError, setPreviewError] = useState("");
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [reloadKey, setReloadKey] = useState(0);
    const [activeSkill, setActiveSkill] = useState<Skill | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [mutatingID, setMutatingID] = useState("");
    const [editorOpen, setEditorOpen] = useState(false);
    const [installOpen, setInstallOpen] = useState(false);
    const [recommendationsOpen, setRecommendationsOpen] = useState(false);
    const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
    const isAdmin = useUserStore((state) => state.user?.role === "admin");
    const navigate = useNavigate();
    const isLibraryScope = scope === "mine" || scope === "created";
    const libraryCategoryScope = scope === "created" ? "created" : "mine";

    const reload = useCallback(() => setReloadKey((value) => value + 1), []);
    const openWorkbench = (skill: Skill) => {
        setActiveSkill(null);
        navigate(`/skills/${encodeURIComponent(skill.skillId)}/edit`);
    };
    const selectScope = (next: SkillScope) => {
        setScope(next);
        setSearch("");
        setTag("all");
        setPlatformCategory("");
        setLibraryCategoryId("all");
        setPage(1);
    };
    const selectMarketplaceCategory = (categoryId: string) => {
        setScope("public");
        setTag(categoryId);
        setLibraryCategoryId("all");
        setPage(1);
    };
    const selectLibraryCategory = (categoryId: string) => {
        setScope((current) => current === "created" ? "created" : "mine");
        setLibraryCategoryId(categoryId);
        setPage(1);
    };

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setLoadError("");
        setSkills([]);
        const libraryFilter = isLibraryScope
            ? libraryCategoryId === "__uncategorized__"
                ? { libraryUncategorized: true }
                : libraryCategoryId !== "all" ? { libraryCategoryId } : {}
            : {};
        listSkills({ page, pageSize, scope, sort, search: debouncedSearch || undefined, tag: !isLibraryScope && tag !== "all" ? tag : undefined, ...libraryFilter, ...curationQuery(curation, platformCategory) })
            .then((result) => {
                if (cancelled) return;
                setSkills(result.skills);
                setTotal(result.totalCount);
                if (result.categories.length) setCategories(result.categories);
            })
            .catch((error) => {
                if (cancelled) return;
                setSkills([]);
                setTotal(0);
                setLoadError(error instanceof Error ? error.message : "技能加载失败");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [debouncedSearch, isLibraryScope, libraryCategoryId, page, pageSize, reloadKey, scope, sort, tag, curation, platformCategory]);

    useEffect(() => {
        let cancelled = false;
        setLibraryCategoryError("");
        listSkillLibraryCategories(libraryCategoryScope)
            .then((result) => { if (!cancelled) setLibraryCategoryList(result); })
            .catch((error) => {
                if (!cancelled) {
                    setLibraryCategoryList(null);
                    setLibraryCategoryError(error instanceof Error ? error.message : "技能库分类加载失败");
                }
            });
        return () => { cancelled = true; };
    }, [libraryCategoryScope, reloadKey]);

    useEffect(() => {
        if (scope !== "public") return;
        let cancelled = false;
        setPreviewLoading(true);
        setPreviewError("");
        listSkills({ scope: "mine", page: 1, pageSize: 3, sort: "updated" })
            .then((result) => {
                if (!cancelled) { setPreviewSkills(result.skills.slice(0, 3)); setPreviewTotal(result.totalCount); }
            })
            .catch((error) => {
                if (!cancelled) { setPreviewSkills([]); setPreviewTotal(null); setPreviewError(error instanceof Error ? error.message : "我的技能加载失败"); }
            })
            .finally(() => { if (!cancelled) setPreviewLoading(false); });
        return () => { cancelled = true; };
    }, [scope, reloadKey]);

    const browseCategories: SkillCategory[] = curation?.enabled ? (curation.roots || []).map((root) => ({ value: root.id, label: root.name })) : categories;
    const filtersActive = Boolean(search || platformCategory || (!isLibraryScope && tag !== "all") || (isLibraryScope && libraryCategoryId !== "all") || sort !== "popular");
    const resetFilters = useCallback(() => { setSearch(""); setTag("all"); setPlatformCategory(""); setLibraryCategoryId("all"); setSort("popular"); setPage(1); }, []);

    const openSkill = async (skill: Skill) => {
        setActiveSkill(skill);
        setDetailLoading(true);
        try {
            const result = await getSkill(skill.skillId);
            setActiveSkill(result.skill);
            patchSkill(result.skill);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "技能详情加载失败");
            setActiveSkill(null);
        } finally {
            setDetailLoading(false);
        }
    };

    const openEditor = async (skill?: Skill) => {
        if (!skill) {
            setEditingSkill(null);
            setEditorOpen(true);
            return;
        }
        try {
            const result = skill.instruction ? { skill } : await getSkill(skill.skillId);
            setActiveSkill(null);
            setEditingSkill(result.skill);
            setEditorOpen(true);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "技能读取失败");
        }
    };

    const patchSkill = (next: Skill) => {
        setSkills((items) => items.map((item) => item.skillId === next.skillId ? { ...item, ...next, instruction: next.instruction || item.instruction } : item));
        setPreviewSkills((items) => items.map((item) => item.skillId === next.skillId ? { ...item, ...next, instruction: next.instruction || item.instruction } : item));
        setActiveSkill((current) => current?.skillId === next.skillId ? { ...current, ...next, instruction: next.instruction || current.instruction } : current);
    };

    const toggleAdded = async (skill: Skill) => {
        if (skill.isOwner) return;
        setMutatingID(skill.skillId);
        try {
            const result = skill.isAdded ? await removeSkill(skill.skillId) : await addSkill(skill.skillId);
            patchSkill(result.skill);
            message.success(result.skill.isAdded ? "已加入我的技能" : "已从我的技能移除");
            reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "技能状态更新失败");
        } finally {
            setMutatingID("");
        }
    };

    const toggleLiked = async (skill: Skill) => {
        setMutatingID(skill.skillId);
        try {
            const result = skill.isLike ? await unlikeSkill(skill.skillId) : await likeSkill(skill.skillId);
            patchSkill(result.skill);
            message.success(result.skill.isLike ? "已收藏" : "已取消收藏");
            if (scope === "favorites" && !result.skill.isLike) reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "收藏状态更新失败");
        } finally {
            setMutatingID("");
        }
    };

    const synchronizeSkill = async (skill: Skill) => {
        setMutatingID(skill.skillId);
        try {
            const result = await syncSkill(skill.skillId);
            patchSkill(result.skill);
            message.success(result.skill.versionId === skill.versionId ? "已是最新版本" : "已同步最新版本");
            reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "GitHub 技能同步失败");
        } finally {
            setMutatingID("");
        }
    };

    const confirmDelete = (skill: Skill) => {
        modal.confirm({
            title: `删除“${skill.skillName}”？`,
            content: "删除后，其他用户将无法继续使用该技能，已有加入和收藏关系也会一并移除。",
            okText: "删除技能",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                try {
                    await deleteSkill(skill.skillId);
                    setActiveSkill(null);
                    message.success("技能已删除");
                    reload();
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "技能删除失败");
                    throw error;
                }
            },
        });
    };

    const saveLibraryCategory = async () => {
        const name = categoryName.trim();
        if (!name) {
            message.error("请输入分类名称");
            return;
        }
        setCategorySaving(true);
        try {
            await createSkillLibraryCategory({ name, scope: isAdmin ? categoryScope : "personal" });
            message.success("技能库分类已创建");
            setCategoryEditorOpen(false);
            setCategoryName("");
            setLibraryCategoryId("all");
            setPage(1);
            reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "分类创建失败");
        } finally {
            setCategorySaving(false);
        }
    };

    const confirmDeleteLibraryCategory = (category: SkillLibraryCategory) => {
        modal.confirm({
            title: `删除分类“${category.name}”？`,
            content: "删除分类只会解除技能与该分类的关联，不会删除技能本身。",
            okText: "删除分类",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                try {
                    await deleteSkillLibraryCategory(category.id);
                    if (libraryCategoryId === category.id) setLibraryCategoryId("all");
                    message.success("分类已删除，技能仍保留在技能库中");
                    reload();
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "分类删除失败");
                    throw error;
                }
            },
        });
    };

    const assignLibraryCategory = async (skill: Skill, categoryId: string) => {
        setMutatingID(skill.skillId);
        try {
            const result = await setSkillLibraryCategory(skill.skillId, categoryId);
            patchSkill(result.skill);
            message.success(categoryId ? "技能已归类" : "已取消技能归类");
            reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "技能归类失败");
        } finally {
            setMutatingID("");
        }
    };

    const libraryCategories = libraryCategoryList?.categories ?? [];
    const renderSkillCard = (skill: Skill) => (
        <SkillCard
            key={skill.skillId}
            skill={skill}
            rootLabel={curation?.enabled ? curation.roots?.find((root) => root.id === effectiveCurationRoot(skill, curation))?.name : undefined}
            categories={categories}
            libraryCategories={libraryCategories}
            canCategorize={skill.isOwner || skill.isAdded}
            loading={mutatingID === skill.skillId}
            onOpen={() => void openSkill(skill)}
            onAdd={() => void toggleAdded(skill)}
            onLike={() => void toggleLiked(skill)}
            onEdit={() => void openEditor(skill)}
            onDelete={() => confirmDelete(skill)}
            onSetLibraryCategory={(categoryId) => void assignLibraryCategory(skill, categoryId)}
        />
    );

    const skillContent = loading ? <SkillSkeleton /> : loadError ? <WorkspaceErrorState compact description={loadError} onRetry={reload} /> : skills.length ? (
        <div className="skills-catalog-grid">
            {skills.map(renderSkillCard)}
        </div>
    ) : (
        <WorkspaceState
            compact
            className="min-h-[188px]"
            icon="skills"
            title={filtersActive ? "没有找到匹配技能" : scope === "created" ? "还没有创建技能" : scope === "public" ? "技能广场还是空的" : "这里还没有技能"}
            description={filtersActive ? "换个关键词或分类试试。" : scope === "favorites" ? "收藏的公开技能会显示在这里。" : scope === "mine" ? "从技能广场加入后会显示在这里。" : "创建并公开第一个技能，其他用户就能直接加入使用。"}
            action={filtersActive
                ? <Button onClick={resetFilters}>清除筛选</Button>
                : (scope === "created" || scope === "public")
                  ? <Button type="primary" icon={<Plus className="size-4" />} onClick={() => setInstallOpen(true)}>安装技能</Button>
                  : undefined}
        />
    );

    return (
        <>
            <WorkspacePage className="skills-market-page">
                {scope === "public" ? (
                    <>
                        <header className="skills-hero">
                            <div className="skills-hero-copy">
                                <h1>探索和管理技能</h1>
                                <p>将提示词、工作流程与创作方法沉淀为技能，随时调用，也可以分享给更多创作者。</p>
                                <div className="skills-page-actions">
                                    <Button icon={<Sparkles className="size-3.5" />} onClick={() => setRecommendationsOpen(true)}>按行业推荐</Button>
                                    <Button icon={<Upload className="size-3.5" />} onClick={() => setInstallOpen(true)}>上传 skill</Button>
                                    <Button type="primary" icon={<Sparkles className="size-3.5" />} onClick={() => void openEditor()}>创建 Skill</Button>
                                </div>
                            </div>
                            <div className="skills-hero-art" aria-hidden="true">
                                <img src="/welcome/charge/character-final.webp" alt="" />
                                <img src="/welcome/wing-it/banner.webp" alt="" />
                                <img src="/welcome/spring/4336.webp" alt="" />
                            </div>
                        </header>
                        <section className="skills-section" aria-labelledby="my-skills-preview-heading">
                            <div className="skills-section-heading">
                                <h2 id="my-skills-preview-heading">我的技能 {!previewLoading && previewTotal !== null ? <span>（{previewTotal}）</span> : null}</h2>
                                <button type="button" className="skills-text-button" onClick={() => selectScope("mine")}>查看全部<ChevronRight className="size-3.5" /></button>
                            </div>
                            {previewLoading ? <SkillSkeleton count={3} /> : previewError ? <WorkspaceErrorState compact description={previewError} onRetry={reload} /> : previewSkills.length ? (
                                <div className="skills-catalog-grid">{previewSkills.map(renderSkillCard)}</div>
                            ) : (
                                <div className="skills-preview-empty"><span>还没有技能，探索下方技能库，或创建你的第一个 Skill。</span><button type="button" className="skills-text-button" onClick={() => void openEditor()}>创建技能<Plus className="size-3.5" /></button></div>
                            )}
                        </section>
                    </>
                ) : (
                    <>
                        <header className="skills-personal-header">
                            <div className="skills-personal-title"><button type="button" aria-label="返回探索技能" onClick={() => selectScope("public")}><ArrowLeft className="size-4" /></button><h1>我的技能</h1></div>
                            <div className="skills-page-actions">
                                <Button icon={<Sparkles className="size-3.5" />} onClick={() => setRecommendationsOpen(true)}>按行业推荐</Button>
                                <Button icon={<Upload className="size-3.5" />} onClick={() => setInstallOpen(true)}>上传 skill</Button>
                                <Button type="primary" icon={<Sparkles className="size-3.5" />} onClick={() => void openEditor()}>创建 Skill</Button>
                            </div>
                        </header>
                        <div className="skills-personal-tabs" role="group" aria-label="我的技能范围">
                            {scopeOptions.map((option) => <button key={option.value} type="button" className="skills-filter-chip" aria-pressed={scope === option.value} onClick={() => selectScope(option.value)}>{option.label}</button>)}
                        </div>
                    </>
                )}

                <section className={scope === "public" ? "skills-section" : ""} aria-labelledby="skills-catalog-heading">
                    {scope === "public" ? <div className="skills-section-heading"><h2 id="skills-catalog-heading">探索技能</h2></div> : <h2 id="skills-catalog-heading" className="sr-only">技能列表</h2>}
                    <div className="skills-catalog-toolbar">
                        {scope === "public" ? <div className="skills-category-chips" role="group" aria-label="探索技能分类">
                            <button type="button" className="skills-filter-chip" aria-pressed={tag === "all" && !platformCategory} onClick={() => { setPlatformCategory(""); selectMarketplaceCategory("all"); }}>全部</button>
                            {browseCategories.map((category) => <button key={category.value} type="button" className="skills-filter-chip" aria-pressed={curation?.enabled ? platformCategory === `root:${category.value}` : tag === category.value} onClick={() => { if (curation?.enabled) { setPlatformCategory(`root:${category.value}`); selectMarketplaceCategory("all"); } else selectMarketplaceCategory(category.value); }}>{category.label}</button>)}
                        </div> : null}
                        <div className="skills-catalog-controls">
                            {filtersActive ? <button type="button" className="skills-text-button" onClick={resetFilters}>重置</button> : null}
                            <Select aria-label="技能排序" className="skills-catalog-sort" value={sort} options={sortOptions} onChange={(value) => { setSort(value); setPage(1); }} />
                            <Input aria-label="搜索 Skill" className="skills-catalog-search" prefix={<Search className="size-3.5" />} value={search} allowClear placeholder="搜索 Skill 或作者" onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
                        </div>
                    </div>
                    {(curation?.enabled || curationError) ? <div className="skills-catalog-curation"><SkillCurationBrowser data={curation} value={platformCategory} onChange={(value) => { setPlatformCategory(value); setTag("all"); setPage(1); }} error={curationError} retry={retryCuration} /></div> : null}
                    {isLibraryScope ? <>
                        <div className="skills-personal-categories" role="group" aria-label="我的技能分类">
                            <button type="button" className="skills-filter-chip" aria-pressed={libraryCategoryId === "all"} onClick={() => selectLibraryCategory("all")}>全部分类</button>
                            <button type="button" className="skills-filter-chip" aria-pressed={libraryCategoryId === "__uncategorized__"} onClick={() => selectLibraryCategory("__uncategorized__")}>未分类</button>
                            {libraryCategories.map((category) => <div key={category.id} className="skills-category-pair">
                                <button type="button" className="skills-filter-chip" aria-pressed={libraryCategoryId === category.id} onClick={() => selectLibraryCategory(category.id)}>{category.name}<span>{category.count}</span></button>
                                {category.scope === "personal" || isAdmin ? <button type="button" aria-label={`删除分类${category.name}`} onClick={() => confirmDeleteLibraryCategory(category)}><Trash2 className="size-3" /></button> : null}
                            </div>)}
                            <button type="button" className="skills-text-button" onClick={() => { setCategoryName(""); setCategoryScope("personal"); setCategoryEditorOpen(true); }}><FolderPlus className="size-3.5" />新建分类</button>
                        </div>
                        {libraryCategoryError ? <div className="skills-inline-error" role="alert">{libraryCategoryError}<Button type="link" size="small" onClick={reload}>重试</Button></div> : null}
                    </> : null}
                    {skillContent}
                    <PaginationBar current={page} pageSize={pageSize} total={total} pageSizeOptions={[20, 40, 80]} onChange={(nextPage, nextPageSize) => { setPage(nextPageSize !== pageSize ? 1 : nextPage); setPageSize(nextPageSize); }} />
                </section>
            </WorkspacePage>

            <AppModal
                open={categoryEditorOpen}
                title={(
                    <div className="skills-library-category-title">
                        <span className="skills-library-category-title-icon"><FolderPlus className="size-4" aria-hidden="true" /></span>
                        <span>
                            <small>技能库整理</small>
                            <strong>新建分类</strong>
                        </span>
                    </div>
                )}
                className="library-modal skills-library-category-modal"
                width="min(480px, calc(100vw - 32px))"
                centered
                okText="创建分类"
                cancelText="取消"
                okButtonProps={{ disabled: !categoryName.trim() }}
                confirmLoading={categorySaving}
                onOk={() => void saveLibraryCategory()}
                onCancel={() => setCategoryEditorOpen(false)}
                destroyOnHidden
            >
                <div className="skills-library-category-editor">
                    <div className="skills-library-category-field">
                        <label htmlFor="skills-library-category-name">分类名称</label>
                        <Input id="skills-library-category-name" autoFocus maxLength={64} showCount value={categoryName} onChange={(event) => setCategoryName(event.target.value)} onPressEnter={() => void saveLibraryCategory()} placeholder="例如：角色设定、分镜、宣发" />
                        <span className="skills-library-category-field-hint">最多 64 个字符；名称不能与当前可用分类重名。</span>
                    </div>
                    {isAdmin ? (
                        <div className="skills-library-category-scope">
                            <span className="skills-library-category-field-label">分类范围</span>
                            <div className="skills-library-category-scope-options" role="group" aria-label="分类范围">
                                <button type="button" className={`skills-library-category-scope-option${categoryScope === "personal" ? " is-active" : ""}`} aria-pressed={categoryScope === "personal"} onClick={() => setCategoryScope("personal")}>
                                    <span className="skills-library-category-scope-icon"><UserRound className="size-4" aria-hidden="true" /></span>
                                    <span className="skills-library-category-scope-copy"><strong>个人分类</strong><small>仅你自己可见和使用</small></span>
                                    {categoryScope === "personal" ? <Check className="skills-library-category-scope-check size-4" aria-hidden="true" /> : null}
                                </button>
                                <button type="button" className={`skills-library-category-scope-option${categoryScope === "platform" ? " is-active" : ""}`} aria-pressed={categoryScope === "platform"} onClick={() => setCategoryScope("platform")}>
                                    <span className="skills-library-category-scope-icon"><Globe2 className="size-4" aria-hidden="true" /></span>
                                    <span className="skills-library-category-scope-copy"><strong>平台分类</strong><small>所有用户可见、可分配</small></span>
                                    {categoryScope === "platform" ? <Check className="skills-library-category-scope-check size-4" aria-hidden="true" /> : null}
                                </button>
                            </div>
                        </div>
                    ) : null}
                    <div className={`skills-library-category-note${categoryScope === "platform" && isAdmin ? " is-platform" : ""}`}>
                        <Info className="size-4" aria-hidden="true" />
                        <p>{categoryScope === "platform" && isAdmin
                            ? "平台分类对所有用户可见、可分配，并可用于各自的技能库和画布 Agent；不会替换技能广场分类。"
                            : "个人分类只影响你的技能库和画布 Agent。短剧影视、电商营销等共享分类，可在“探索技能”页顶部筛选。"}</p>
                    </div>
                </div>
            </AppModal>
            <SkillDetailModal skill={activeSkill} loading={detailLoading} mutating={Boolean(activeSkill && mutatingID === activeSkill.skillId)} categories={categories} onClose={() => setActiveSkill(null)} onAdd={(skill) => void toggleAdded(skill)} onLike={(skill) => void toggleLiked(skill)} onEdit={(skill) => void openEditor(skill)} onOpenWorkbench={openWorkbench} onSync={(skill) => void synchronizeSkill(skill)} />
            <SkillInstallModal open={installOpen} onClose={() => setInstallOpen(false)} onInstalled={(skill) => { setInstallOpen(false); setActiveSkill(skill); reload(); }} onManualCreate={() => { setInstallOpen(false); void openEditor(); }} />
            <SkillRecommendationsModal open={recommendationsOpen} onClose={() => setRecommendationsOpen(false)} onInstalled={(installed) => { if (installed.length) reload(); }} />
            <SkillEditorDrawer open={editorOpen} skill={editingSkill} onClose={() => setEditorOpen(false)} onSaved={(skill) => { setEditorOpen(false); setEditingSkill(null); setActiveSkill(skill); reload(); }} />
        </>
    );
}
