import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("首页顶部不显示历史同步失败与重试，历史副本管理留在历史抽屉", () => {
    const source = readFileSync(new URL("../src/pages/create/index.tsx", import.meta.url), "utf8");
    const top = source.slice(source.indexOf('<div className="creation-home'), source.indexOf("{conversationStorageError ?"));
    expect(top).not.toContain("historySync");
    expect(source).not.toContain('t("create.historySync.error")');
    expect(source).not.toContain('t("create.historySync.retry")');
    expect(top).not.toContain("historySessionRef.current?.sync()");
    expect(top).not.toContain("CreationHistoryConflicts");
    expect(top).not.toContain("historySync.backupCount");

    const drawer = source.slice(source.indexOf("<CreationHistoryDrawer"), source.indexOf("<CreationLoginDialog"));
    expect(drawer).toContain("recoveryActions=");
    expect(drawer).toMatch(/historyOpen\s*&&\s*(?:Boolean\()?historySync\.backupCount/);
    expect(drawer).toContain("<CreationHistoryConflicts");
    expect(drawer).toContain("key={activeConversationScope}");
    expect(drawer).toContain("session={historySessionRef.current}");
    expect(drawer).toContain("status={historySync}");
    expect(drawer).toContain("busy={busy}");
});

test("真实历史抽屉保留副本查看、保留与恢复操作，并限制生成中恢复", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/creation-history-backup-entry.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 60_000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("4 pass");
    expect(output).toContain("0 fail");
}, 60_000);
