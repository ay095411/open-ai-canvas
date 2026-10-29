import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { CreationHomeAgentEntry } from "../src/pages/create/creation-home-feature-matrix";

function renderEntry(openingAgentCanvas = false) {
    return renderToStaticMarkup(<MemoryRouter><CreationHomeAgentEntry onOpenAgentNewCanvas={() => {}} openingAgentCanvas={openingAgentCanvas} /></MemoryRouter>);
}

test("home retains Agent collaboration without creation chooser or resource tools", () => {
    const html = renderEntry();
    expect(html).toContain("需要一起梳理素材和镜头？");
    expect(html).toContain("新建画布，与 Agent 创作");
    expect(html).toContain('href="/canvas?agent=1"');
    for (const removed of ["选择创作方式", "资源与工具", 'href="/toolbox/image"', 'href="/projects"', 'href="/assets"', 'href="/skills"', 'href="/plugins"', "<video", "<img"]) expect(html).not.toContain(removed);
    const page = readFileSync(new URL("../src/pages/create/index.tsx", import.meta.url), "utf8");
    expect(page).toContain("<CreationHomeAgentEntry");
    expect(page).toContain("<CreationRecentProjects");
    expect(page).not.toContain('aria-label="查看历史对话"');
    expect(page).toContain("onOpenHistory={() => setHistoryOpen(true)}");
    expect(page).toContain("<CreationHistoryDrawer");
    expect(page).not.toContain("CreationHomeEntrypoints");
    expect(page).not.toContain("CreationHomeTools");
});

test("home content band stays independent of composer width", () => {
    const css = readFileSync(new URL("../src/pages/create/creation-home-feature-matrix.css", import.meta.url), "utf8");
    const globalCss = readFileSync(new URL("../src/styles/globals.css", import.meta.url), "utf8");
    const dashboard = css.split(".creation-home-dashboard {")[1].split("}")[0];
    expect(dashboard).toContain("width: 100%;");
    expect(dashboard).not.toContain("--creation-stage-max-width");
    expect(globalCss).toContain("width: min(1440px, calc(100% - 40px)) !important;");
    expect(globalCss).toContain("width: min(100%, var(--creation-stage-max-width));");
    const collaboration = css.split(".creation-home-agent-entry {")[1].split("}")[0];
    expect(collaboration).toContain("width: min(100%, var(--creation-stage-max-width));");
    expect(collaboration).toContain("margin-inline: auto;");
    expect(css).not.toContain(".creation-home-entry-grid");
    expect(css).not.toContain(".creation-home-tools");
});

test("home uses the requested radial background only in light mode", () => {
    const css = readFileSync(new URL("../src/styles/globals.css", import.meta.url), "utf8");
    const light = css.split("html:not(.dark) .app-user-workspace .creation-home {")[1]?.split("}")[0];
    expect(light).toContain("background: radial-gradient(#ffffff, transparent) !important;");
    const shared = css.match(/\.app-user-workspace \.creation-home \{\s*--creation-stage-max-width:[^}]+\}/)?.[0];
    expect(shared).toContain("background-color: transparent !important;");
    expect(shared).not.toContain("radial-gradient(#ffffff");
});

test("explicit Agent canvas creation exposes pending state", () => {
    const html = renderEntry(true);
    expect(html).toContain("正在新建画布…");
    expect(html).toContain('disabled=""');
});
