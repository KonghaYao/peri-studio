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

    test("Server Cache Version 相等时命中，不相等时拒绝旧条目", () => {
        const cache = new McppCache();
        const listKey = { origin: "server-a", method: "tools/list" };
        const contentKey = {
            origin: "server-a",
            method: "resources/read",
            params: { uri: "skill://demo/SKILL.md" },
        };

        cache.set(listKey, ["demo"], { cacheVersion: "snapshot-v1" });
        cache.set(contentKey, "content-v1", { cacheVersion: "snapshot-v1" });

        expect(cache.get<string[]>(listKey, { cacheVersion: "snapshot-v1" })).toEqual(["demo"]);
        expect(cache.get<string>(contentKey, { cacheVersion: "snapshot-v1" })).toBe("content-v1");
        expect(cache.get(listKey, { cacheVersion: "snapshot-v2" })).toBeUndefined();
        expect(cache.get(contentKey, { cacheVersion: "snapshot-v2", allowStale: true })).toBeUndefined();
    });

    test("Server Cache Version 相等时可命中 TTL 已过期但未 stale 的条目", () => {
        let now = 1_000;
        const cache = new McppCache(() => now);
        const key = { origin: "server-a", method: "resources/list" };
        cache.set(key, ["demo"], { ttlMs: 100, cacheVersion: "snapshot-v1" });

        now += 100;
        expect(cache.get(key)).toBeUndefined();
        expect(cache.get<string[]>(key, { cacheVersion: "snapshot-v1" })).toEqual(["demo"]);

        cache.markOriginStale("server-a", ["resources/list"]);
        expect(cache.get(key, { cacheVersion: "snapshot-v1" })).toBeUndefined();
    });

    test("Server Cache Version 相等不突破 authorization context 隔离", () => {
        const cache = new McppCache();
        const base = { origin: "server-a", method: "skills/list" };
        cache.set({ ...base, authorizationContext: "user-a" }, ["private-a"], {
            scope: "private",
            cacheVersion: "snapshot-v1",
        });

        expect(cache.get<string[]>(
            { ...base, authorizationContext: "user-a" },
            { cacheVersion: "snapshot-v1" },
        )).toEqual(["private-a"]);
        expect(cache.get(
            { ...base, authorizationContext: "user-b" },
            { cacheVersion: "snapshot-v1" },
        )).toBeUndefined();
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
