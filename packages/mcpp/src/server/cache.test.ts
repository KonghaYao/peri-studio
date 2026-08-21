import { describe, expect, test } from "bun:test";
import type { McpRequestContext, McpServer } from "@modelcontextprotocol/server";
import { MCPP_SERVER_CACHE_VERSION_EXTENSION } from "../types.ts";
import { createCacheVersion, createMcppServerFactory } from "./cache.ts";
import { DEFAULT_MCPP_CACHE_TTL_MS } from "./defaults.ts";

const context = { era: "modern" } as McpRequestContext;
const server = {} as McpServer;

describe("createCacheVersion", () => {
    test("对象键顺序不影响 SHA-256 Server Cache Version", async () => {
        const first = await createCacheVersion({
            schemaVersion: "1",
            tools: [{ name: "search", description: "Search" }],
            resourceContentDigests: {
                "skill://review/SKILL.md": "sha256:content-a",
                "skill://search/SKILL.md": "sha256:content-b",
            },
        });
        const second = await createCacheVersion({
            resourceContentDigests: {
                "skill://search/SKILL.md": "sha256:content-b",
                "skill://review/SKILL.md": "sha256:content-a",
            },
            tools: [{ description: "Search", name: "search" }],
            schemaVersion: "1",
        });

        expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(second).toBe(first);
    });

    test("内容 digest 或数组顺序变化会改变 Server Cache Version", async () => {
        const original = await createCacheVersion({
            skills: ["review", "search"],
            resourceContentDigests: { "skill://review/SKILL.md": "sha256:content-a" },
        });
        const contentChanged = await createCacheVersion({
            skills: ["review", "search"],
            resourceContentDigests: { "skill://review/SKILL.md": "sha256:content-b" },
        });
        const orderChanged = await createCacheVersion({
            skills: ["search", "review"],
            resourceContentDigests: { "skill://review/SKILL.md": "sha256:content-a" },
        });

        expect(contentChanged).not.toBe(original);
        expect(orderChanged).not.toBe(original);
    });

    test("拒绝无法跨运行时稳定序列化的值", async () => {
        await expect(createCacheVersion({ tools: { value: undefined } as never })).rejects.toThrow("undefined");
        await expect(createCacheVersion({ tools: Number.NaN })).rejects.toThrow("finite numbers");
        await expect(createCacheVersion({ tools: new Date() as never })).rejects.toThrow("plain objects");
    });
});

describe("createMcppServerFactory", () => {
    test("默认提供 Server Cache Version、共享 MCPP Cache 和一天 TTL", async () => {
        const contexts: Parameters<Parameters<typeof createMcppServerFactory>[1]>[1][] = [];
        const factory = createMcppServerFactory(
            { cacheVersion: "snapshot-v1" },
            (_request, mcpp) => {
                contexts.push(mcpp);
                return server;
            },
        );

        await factory(context);
        await factory(context);

        const first = contexts[0];
        const second = contexts[1];
        expect(first).toBeDefined();
        expect(second).toBeDefined();
        if (!first || !second) throw new Error("Expected two MCPP server cache contexts");
        expect(first.cache).toBe(second.cache);
        expect(first.ttlMs).toBe(DEFAULT_MCPP_CACHE_TTL_MS);
        expect(first.resourceCache).toEqual({
            cache: first.cache,
            cacheVersion: "snapshot-v1",
            ttlMs: DEFAULT_MCPP_CACHE_TTL_MS,
            cacheScope: "public",
            authorizationContext: undefined,
        });
        expect(first.capabilities.extensions?.[MCPP_SERVER_CACHE_VERSION_EXTENSION]).toEqual({
            cacheVersion: "snapshot-v1",
        });
    });

    test("允许覆盖 TTL，并强制 private cache 提供 authorization context", async () => {
        const invalidFactory = createMcppServerFactory(
            { cacheVersion: "snapshot-v1", scope: "private" },
            () => server,
        );
        expect(() => invalidFactory(context)).toThrow("opaque authorization context");

        const factory = createMcppServerFactory(
            {
                cacheVersion: "snapshot-v1",
                ttlMs: 5_000,
                scope: "private",
                authorizationContext: () => "principal-opaque-id",
            },
            (_request, mcpp) => {
                expect(mcpp.resourceCache.ttlMs).toBe(5_000);
                expect(mcpp.resourceCache.authorizationContext).toBe("principal-opaque-id");
                return server;
            },
        );
        await factory(context);
    });
});
