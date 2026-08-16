/**
 * SKILL.md frontmatter 解析（Agent Skills 规范 + MCPP 4.2 扩展字段）。
 *
 * - frontmatter 以文件首个 `---` 行开始、直到下一个 `---` 行结束；
 * - YAML 解析委托 yaml 包（与规范一致的全量 YAML，而非手写子集）；
 * - 结果仅当对象有效时返回，任何解析失败不会抛错（调用方可决定降级策略）。
 */
import { parse } from "yaml";
import type { SkillFrontmatter } from "../types.ts";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** 提取原始 frontmatter 文本；无 frontmatter 返回 undefined。 */
export function extractFrontmatter(raw: string): string | undefined {
    return FRONTMATTER_RE.exec(raw)?.[1];
}

/**
 * 解析 SKILL.md 的 frontmatter。
 *
 * @param markdown SKILL.md 全文
 * @param fallbackName 解析失败或缺少 name 时使用的名称（如目录名）；缺省则返回 undefined
 */
export function parseSkillFrontmatter(
    markdown: string,
    fallbackName?: string,
): SkillFrontmatter | undefined {
    const text = extractFrontmatter(markdown);
    if (text === undefined) return undefined;
    let value: unknown;
    try {
        value = parse(text);
    } catch {
        return undefined;
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
    const fm = value as Record<string, unknown>;
    const result: SkillFrontmatter = { ...fm };
    // name/description 若缺失则用目录名兜底；仍缺失视为无效（S1）
    if (fallbackName !== undefined && (typeof result.name !== "string" || !result.name)) {
        result.name = fallbackName;
    }
    return result;
}

/** 提取 MCPP 编排字段（io.mcpp/*，存于 metadata 或顶层直写两种形态均兼容）。 */
export function extractMcppMetadata(fm: SkillFrontmatter | undefined): Record<string, unknown> | undefined {
    if (!fm) return undefined;
    const fromMetadata = fm.metadata;
    if (fromMetadata && typeof fromMetadata === "object" && !Array.isArray(fromMetadata)) {
        return fromMetadata as Record<string, unknown>;
    }
    // 顶层直写 io.mcpp/* 键（少见的兼容形态）
    const direct: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fm)) {
        if (k.startsWith("io.mcpp/")) direct[k] = v;
    }
    return Object.keys(direct).length ? direct : undefined;
}