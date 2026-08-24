import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import {
    agentUri,
    isValidAgentName,
    parseAgentFrontmatter,
    type AgentMeta,
} from "./agent.ts";

export const DEFAULT_MAX_AGENT_BYTES = 256 * 1024;

export interface AgentScanOptions {
    /** 单个 agent.md 最大字节数，默认 256 KiB。 */
    maxAgentBytes?: number;
    /** agent:// URI 的可选组织命名空间。 */
    organizationPrefix?: string;
}

const UTF8 = new TextDecoder("utf-8", { fatal: true });

function resolveMaxAgentBytes(value: number | undefined): number {
    if (value === undefined) return DEFAULT_MAX_AGENT_BYTES;
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error("MCPP agent resources: maxAgentBytes must be a positive safe integer");
    }
    return value;
}

function isInside(root: string, target: string): boolean {
    const path = relative(root, target);
    return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !path.includes(`..${sep}`));
}

async function readValidatedAgent(
    agentsDir: string,
    agentName: string,
    options: AgentScanOptions,
): Promise<{ meta: AgentMeta; text: string } | undefined> {
    if (!isValidAgentName(agentName)) return undefined;
    const maxAgentBytes = resolveMaxAgentBytes(options.maxAgentBytes);

    try {
        const agentsRoot = await realpath(agentsDir);
        const declaredAgentRoot = join(agentsDir, agentName);
        const agentRootStat = await lstat(declaredAgentRoot);
        if (!agentRootStat.isDirectory() || agentRootStat.isSymbolicLink()) return undefined;

        const agentRoot = await realpath(declaredAgentRoot);
        if (!isInside(agentsRoot, agentRoot)) return undefined;

        const file = join(agentRoot, "agent.md");
        const fileStat = await lstat(file);
        if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size > maxAgentBytes) return undefined;

        const resolvedFile = await realpath(file);
        if (!isInside(agentRoot, resolvedFile)) return undefined;
        const bytes = await readFile(resolvedFile);
        if (bytes.byteLength !== fileStat.size) return undefined;
        const text = UTF8.decode(bytes);

        const frontmatter = parseAgentFrontmatter(text);
        if (!frontmatter || frontmatter.name !== agentName) return undefined;

        return {
            meta: {
                name: frontmatter.name,
                description: frontmatter.description,
                frontmatter,
                uri: agentUri(agentName, options.organizationPrefix),
                size: fileStat.size,
            },
            text,
        };
    } catch {
        return undefined;
    }
}

/** 安全读取单个 agents/<name>/agent.md；无效配置与越界路径均视为不存在。 */
export async function readAgentMeta(
    agentsDir: string,
    agentName: string,
    options: AgentScanOptions = {},
): Promise<AgentMeta | undefined> {
    return (await readValidatedAgent(agentsDir, agentName, options))?.meta;
}

/** 实时扫描 agents 目录的直接子目录，并按名称确定性排序。 */
export async function scanAgentsDir(
    agentsDir: string,
    options: AgentScanOptions = {},
): Promise<AgentMeta[]> {
    // 先解析配置，即使目录不存在也应尽早报告错误的预算参数。
    resolveMaxAgentBytes(options.maxAgentBytes);

    let entries;
    try {
        entries = await readdir(agentsDir, { withFileTypes: true });
    } catch {
        return [];
    }

    const agents = await Promise.all(
        entries
            .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
            .map((entry) => readAgentMeta(agentsDir, entry.name, options)),
    );
    return agents
        .filter((agent): agent is AgentMeta => agent !== undefined)
        .sort((left, right) => left.name.localeCompare(right.name));
}

/** 激活阶段读取完整 agent.md，读取时重新执行路径、大小与 frontmatter 校验。 */
export async function readAgentResource(
    agentsDir: string,
    agentName: string,
    options: AgentScanOptions = {},
): Promise<{ uri: string; mimeType: "text/markdown"; text: string } | undefined> {
    const resource = await readValidatedAgent(agentsDir, agentName, options);
    if (!resource) return undefined;
    return { uri: resource.meta.uri, mimeType: "text/markdown", text: resource.text };
}
