import { parse } from "yaml";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const AGENT_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const ORGANIZATION_PREFIX_RE = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9.-]{0,61}[a-zA-Z0-9])?)$/;

export const AGENT_URI_TEMPLATE = "agent://{agentName}/agent.md";

export interface AgentFrontmatter {
    name: string;
    description: string;
    tools?: string[];
    disallowedTools?: string[];
    model?: string;
    skills?: string[];
    maxTurns?: number;
    metadata?: Record<string, unknown>;
    [key: string]: unknown;
}

export interface AgentMeta {
    name: string;
    description: string;
    frontmatter: AgentFrontmatter;
    uri: string;
    size: number;
}

export function isValidAgentName(name: string): boolean {
    return AGENT_NAME_RE.test(name);
}

export function isValidAgentOrganizationPrefix(prefix: string): boolean {
    return ORGANIZATION_PREFIX_RE.test(prefix);
}

export function agentUri(agentName: string, organizationPrefix?: string): string {
    return organizationPrefix
        ? `agent://${organizationPrefix}/${agentName}/agent.md`
        : `agent://${agentName}/agent.md`;
}

export function agentUriTemplate(organizationPrefix?: string): string {
    return organizationPrefix
        ? `agent://${organizationPrefix}/{agentName}/agent.md`
        : AGENT_URI_TEMPLATE;
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.length > 0);
}

/** 解析并校验 MCP Agents v1 标准字段；未知宿主字段按规范保留透传。 */
export function parseAgentFrontmatter(markdown: string): AgentFrontmatter | undefined {
    const source = FRONTMATTER_RE.exec(markdown)?.[1];
    if (source === undefined) return undefined;

    let value: unknown;
    try {
        value = parse(source);
    } catch {
        return undefined;
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;

    const frontmatter = value as Record<string, unknown>;
    if (
        typeof frontmatter.name !== "string" ||
        !isValidAgentName(frontmatter.name) ||
        typeof frontmatter.description !== "string" ||
        frontmatter.description.trim().length === 0
    ) {
        return undefined;
    }
    for (const field of ["tools", "disallowedTools", "skills"] as const) {
        const fieldValue = frontmatter[field];
        if (fieldValue !== undefined && !isStringArray(fieldValue)) return undefined;
    }
    if (frontmatter.model !== undefined && (typeof frontmatter.model !== "string" || !frontmatter.model)) {
        return undefined;
    }
    if (
        frontmatter.maxTurns !== undefined &&
        (!Number.isSafeInteger(frontmatter.maxTurns) || (frontmatter.maxTurns as number) <= 0)
    ) {
        return undefined;
    }
    if (
        frontmatter.metadata !== undefined &&
        (frontmatter.metadata === null || typeof frontmatter.metadata !== "object" || Array.isArray(frontmatter.metadata))
    ) {
        return undefined;
    }

    return frontmatter as AgentFrontmatter;
}
