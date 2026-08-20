import { describe, expect, test } from "bun:test";
import { McppCache } from "./cache.ts";

describe("McppCache", () => {
    test("按稳定参数、origin 和 TTL 复用响应", () => {
        let now = 1_000;
        const cache = new McppCache(() => now);
        const key = { origin: "server-a", method: "resources/read", params: { uri: "skill://demo/SKILL.md" } };

        cache.set<string>(key, "cached", { ttlMs: 100 });
        expect(cache.get<string>(key)).toBe("cached");
        now += 100;
        expect(cache.get(key)).toBeUndefined();
        expect(cache.get<string>(key, { allowStale: true })).toBe("cached");
    });

    test("private entry 按 authorization context 隔离，且通知可失效", () => {
        const cache = new McppCache();
        const base = { origin: "server-a", method: "resources/read", params: { uri: "private://doc" } };
        cache.set<string>({ ...base, authorizationContext: "user-a" }, "a", {
            scope: "private",
            resourceUri: "private://doc",
        });
        cache.set<string>({ ...base, authorizationContext: "user-b" }, "b", {
            scope: "private",
            resourceUri: "private://doc",
        });

        expect(cache.get<string>({ ...base, authorizationContext: "user-a" })).toBe("a");
        expect(cache.get<string>({ ...base, authorizationContext: "user-b" })).toBe("b");
        expect(() => cache.set<string>(base, "missing-context", { scope: "private" })).toThrow();

        cache.markResourceStale("server-a", "private://doc");
        expect(cache.get<string>({ ...base, authorizationContext: "user-a" })).toBeUndefined();
        expect(cache.get<string>({ ...base, authorizationContext: "user-b" }, { allowStale: true })).toBe("b");
    });

    test("list_changed 可使 origin 的目录缓存失效", () => {
        const cache = new McppCache();
        const key = { origin: "server-a", method: "skills/list" };
        cache.set<string[]>(key, ["demo"]);
        cache.markOriginStale("server-a", ["skills/list"]);
        expect(cache.get(key)).toBeUndefined();
        expect(cache.get<string[]>(key, { allowStale: true })).toEqual(["demo"]);
    });
});
