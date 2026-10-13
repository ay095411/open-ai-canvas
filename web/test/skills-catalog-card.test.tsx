import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { SkillCard } from "@/pages/skills/skill-card";
import { fallbackSkillCategories } from "@/pages/skills/skill-catalog";
import type { Skill } from "@/services/api/skills";

const skill = {
    skillId: "skill-card-test", skillName: "测试分镜技能", description: "测试用的真实组件输入",
    tag: "drama", effectiveUser: { name: "测试作者", avatarUrl: "", uid: "author" },
    showcaseMedia: [], addedCount: 42, isAdded: false, isOwner: false, isPrivate: false, isLike: false,
} as Skill;

function render(overrides: Partial<Skill> = {}, loading = false) {
    const noop = () => {};
    return renderToStaticMarkup(<SkillCard skill={{ ...skill, ...overrides }} categories={fallbackSkillCategories} libraryCategories={[]} canCategorize={false} loading={loading} onOpen={noop} onAdd={noop} onLike={noop} onEdit={noop} onDelete={noop} onSetLibraryCategory={noop} />);
}

describe("skills catalog card", () => {
    test("shows real attribution and adoption count without inventing a cover", () => {
        const html = render();
        expect(html).toContain("测试作者");
        expect(html).toContain("42 人已加入");
        expect(html).toContain("短剧影视");
        expect(html).not.toContain("<img");
        expect(html).toContain('aria-label="查看测试分镜技能详情"');
    });

    test("uses the skill's image media, skipping video-only media", () => {
        const html = render({ showcaseMedia: [
            { type: "video", showcaseUri: "", showcaseUrl: "/uploads/test-video.mp4" },
            { type: "image", showcaseUri: "", showcaseUrl: "/uploads/test-cover.webp" },
        ] });
        expect(html).toContain('src="/uploads/test-cover.webp"');
        expect(html).not.toContain("test-video.mp4");
        expect(html).toContain('loading="lazy"');
    });

    test("distinguishes membership from a runtime enable switch", () => {
        expect(render()).toContain('aria-pressed="false"');
        expect(render()).toContain("加入技能库");
        expect(render({ isAdded: true })).toContain('aria-pressed="true"');
        expect(render({ isAdded: true })).toContain("已加入");
        expect(render({ isAdded: true })).not.toContain('role="switch"');
    });

    test("owned private skills keep their ownership and visibility labels", () => {
        const html = render({ isOwner: true, isPrivate: true, isAdded: true });
        expect(html).toContain("我创建的 · 私有");
        expect(html).not.toContain("加入技能库");
        expect(html).not.toContain("aria-pressed");
    });

    test("mutation state disables the menu and keeps a progress indicator", () => {
        const html = render({}, true);
        expect(html).toContain('aria-label="测试分镜技能的更多操作" disabled=""');
        expect(html).toContain("ant-btn-loading");
    });
});
