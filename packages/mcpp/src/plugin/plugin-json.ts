/**
 * plugin.json（manifest）校验 —— MCPP 3.2（Agent Plugins 1.0.0 闭合字段集）。
 *
 * 校验语义与 agent-plugins.org 对齐：
 *  - 未知顶层字段：非 schema 违规（报告并忽略，不使插件失效）；
 *  - name 违反规则（1–64、小写字母/数字/连字符/点、首尾字母数字、无 `--`/`..`）：
 *    属于 schema 违规（拒绝整个插件）。
 */
import { z } from "zod";
import type { ValidationResult } from "./result.ts";

export const pluginNameRe = /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/;

const authorSchema = z
    .object({
        name: z.string().optional(),
        email: z.string().email().optional(),
        url: z.string().url().optional(),
    })
    .strict()
    .optional();

export const pluginManifestSchema = z
    .object({
        $schema: z.string().optional(),
        name: z
            .string()
            .min(1)
            .max(64)
            .refine(
                (v) => pluginNameRe.test(v) && !v.includes("--") && !v.includes(".."),
                "name: 1-64 字符，小写字母/数字/连字符/点，首尾字母数字，不得含 -- 或 ..",
            ),
        version: z.string().optional(), // 推荐 SemVer
        description: z.string().optional(),
        author: authorSchema,
        homepage: z.string().url().optional(),
        repository: z.string().url().optional(),
        license: z.string().optional(), // 推荐 SPDX 表达式
        keywords: z.array(z.string()).optional(),
        /** 客户端扩展数据：reverse-domain 命名空间（agent-plugins.org 1.0）。 */
        extensions: z.record(z.string(), z.unknown()).optional(),
    })
    .strict();

export type PluginManifest = z.infer<typeof pluginManifestSchema>;

function toResult<T>(
    parsed:
        | { success: true; data: T }
        | { success: false; error: z.ZodError },
): ValidationResult<T> {
    if (parsed.success) return { ok: true, value: parsed.data };
    return {
        ok: false,
        errors: parsed.error.issues.map(
            (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
        ),
    };
}

export function validatePluginJson(input: unknown): ValidationResult<PluginManifest> {
    // schema 容忍未知顶层字段：先剥离未知键再校验（报告忽略，不使插件失效）
    const known = new Set(
        Object.keys(pluginManifestSchema.shape) as string[],
    );
    const knownOnly =
        typeof input === "object" && input !== null && !Array.isArray(input)
            ? Object.fromEntries(
                  Object.entries(input as Record<string, unknown>).filter(
                      ([k]) => known.has(k),
                  ),
              )
            : input;
    return toResult(pluginManifestSchema.safeParse(knownOnly));
}