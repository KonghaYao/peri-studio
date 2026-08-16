/**
 * startServer —— MCPP 5.x 之外的部署骨架（MCPP 3.1 承载：一个 server 两项入口）。
 *
 * 双模式（对应 3.3 mcp.json 的 stdio / streamable-http）：
 *   - 默认 streamable HTTP（单会话，Web Standard + Bun.serve）
 *   - `--stdio` 参数或显式 transport 走 stdio
 *
 * HTTP 服务形态说明：v2 SDK 的 streamable HTTP transport 一个实例对应一个会话
 * （session）。单会话部署下由第一个初始化请求建立会话，后续请求复用同一
 * transport。多会话并发请使用 createGateway（packages/mcpp/gateway.ts）。
 */
import {
    McpServer,
    WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

export type StartMode = "http" | "stdio";

export interface StartServerOptions {
    mode?: StartMode;
    host?: string;
    port?: number;
    /** 显式 StdioServerTransport（测试/嵌入场景注入）。 */
    transport?: StdioServerTransport;
    /** 启动完成回调，返回监听地址说明（供日志/测试断言）。 */
    onReady?: (info: { mode: StartMode; url?: string }) => void;
}

/** 从 argv 推断 mode：`--stdio` 即 stdio（与 useStandardMCPP 兼容）。 */
export function inferModeFromArgv(argv: string[], fallback: StartMode = "http"): StartMode {
    return argv.includes("--stdio") ? "stdio" : fallback;
}

async function runHttp(
    server: McpServer,
    options: StartServerOptions,
): Promise<{ url: string }> {
    const host = options.host ?? process.env.HOST ?? "127.0.0.1";
    const port = Number(options.port ?? process.env.PORT ?? 8457);

    // 单会话 transport：一个实例服务一个 session（并发多会话见 gateway）
    const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
    });
    await server.connect(transport);

    Bun.serve({
        hostname: host,
        port,
        async fetch(request) {
            return transport.handleRequest(request);
        },
    });
    const url = `http://${host}:${port}/mcp`;
    return { url };
}

async function runStdio(server: McpServer, options: StartServerOptions): Promise<void> {
    const transport = options.transport ?? new StdioServerTransport();
    await server.connect(transport);
}

/**
 * 启动 server（HTTP 默认 / `--stdio` 切换），异常统一打日志后退出（exit 1）。
 */
export async function startServer(
    server: McpServer,
    options: StartServerOptions = {},
): Promise<{ mode: StartMode; url?: string }> {
    const mode = options.mode ?? inferModeFromArgv(process.argv);
    try {
        if (mode === "stdio") {
            await runStdio(server, options);
            options.onReady?.({ mode });
            return { mode };
        }
        const { url } = await runHttp(server, options);
        options.onReady?.({ mode: "http", url });
        return { mode: "http", url };
    } catch (error) {
        console.error("Fatal: failed to start MCPP server", error);
        process.exit(1);
    }
}

/** 与用例常用入口一致：启动 server 并在 failure 时退出进程。 */
export async function main(server: McpServer, options?: StartServerOptions): Promise<void> {
    await startServer(server, options);
}