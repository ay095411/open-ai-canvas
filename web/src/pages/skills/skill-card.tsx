import { Button, Dropdown } from "antd";
import { Check, Clapperboard, FolderInput, Heart, MoreHorizontal, Palette, Plus, Puzzle, ShoppingBag, Megaphone, Users, UserRound } from "lucide-react";
import { useState } from "react";

import { formatSkillCount, skillCategoryLabel } from "@/pages/skills/skill-catalog";
import type { Skill, SkillCategory, SkillLibraryCategory } from "@/services/api/skills";

type SkillCardProps = {
    skill: Skill;
    rootLabel?: string;
    categories: SkillCategory[];
    libraryCategories: SkillLibraryCategory[];
    canCategorize: boolean;
    loading: boolean;
    onOpen: () => void;
    onAdd: () => void;
    onLike: () => void;
    onEdit: () => void;
    onDelete: () => void;
    onSetLibraryCategory: (categoryId: string) => void;
};

export function SkillCard({ skill, rootLabel, categories, libraryCategories, canCategorize, loading, onOpen, onAdd, onLike, onEdit, onDelete, onSetLibraryCategory }: SkillCardProps) {
    const [failedImage, setFailedImage] = useState("");
    const cover = skill.showcaseMedia?.find((media) => media.type === "image" && media.showcaseUrl)?.showcaseUrl;
    const label = rootLabel || skillCategoryLabel(skill.tag, categories);
    const Icon = ({ drama: Clapperboard, ecommerce: ShoppingBag, creative: Palette, social: Megaphone } as Record<string, typeof Puzzle>)[skill.tag] || Puzzle;
    const categoryName = libraryCategories.find((category) => category.id === skill.libraryCategoryId)?.name || (skill.libraryCategoryId ? "已归类" : "未分类");
    const menuItems = [
        { key: "like", label: skill.isLike ? "取消收藏" : "收藏技能", icon: <Heart className="size-3.5" /> },
        ...(canCategorize ? [{ key: "category", label: `分类：${categoryName}`, icon: <FolderInput className="size-3.5" />, children: [
            { key: "category:", label: "未分类" },
            ...libraryCategories.map((category) => ({ key: `category:${category.id}`, label: category.name })),
        ] }] : []),
        ...(skill.isOwner ? [{ key: "edit", label: "编辑技能" }, { key: "delete", label: "删除技能", danger: true }] : []),
    ];

    return (
        <article className="skills-catalog-card" data-category={skill.tag}>
            <div className="skills-catalog-card-copy">
                <div className="skills-catalog-card-heading">
                    <button type="button" className="skills-catalog-card-title" onClick={onOpen} title={skill.skillName}><h3>{skill.skillName}</h3></button>
                    <Dropdown trigger={["click"]} menu={{ items: menuItems, onClick: ({ key }) => {
                        if (key === "like") onLike();
                        else if (key === "edit") onEdit();
                        else if (key === "delete") onDelete();
                        else if (key.startsWith("category:")) onSetLibraryCategory(key.slice(9));
                    } }}>
                        <button type="button" className="skills-card-more" aria-label={`${skill.skillName}的更多操作`} disabled={loading}><MoreHorizontal className="size-4" /></button>
                    </Dropdown>
                </div>
                <button type="button" className="skills-catalog-card-description" onClick={onOpen}><p>{skill.description || "暂无技能简介"}</p></button>
                <div className="skills-catalog-card-meta">
                    <span className="skills-catalog-author"><UserRound className="size-3" aria-hidden /><span>{skill.effectiveUser.name || "未知用户"}</span></span>
                    <span className="skills-catalog-count" title={`${skill.addedCount} 人已加入`}><Users className="size-3" aria-hidden />{formatSkillCount(skill.addedCount)}</span>
                </div>
                <div className="skills-catalog-card-actions">
                    {skill.isOwner ? <span className="skills-owner-label">我创建的{skill.isPrivate ? " · 私有" : ""}</span> : <Button size="small" loading={loading} aria-pressed={skill.isAdded} icon={skill.isAdded ? <Check className="size-3" /> : <Plus className="size-3" />} onClick={onAdd}>{skill.isAdded ? "已加入" : "加入技能库"}</Button>}
                    <span className="skills-catalog-category" title={label}>{label}</span>
                </div>
            </div>
            <button type="button" className={`skills-catalog-cover${cover && failedImage !== cover ? " has-image" : ""}`} onClick={onOpen} aria-label={`查看${skill.skillName}详情`}>
                {cover && failedImage !== cover ? <img src={cover} alt="" loading="lazy" onError={() => setFailedImage(cover)} /> : <><span className="skills-cover-grid" /><Icon aria-hidden /><span className="skills-cover-label">{label}</span><span className="skills-cover-wordmark">SKILL</span></>}
            </button>
        </article>
    );
}

export function SkillSkeleton({ count = 6 }: { count?: number }) {
    return <div className="skills-catalog-grid" aria-label="正在加载技能" aria-busy="true">{Array.from({ length: count }, (_, index) => <div key={index} className="skills-card-skeleton" />)}</div>;
}
