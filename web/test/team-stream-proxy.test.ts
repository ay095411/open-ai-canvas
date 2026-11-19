import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const nginx = readFileSync(new URL("../../nginx.conf", import.meta.url), "utf8");

function proxyFor(path: string) {
    for (const match of nginx.matchAll(/location ~ (\^[^\s]+) \{([^}]+)\}/g)) {
        if (new RegExp(match[1]).test(path)) return match[2];
    }
    return undefined;
}

test("personal and team text event streams retain the local backend port and streaming boundary", () => {
    for (const path of ["/api/tasks/task-1/text-events", "/api/teams/team-1/workspace/tasks/task-1/text-events", "/api/agent/runs/run-1/events"]) {
        const proxy = proxyFor(path);
        expect(proxy).toBeDefined();
        expect(proxy).toContain("proxy_pass http://backend:8180;");
        expect(proxy).toContain("proxy_buffering off;");
        expect(proxy).toContain("gzip off;");
    }
    expect(proxyFor("/api/teams/team-1/workspace/tasks/task-1")).toBeUndefined();
    expect(proxyFor("/api/teams/team-1/workspace/assets")).toBeUndefined();
});

test("personal and team canvas realtime retain the local backend port and websocket upgrade", () => {
    for (const path of ["/api/canvas-projects/canvas-1/realtime", "/api/teams/team-1/workspace/canvas-projects/canvas-1/realtime"]) {
        const proxy = proxyFor(path);
        expect(proxy).toBeDefined();
        expect(proxy).toContain("proxy_pass http://backend:8180;");
        expect(proxy).toContain("proxy_set_header Upgrade $http_upgrade;");
        expect(proxy).toContain('proxy_set_header Connection "upgrade";');
    }
});
