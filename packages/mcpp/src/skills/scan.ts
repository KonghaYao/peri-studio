/**
 * skills 目录扫描（MCPP 双通道 A：`skills/` 打包技能，3.4）。
 *
 * 通道 A 布局：客户端只扫描 `skills/` 的**直接子目录**，不递归更深处
 * （agent-plugins.org 规则；MCPP 3.4）。每个直接子目录必须含根级 SKILL.md
 * 才算一个 skill（S1）。
 */
import { readdir, stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
    isValidSkillName,
} from "../types.ts";
import type {
    SkillFrontmatter,
    SkillMeta,
    McppMetadata,
} from "../types.ts";
import { parseSkillFrontmatter, extractMcppMetadata } from "./frontmatter.ts";
import { skillUri } from "./skill-uri.ts";
import { computeDigest } from "./digest.ts";

/** 读取单个 skill 目录的完整元信息；SKILL.md 缺失/不可读/无 name 时返回 undefined。 */
export async function readSkillMeta(
    skillsDir: string,
    dirName: string,
    opts?: { withDigest?: boolean },
): Promise<SkillMeta | undefined> {
    if (!isValidSkillName(dirName)) return undefined;
    const file = join(skillsDir, dirName, "SKILL.md");
    try {
        const [raw, st] = await Promise.all([
            readFile(file, "utf-8"),
            stat(file),
        ]);
        const frontmatter = parseSkillFrontmatter(raw, dirName);
        if (!frontmatter || typeof frontmatter.name !== "string" || !frontmatter.name) {
            return undefined;
        }
        return {
            name: frontmatter.name,
            description: typeof frontmatter.description === "string" ? frontmatter.description : undefined,
            frontmatter: frontmatter as SkillFrontmatter,
            mcpp: extractMcppMetadata(frontmatter) as McppMetadata | undefined,
            uri: skillUri(frontmatter.name),
            size: st.size,
            digest: opts?.withDigest ? await computeDigest(raw) : undefined,
        };
    } catch {
        return undefined;
    }
}

/**
 * 实时扫描 skills 目录（每次调用遍历 + 校验，不做启动期快照）：
 * 子目录且含有效 SKILL.md 才计入，按名称确定性排序（S6 的确定性顺序）。
 * Discovery 层默认不计算 SHA-256（渐进披露）；编排/校验场景传 opts.withDigest。
 */
export async function scanSkillsDir(
    skillsDir: string,
    opts?: { withDigest?: boolean },
): Promise<SkillMeta[]> {
    let entries;
    try {
        entries = await readdir(skillsDir, { withFileTypes: true });
    } catch {
        // 目录不存在或不可读：视为空技能集，避免 server 启动失败（3.5 失败隔离）
        return [];
    }
    const metas = await Promise.all(
        entries
            .filter((e) => e.isDirectory())
            .map((e) => readSkillMeta(skillsDir, e.name, opts)),
    );
    const skills = metas.filter((m): m is SkillMeta => m !== undefined);
    return skills.sort((a, b) => a.name.localeCompare(b.name));
}