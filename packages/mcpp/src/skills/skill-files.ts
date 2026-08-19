/**
 * Skill 目录内文件的受限递归投影。
 *
 * SKILL.md 是唯一的 Skill 入口；其他普通文件都是按需读取 Resource。扫描拒绝
 * 符号链接、隐藏路径和超出预算的文件，避免把构建缓存、凭据或宿主目录外内容
 * 意外暴露给 MCP client。文件扩展名和目录名不参与发现决策。
 */
import type { Dirent } from "node:fs";
import {
    lstat,
    readdir,
    readFile,
    realpath,
} from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { isValidSkillName } from "../types.ts";
import {
    classifySkillResourceFile,
    resolveSkillResourceOptions,
    type SkillResourceContentKind,
    type SkillResourceLimits,
    type SkillResourceScanOptions,
} from "./resource-policy.ts";
import { scanSkillsDir } from "./scan.ts";
import { skillFileUri } from "./skill-uri.ts";

export type {
    SkillResourceContentKind,
    SkillResourceLimits,
    SkillResourceScanOptions,
} from "./resource-policy.ts";

export interface SkillResourceFile {
    skillName: string;
    /** 相对 Skill 根目录的规范路径，例如 references/guide.md。 */
    relativePath: string;
    uri: string;
    /** 只有根 SKILL.md 为 skill，其他均为附属文件。 */
    kind: "skill" | "file";
    name: string;
    description?: string;
    mimeType: string;
    contentKind: SkillResourceContentKind;
    size: number;
}

export interface ReadSkillResourceFile {
    uri: string;
    mimeType: string;
    contentKind: SkillResourceContentKind;
    /** text 文件的 UTF-8 内容。 */
    text?: string;
    /** blob 文件的 base64 内容。 */
    blob?: string;
}

type Budget = {
    files: number;
    bytes: number;
};

const UTF8 = new TextDecoder("utf-8", { fatal: true });

function isSafeRelativePath(path: string): boolean {
    if (!path || path.includes("\\") || path.includes("\0")) return false;
    return path.split("/").every((segment) => (
        segment.length > 0 &&
        segment !== "." &&
        segment !== ".." &&
        !segment.startsWith(".") &&
        segment !== "node_modules"
    ));
}

function isInside(root: string, target: string): boolean {
    const path = relative(root, target);
    return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !path.includes(`..${sep}`));
}

function normalizedDirectoryEntries(entries: readonly Dirent[]): string[] {
    return entries
        .filter((entry) => !entry.name.startsWith(".") && entry.name !== "node_modules")
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));
}

async function collectCandidates(
    root: string,
    directory: string,
    state: { scannedEntries: number; maxScannedEntries: number },
    candidates: Array<{ relativePath: string; absolutePath: string; size: number }>,
): Promise<void> {
    if (state.scannedEntries >= state.maxScannedEntries) return;

    let entries: Dirent[];
    try {
        entries = await readdir(directory, { withFileTypes: true });
    } catch {
        return;
    }

    for (const name of normalizedDirectoryEntries(entries)) {
        if (state.scannedEntries >= state.maxScannedEntries) return;
        state.scannedEntries += 1;

        const absolutePath = join(directory, name);
        const relativePath = relative(root, absolutePath).split(sep).join("/");
        if (!isSafeRelativePath(relativePath)) continue;

        let entry;
        try {
            entry = await lstat(absolutePath);
        } catch {
            continue;
        }
        if (entry.isSymbolicLink()) continue;

        if (entry.isDirectory()) {
            await collectCandidates(root, absolutePath, state, candidates);
            continue;
        }
        if (!entry.isFile()) continue;
        if (relativePath === "SKILL.md") continue;

        candidates.push({ relativePath, absolutePath, size: entry.size });
    }
}

async function safeSkillRoot(skillsDir: string, skillName: string): Promise<string | undefined> {
    if (!isValidSkillName(skillName)) return undefined;
    try {
        const declaredRoot = join(skillsDir, skillName);
        const directory = await lstat(declaredRoot);
        if (!directory.isDirectory() || directory.isSymbolicLink()) return undefined;

        const root = await realpath(declaredRoot);
        const skillsRoot = await realpath(skillsDir);
        return isInside(skillsRoot, root) ? root : undefined;
    } catch {
        return undefined;
    }
}

async function safeFile(root: string, relativePath: string): Promise<string | undefined> {
    if (!isSafeRelativePath(relativePath)) return undefined;
    const segments = relativePath.split("/");
    let directory = root;
    try {
        // lstat 每一级父目录，避免批准目录在扫描后被替换成内部符号链接。
        for (const segment of segments.slice(0, -1)) {
            directory = join(directory, segment);
            const parent = await lstat(directory);
            if (!parent.isDirectory() || parent.isSymbolicLink()) return undefined;
        }

        const requestedPath = join(root, ...segments);
        const requested = await lstat(requestedPath);
        if (!requested.isFile() || requested.isSymbolicLink()) return undefined;

        const path = await realpath(requestedPath);
        if (!isInside(root, path)) return undefined;
        const file = await lstat(path);
        return file.isFile() && !file.isSymbolicLink() ? path : undefined;
    } catch {
        return undefined;
    }
}

