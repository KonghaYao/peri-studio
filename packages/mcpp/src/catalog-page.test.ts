import { describe, expect, test } from "bun:test";
import {
    createCatalogPageHandler,
    renderCatalogPage,
} from "./catalog-page.ts";

describe("Catalog 页面 helper", () => {
    test("生成同源 Catalog 与 Child MCP 发现页面", () => {
        const html = renderCatalogPage({ catalogPath: "/directory/mcp" });

        expect(html).toContain("https://cdn.tailwindcss.com");
        expect(html).toContain('const catalogPath = "/directory/mcp"');
        expect(html).toContain("mcpp/servers/list");
        expect(html).toContain("mcpp/servers/resolve");
        expect(html).toContain("server/discover");
        expect(html).toContain("tools/list");
        expect(html).toContain("resources/list");
        expect(html).toContain("id=\"skills\"");
        expect(html).toContain("id=\"normal-resources\"");
        expect(html).toContain("function partitionResources(items)");
        expect(html).toContain('resource.name || resource.title');
        expect(html).toContain('data-role="badges"');
    });

    test("只在配置页面路径响应 GET 与 HEAD", async () => {
        const handle = createCatalogPageHandler({
            pagePath: "/catalog",
            catalogPath: "/directory/mcp",
        });

        const get = handle(new Request("https://example.test/catalog"));
        expect(get.status).toBe(200);
        expect(get.headers.get("content-type")).toBe("text/html; charset=utf-8");
        expect(get.headers.get("cache-control")).toBe("no-store");
        expect(await get.text()).toContain('const catalogPath = "/directory/mcp"');

        const head = handle(new Request("https://example.test/catalog", { method: "HEAD" }));
        expect(head.status).toBe(200);
        expect(await head.text()).toBe("");

        expect(handle(new Request("https://example.test/other")).status).toBe(404);
        expect(handle(new Request("https://example.test/catalog", { method: "POST" })).status).toBe(405);
    });

    test("拒绝不安全的页面与 Catalog 路径", () => {
        expect(() => renderCatalogPage({ catalogPath: "https://other.example/catalog/mcp" })).toThrow();
        expect(() => renderCatalogPage({ catalogPath: "//other.example/catalog/mcp" })).toThrow();
        expect(() => createCatalogPageHandler({ pagePath: "/../catalog" })).toThrow();
    });
});
