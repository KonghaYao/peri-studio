/**
 * mcp.json 校验 —— MCPP 3.3（MCP 执行承载声明；agent-plugins.org 1.0 闭合格式）。
 *
 * 关键约束：
 *  - `command` 为单个可执行 token（不做 shell 拼装，不展开占位符）；
 *  - `headers` 不得携带凭据类键（MCPP 安全：敏感数据不进 header）；
 *  - 远程 `url` 必须绝对 HTTP(S)；非 loopback 必须 HTTPS。
 */
import { z } from "zod";
import type { ValidationResult } from "./result.ts";

export type McpServerType = "stdio" | "streamable-http" | "sse";

const SENSITIVE_HEADER_KEYS = [
    "authorization",
    "proxy-authorization",
    "cookie",
    "x-api-key",
];

const urlSchema = z
    .string()
    .url("url 必须为绝对 URL")
    .refine(
        (v) => {
            try {
                const u = new URL(v);
                if (u.username || u.password || u.hash) return false;
                if (!/^https?:$/.test(u.protocol)) return false;
                // 非 loopback 必须 TLS
                const hostname = u.hostname;
                const isLoopback =
                    hostname === "localhost" ||
                    hostname === "127.0.0.1" ||
                    hostname === "::1" ||
                    hostname.startsWith("127.");
                if (!isLoopback && u.protocol !== "https:") return false;
                return true;
            } catch {
                return false;
            }
        },
        "url: 绝对 HTTP(S)；非 loopback 必须 HTTPS；不得含 userinfo/fragment",
    );

export const mcpServerSchema = z
    .object({
        type: z.enum(["stdio", "streamable-http", "sse"]).optional(),
        command: z
            .string()
            .refine(
                (v) => /^\S+$/.test(v),
                "command 必须为单个可执行 token（不展开占位符，不做 shell 解析）",
            )
            .optional(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string(), z.string()).optional(),
        cwd: z.string().optional(),
        url: urlSchema.optional(),
        headers: z
            .record(z.string(), z.string())
            .refine(
                (h) => {
                    const lower = Object.keys(h).map((k) => k.toLowerCase());
                    return !lower.some((k) => SENSITIVE_HEADER_KEYS.includes(k));
                },
                `headers 不得携带凭据类键：${SENSITIVE_HEADER_KEYS.join(", ")}`,
            )
            .optional(),
    })
    .strict()
    .refine(
        (s) => {
            const effective = s.type ?? "stdio";
            if (effective === "stdio") return typeof s.command === "string";
            return typeof s.url === "string";
        },
        "stdio 需要 command；streamable-http/sse 需要 url",
    );

export const mcpJsonSchema = z
    .object({
        $schema: z.string().optional(),
        mcpServers: z.record(z.string().min(1), mcpServerSchema),
    })
    .strict();

export type McpServerDecl = z.infer<typeof mcpServerSchema>;
export type McpJson = z.infer<typeof mcpJsonSchema>;

export function validateMcpJson(input: unknown): ValidationResult<McpJson> {
    const parsed = mcpJsonSchema.safeParse(input);
    if (parsed.success) return { ok: true, value: parsed.data };
    return {
        ok: false,
        errors: parsed.error.issues.map(
            (i) =>
                `mcpServers${i.path.map((p) => `[${String(p)}]`).join("")}: ${i.message}`,
        ),
    };
}