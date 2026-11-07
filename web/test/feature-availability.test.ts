import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { http } from "@/services/api/request";
import { applyFeatureAvailability, parseFeatureAvailability, refreshFeatureAvailability } from "@/services/feature-availability";
import { defaultFeatureAvailability, useUserStore } from "@/stores/use-user-store";
import { additionalTaskRows, featureByKey, featureGroups, featureRowState } from "@/pages/admin/components/feature-availability-catalog";

afterEach(() => {
    mock.restore();
    applyFeatureAvailability({ ...defaultFeatureAvailability });
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => (resolve = done));
    return { promise, resolve };
}

test("public reads deduplicate and cannot overwrite a newer confirmed mutation", async () => {
    const oldRead = deferred<{ features: typeof defaultFeatureAvailability }>();
    const get = spyOn(http, "get").mockReturnValue(oldRead.promise);
    const first = refreshFeatureAvailability();
    const second = refreshFeatureAvailability();
    expect(second).toBe(first);
    expect(get).toHaveBeenCalledTimes(1);
    const current = { ...defaultFeatureAvailability, ecommerceEnabled: true, imageWorkbenchEnabled: true };
    applyFeatureAvailability(current);
    oldRead.resolve({ features: { ...defaultFeatureAvailability } });
    expect(await first).toEqual(current);
    expect(useUserStore.getState().features).toEqual(current);
});

test("a new read after mutation remains pending when an obsolete read finishes", async () => {
    const oldRead = deferred<{ features: typeof defaultFeatureAvailability }>();
    const newRead = deferred<{ features: typeof defaultFeatureAvailability }>();
    const get = spyOn(http, "get").mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(newRead.promise);
    const old = refreshFeatureAvailability();
    applyFeatureAvailability({ ...defaultFeatureAvailability, ecommerceEnabled: true });
    const latest = refreshFeatureAvailability();
    oldRead.resolve({ features: { ...defaultFeatureAvailability } });
    await old;
    expect(refreshFeatureAvailability()).toBe(latest);
    newRead.resolve({ features: { ...defaultFeatureAvailability, ecommerceEnabled: true, siteAssistantEnabled: true } });
    expect((await latest).siteAssistantEnabled).toBe(true);
    expect(get).toHaveBeenCalledTimes(2);
});

test("a change notification starts a fresh read even if a pre-change read is pending", async () => {
    const before = deferred<{ features: typeof defaultFeatureAvailability }>();
    const after = deferred<{ features: typeof defaultFeatureAvailability }>();
    const get = spyOn(http, "get").mockReturnValueOnce(before.promise).mockReturnValueOnce(after.promise);
    const old = refreshFeatureAvailability();
    const notified = refreshFeatureAvailability({ force: true });
    expect(notified).not.toBe(old);
    expect(get).toHaveBeenCalledTimes(2);
    after.resolve({ features: { ...defaultFeatureAvailability, ecommerceEnabled: true } });
    await notified;
    before.resolve({ features: { ...defaultFeatureAvailability } });
    await old;
    expect(useUserStore.getState().features.ecommerceEnabled).toBe(true);
});

test("invalid or failed public reads reject without replacing confirmed state and allow retry", async () => {
    const current = { ...defaultFeatureAvailability, ecommerceEnabled: true };
    applyFeatureAvailability(current);
    const get = spyOn(http, "get")
        .mockResolvedValueOnce({ features: { ecommerceEnabled: false } })
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce({ features: defaultFeatureAvailability });
    await expect(refreshFeatureAvailability()).rejects.toThrow("有效状态");
    expect(useUserStore.getState().features).toEqual(current);
    await expect(refreshFeatureAvailability()).rejects.toThrow("offline");
    expect(useUserStore.getState().features).toEqual(current);
    await refreshFeatureAvailability();
    expect(get).toHaveBeenCalledTimes(3);
    expect(useUserStore.getState().features.ecommerceEnabled).toBe(false);
});

