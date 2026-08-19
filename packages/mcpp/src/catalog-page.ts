/**
 * Server Catalog 页面 helper —— 仅消费同源的只读 Catalog 与 Child MCP 元数据。
 *
 * 页面不读取 Resource 正文、不调用 Tool；Catalog resolve 后才连接 Child endpoint。
 * HTML 模板独立维护，TypeScript 只负责安全注入同源路径和构造 Web Standard Response。
 */
import pageTemplateBundle from "./catalog-page.html" with { type: "text" };

// Bun 的 text import 运行时值为 string；当前类型声明把它标为 HTMLBundle。
const pageTemplate = pageTemplateBundle as unknown as string;

export const DEFAULT_CATALOG_PAGE_PATH = "/";
export const DEFAULT_CATALOG_ENDPOINT_PATH = "/catalog/mcp";

export interface CatalogPageOptions {
    /** Catalog MCP 的同源相对路径，默认 "/catalog/mcp"。 */
    catalogPath?: string;
    /** HTTP 页面路径，默认根路径 "/"。 */
    pagePath?: string;
}

function normalizeRelativePath(path: string, label: string): string {
    const normalized = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
    if (
        !/^\/[A-Za-z0-9._~!$&'()*+,;=:@/-]*$/.test(normalized) ||
        normalized.startsWith("//") ||
        normalized.split("/").some((segment) => segment === "." || segment === "..")
    ) {
        throw new Error(`MCPP catalog page: ${label} must be a safe absolute path`);
    }
    return normalized;
}

function scriptValue(value: string): string {
    return JSON.stringify(value)
        .replaceAll("<", "\\u003c")
        .replaceAll(">", "\\u003e")
        .replaceAll("&", "\\u0026");
}

/**
 * 生成无需前端构建链的 Catalog 检查页面。HTML 由独立模板提供，页面调用
 * mcpp/servers/list、resolve，并直接向已解析的 Child endpoint 发现工具与资源。
 */
export function renderCatalogPage(options: CatalogPageOptions = {}): string {
    const catalogPath = normalizeRelativePath(
        options.catalogPath ?? DEFAULT_CATALOG_ENDPOINT_PATH,
        "catalogPath",
    );
    const placeholder = "__MCPP_CATALOG_PATH__";
    if (!pageTemplate.includes(placeholder)) {
        throw new Error("MCPP catalog page: template is missing its catalog path placeholder");
    }
    return pageTemplate.replace(placeholder, scriptValue(catalogPath));
}

/** 创建可直接传给 GatewayOptions.fallback 的 Catalog 页面 handler。 */
export function createCatalogPageHandler(options: CatalogPageOptions = {}): (request: Request) => Response {
    const pagePath = normalizeRelativePath(options.pagePath ?? DEFAULT_CATALOG_PAGE_PATH, "pagePath");
    const html = renderCatalogPage(options);
    const headers = {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
    };

    return (request) => {
        const path = new URL(request.url).pathname;
        if (path !== pagePath) {
            return new Response("MCPP Catalog page: route not found", { status: 404 });
        }
        if (request.method === "HEAD") return new Response(null, { headers });
        if (request.method !== "GET") {
            return new Response("Method not allowed", {
                status: 405,
                headers: { ...headers, allow: "GET, HEAD" },
            });
        }
        return new Response(html, { headers });
    };
}