async function contentKindForFile(path: string): Promise<SkillResourceContentKind | undefined> {
    try {
        const data = await readFile(path);
        if (data.includes(0)) return "blob";
        try {
            UTF8.decode(data);
            return "text";
        } catch {
            return "blob";
        }
    } catch {
        return undefined;
    }
}

function fileMeta(
    skillName: string,
    relativePath: string,
    size: number,
    description: string | undefined,
    contentKind: SkillResourceContentKind,
): SkillResourceFile {
    const classification = classifySkillResourceFile(relativePath, contentKind);
    const isSkill = relativePath === "SKILL.md";

    return {
        skillName,
        relativePath,
        uri: skillFileUri(skillName, relativePath),
        kind: isSkill ? "skill" : "file",
        name: isSkill ? skillName : relativePath,
        description: isSkill ? description : `Skill file: ${relativePath}`,
        mimeType: classification.mimeType,
        contentKind: classification.contentKind,
        size,
    };
}

/**
 * 列出可传递的 Skill 文件。返回顺序稳定：Skill 名、根 SKILL.md、其余相对路径。
 * 不符合安全或预算限制的文件不会作为 MCP Resource 暴露。
 */
export async function scanSkillResourceFiles(
    skillsDir: string,
    options?: SkillResourceScanOptions,
): Promise<SkillResourceFile[]> {
    const { limits } = resolveSkillResourceOptions(options);
    const skills = await scanSkillsDir(skillsDir);
    const output: SkillResourceFile[] = [];
    const total: Budget = { files: 0, bytes: 0 };

    for (const skill of skills) {
        if (total.files >= limits.maxTotalFiles || total.bytes >= limits.maxTotalBytes) break;
        const root = await safeSkillRoot(skillsDir, skill.name);
        if (!root) continue;

        const entryPath = join(root, "SKILL.md");
        let entryStat;
        try {
            entryStat = await lstat(entryPath);
        } catch {
            continue;
        }
        if (!entryStat.isFile() || entryStat.isSymbolicLink()) continue;

        const candidates = [{
            relativePath: "SKILL.md",
            absolutePath: entryPath,
            size: entryStat.size,
        }];
        const state = {
            scannedEntries: 0,
            maxScannedEntries: limits.maxScannedEntriesPerSkill,
        };
        await collectCandidates(root, root, state, candidates);
        candidates.sort((left, right) => {
            if (left.relativePath === "SKILL.md") return -1;
            if (right.relativePath === "SKILL.md") return 1;
            return left.relativePath.localeCompare(right.relativePath);
        });

        const entry = candidates.find((candidate) => candidate.relativePath === "SKILL.md");
        const entryContentKind = entry ? await contentKindForFile(entry.absolutePath) : undefined;
        if (
            !entry ||
            entryContentKind !== "text" ||
            entry.size > limits.maxFileBytes ||
            entry.size > limits.maxSkillBytes ||
            total.files >= limits.maxTotalFiles ||
            total.bytes + entry.size > limits.maxTotalBytes ||
            !await safeFile(root, entry.relativePath)
        ) {
            continue;
        }

        const skillBudget: Budget = { files: 0, bytes: 0 };
        for (const candidate of candidates) {
            if (candidate.size > limits.maxFileBytes) continue;
            const safePath = await safeFile(root, candidate.relativePath);
            if (!safePath) continue;
            const contentKind = await contentKindForFile(safePath);
            if (!contentKind) continue;
            const meta = fileMeta(
                skill.name,
                candidate.relativePath,
                candidate.size,
                skill.description,
                contentKind,
            );
            if (
                skillBudget.files >= limits.maxSkillFiles ||
                skillBudget.bytes + candidate.size > limits.maxSkillBytes ||
                total.files >= limits.maxTotalFiles ||
                total.bytes + candidate.size > limits.maxTotalBytes
            ) {
                continue;
            }

            // safeFile 在分类前完成 realpath 与逐级 lstat 校验，抵御扫描后的链接替换。
            output.push(meta);
            skillBudget.files += 1;
            skillBudget.bytes += candidate.size;
            total.files += 1;
            total.bytes += candidate.size;
        }
    }

    return output;
}

/**
 * 读取已通过安全与预算限制的单个 Skill Resource。该函数会重新扫描并校验，因此目录变更后
 * 不会沿用旧的公开清单；未知、过限或不安全文件与不存在资源等价。
 */
export async function readSkillResourceFile(
    skillsDir: string,
    skillName: string,
    relativePath: string,
    options?: SkillResourceScanOptions,
): Promise<ReadSkillResourceFile | undefined> {
    const resources = await scanSkillResourceFiles(skillsDir, options);
    const meta = resources.find((resource) => (
        resource.skillName === skillName && resource.relativePath === relativePath
    ));
    if (!meta) return undefined;

    const root = await safeSkillRoot(skillsDir, skillName);
    if (!root) return undefined;
    const file = await safeFile(root, relativePath);
    if (!file) return undefined;

    try {
        const data = await readFile(file);
        if (data.byteLength !== meta.size) return undefined;
        if (meta.contentKind === "text") {
            if (data.includes(0)) return undefined;
            let text: string;
            try {
                text = UTF8.decode(data);
            } catch {
                return undefined;
            }
            return { uri: meta.uri, mimeType: meta.mimeType, contentKind: "text", text };
        }
        return { uri: meta.uri, mimeType: meta.mimeType, contentKind: "blob", blob: data.toString("base64") };
    } catch {
        return undefined;
    }
}
