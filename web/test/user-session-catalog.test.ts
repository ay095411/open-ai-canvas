import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { refreshSystemChannels } from "../src/lib/user-session";
import { apiClient } from "../src/services/api/request";
import { createModelChannel, defaultConfig, useConfigStore } from "../src/stores/use-config-store";
import { useUserStore, type LocalUser } from "../src/stores/use-user-store";

const originalRequest = apiClient.request;
const previousUser = useUserStore.getState().user;
const previousConfig = useConfigStore.getState().config;
const user: LocalUser = { id: "catalog-user", username: "catalog-user", displayName: "Catalog User", role: "user", status: "active" };

function response() {
    return {
        status: 200,
        data: {
            code: 0,
            msg: "ok",
            data: { source: "system", channels: [{ id: "allowed-channel", name: "Allowed", displayName: "Allowed", models: [] }] },
        },
    };
}

function setPersonalConfig() {
    const channel = createModelChannel({ id: "personal-channel", name: "Personal", baseUrl: "https://models.example", apiKey: "synthetic-test-key", models: [] });
    useConfigStore.setState({ config: { ...defaultConfig, channels: [channel] } });
}

afterEach(() => {
    apiClient.request = originalRequest;
    useUserStore.setState({ user: previousUser });
    useConfigStore.setState({ config: previousConfig });
});

test("guest refresh does not request the permission-scoped model catalog", async () => {
    useUserStore.setState({ user: null });
    setPersonalConfig();
    const config = useConfigStore.getState().config;
    let requests = 0;
    apiClient.request = (async () => {
        requests += 1;
        return response();
    }) as typeof apiClient.request;

    await refreshSystemChannels();

    expect(requests).toBe(0);
    expect(useConfigStore.getState().config).toBe(config);
});

test("authenticated refresh merges allowed system channels without losing personal channels", async () => {
    useUserStore.setState({ user });
    setPersonalConfig();
    apiClient.request = (async () => response()) as typeof apiClient.request;

    await refreshSystemChannels();

    const channels = useConfigStore.getState().config.channels;
    expect(channels.find((channel) => channel.id === "allowed-channel")?.scope).toBe("system");
    expect(channels.some((channel) => channel.id === "personal-channel")).toBe(true);
});

test("catalog responses do not overwrite another account or a logged-out session", async () => {
    for (const nextUser of [{ ...user, id: "different-user" }, null]) {
        useUserStore.setState({ user });
        setPersonalConfig();
        const config = useConfigStore.getState().config;
        let respond!: (value: ReturnType<typeof response>) => void;
        apiClient.request = (() => new Promise((resolve) => { respond = resolve; })) as typeof apiClient.request;

        const pending = refreshSystemChannels();
        useUserStore.setState({ user: nextUser });
        respond(response());
        await pending;

        expect(useConfigStore.getState().config).toBe(config);
        expect(config.channels.some((channel) => channel.id === "allowed-channel")).toBe(false);
    }
});

test("catalog errors propagate without replacing local configuration", async () => {
    useUserStore.setState({ user });
    setPersonalConfig();
    const config = useConfigStore.getState().config;
    apiClient.request = (async () => { throw new Error("catalog unavailable"); }) as typeof apiClient.request;

    await expect(refreshSystemChannels()).rejects.toThrow("catalog unavailable");
    expect(useConfigStore.getState().config).toBe(config);
});

test("session hydration skips guest catalog fetching and removes cached system permissions", () => {
    const source = readFileSync(new URL("../src/lib/user-session.ts", import.meta.url), "utf8");
    const hydration = source.split("async function hydrateUserSessionData")[1].split("function isCurrentSession")[0];
    expect(hydration).toMatch(/if \(userId\) \{\s+void \(async \(\) => \{/);
    expect(hydration).toContain("useConfigStore.getState().mergeSystemChannels([])");
    expect(hydration).toContain("if (!isCurrentSession(generation, userId)) return;");
});
