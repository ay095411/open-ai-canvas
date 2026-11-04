import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { accountStorageMeter } from "../src/lib/account-storage-usage";

const GB = 1024 ** 3;

describe("account storage meter", () => {
    test("exposes remaining capacity and total capacity", () => {
        const meter = accountStorageMeter({ usedBytes: 2 * GB, totalBytes: 10 * GB });

        expect(meter.usedLabel).toBe("2.0 GB");
        expect(meter.remainingLabel).toBe("8.0 GB");
        expect(meter.totalLabel).toBe("10 GB");
        expect(meter.percent).toBe(20);
        expect(meter.tone).toBe("ok");
        expect(meter.full).toBe(false);
    });

    test("warns when usage reaches seventy percent", () => {
        const meter = accountStorageMeter({ usedBytes: 7 * GB, totalBytes: 10 * GB });

        expect(meter.percent).toBe(70);
        expect(meter.tone).toBe("warn");
        expect(meter.remainingLabel).toBe("3.0 GB");
    });

    test("marks full accounts as critical with zero remaining", () => {
        const meter = accountStorageMeter({ usedBytes: 10 * GB, totalBytes: 10 * GB });

        expect(meter.full).toBe(true);
        expect(meter.tone).toBe("critical");
        expect(meter.remainingBytes).toBe(0);
        expect(meter.remainingLabel).toBe("0 B");
        expect(meter.percent).toBe(100);
    });

    test("treats missing usage as empty instead of overflowing", () => {
        const meter = accountStorageMeter();

        expect(meter.percent).toBe(0);
        expect(meter.remainingLabel).toBe("0 B");
        expect(meter.totalLabel).toBe("0 B");
        expect(meter.tone).toBe("ok");
        expect(meter.full).toBe(false);
    });
});

describe("workspace account storage surfaces", () => {
    test("asset library displays actual usage and keeps errors distinct from empty capacity", () => {
        const page = readFileSync(resolve(import.meta.dir, "../src/pages/assets/index.tsx"), "utf8");
        const meter = readFileSync(resolve(import.meta.dir, "../src/pages/assets/asset-storage-usage.tsx"), "utf8");
        expect(page).toContain("<AssetStorageUsage />");
        expect(meter).toContain("useAccountFileStorageUsage()");
        expect(meter).toContain('aria-label="账号文件容量"');
        expect(meter).toContain('role="progressbar"');
        expect(meter).toContain("aria-valuenow={Math.min(usage.usedBytes, usage.totalBytes)}");
        expect(meter).toContain("formatStorageBytes(usage.usedBytes)");
        expect(meter).toContain("formatStorageBytes(usage.totalBytes)");
        expect(meter).toContain("容量统计暂时不可用");
        expect(meter).toContain("query.refetch()");
    });

    test("wallet shows remaining capacity and storage rejection keeps cleanup and purchase reachable", () => {
        const wallet = readFileSync(resolve(import.meta.dir, "../src/components/layout/workspace-wallet-modal.tsx"), "utf8");
        const shell = readFileSync(resolve(import.meta.dir, "../src/components/layout/app-top-nav.tsx"), "utf8");
        const notice = readFileSync(resolve(import.meta.dir, "../src/components/layout/workspace-storage-limit-notice.tsx"), "utf8");
        expect(wallet).toContain("${storageMeter.usedLabel} / ${storageMeter.totalLabel}");
        expect(wallet).toContain("剩余 ${storageMeter.remainingLabel}");
        expect(wallet).toContain('onClick={() => focusProducts("storage")}');
        expect(shell).toContain("<WorkspaceStorageLimitNotice />");
        expect(notice).toContain("STORAGE_LIMIT_REASONS.has(reason)");
        expect(notice).toContain('navigate("/assets")');
        expect(notice).toContain("openStoragePurchase()");
        expect(notice).toContain("return Promise.reject(error)");
    });
});