test("parsing preserves server-owned flags and never coerces missing or string booleans", () => {
    const server = { ...defaultFeatureAvailability, videoRemakeEnabled: true, timelineTranscriptionEnabled: true, updatedBy: "admin" };
    expect(parseFeatureAvailability(server)).toEqual(server);
    expect(() => parseFeatureAvailability({ ...server, imageWorkbenchEnabled: "false" })).toThrow();
    expect(() => parseFeatureAvailability(null)).toThrow();
});

test("studio image and video tabs are independent from ecommerce admission and assistant dependencies", () => {
    const allOn = Object.fromEntries(Object.keys(defaultFeatureAvailability).map((key) => [key, true])) as typeof defaultFeatureAvailability;
    const image = featureByKey.get("imageWorkbenchEnabled")!;
    const video = featureByKey.get("videoWorkbenchEnabled")!;
    const ecommerceVideo = featureByKey.get("ecommerceVideoEnabled")!;
    const assistant = featureByKey.get("siteAssistantEnabled")!;
    expect(featureRowState(allOn, image)).toBe("on");
    expect(featureRowState({ ...allOn, ecommerceEnabled: false }, image)).toBe("on");
    expect(featureRowState({ ...allOn, ecommerceEnabled: false, ecommerceVideoEnabled: false }, video)).toBe("on");
    expect(featureRowState({ ...allOn, videoWorkbenchEnabled: false }, video)).toBe("off");
    expect(featureRowState({ ...allOn, imageWorkbenchEnabled: false, videoWorkbenchEnabled: false }, ecommerceVideo)).toBe("on");
    expect(featureRowState({ ...allOn, ecommerceEnabled: false }, ecommerceVideo)).toBe("blocked");
    expect(featureRowState({ ...allOn, imageWorkbenchEnabled: false }, video)).toBe("on");
    expect(featureRowState({ ...allOn, creditsEnabled: false }, assistant)).toBe("blocked");
    expect(featureRowState({ ...allOn, ecommerceEnabled: false, globalAgentEnabled: false }, assistant)).toBe("on");
});

test("catalog exposes both studio tabs and separates the ecommerce-only video task switch", () => {
    const currentRows = featureGroups.flatMap((group) => group.rows);
    expect(currentRows.some((row) => row.key === "videoWorkbenchEnabled")).toBe(true);
    expect(currentRows.some((row) => row.key === "ecommerceVideoEnabled")).toBe(false);
    expect(additionalTaskRows.map((row) => row.key)).toEqual(["ecommerceVideoEnabled"]);
    for (const key of ["imageWorkbenchEnabled", "videoWorkbenchEnabled"] as const) {
        expect(featureByKey.get(key)?.requires).toBeUndefined();
        expect(featureByKey.get(key)?.parent).toBeUndefined();
    }
    expect(featureByKey.get("siteAssistantEnabled")?.link?.to).toBe("/admin/settings/yoru");
    expect(featureByKey.size).toBe(14);
    expect(featureByKey.get("imageWorkbenchEnabled")?.description).toContain("不影响电商Agent、首页或自由画布");
    expect(featureByKey.get("ecommerceEnabled")?.description).toContain("不依赖影棚开关");
    expect(featureByKey.get("ecommerceVideoEnabled")?.requires).toEqual(["ecommerceEnabled"]);
    expect(featureByKey.get("ecommerceEnabled")?.title).toBe("电商Agent");
});

test("ecommerce admission and ecommerce video only depend on their own product switches", () => {
    for (const imageWorkbenchEnabled of [false, true]) {
        for (const videoWorkbenchEnabled of [false, true]) {
            for (const ecommerceEnabled of [false, true]) {
                for (const ecommerceVideoEnabled of [false, true]) {
                    const features = { ...defaultFeatureAvailability, imageWorkbenchEnabled, videoWorkbenchEnabled, ecommerceEnabled, ecommerceVideoEnabled };
                    expect(featureRowState(features, featureByKey.get("ecommerceEnabled")!)).toBe(ecommerceEnabled ? "on" : "off");
                    expect(featureRowState(features, featureByKey.get("ecommerceVideoEnabled")!)).toBe(!ecommerceEnabled ? "blocked" : ecommerceVideoEnabled ? "on" : "off");
                }
            }
        }
    }
});
