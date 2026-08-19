/**
 * OpenSpec Child MCP 的静态 Worker 形态。
 *
 * Resource 正文来自构建期 registry，不访问本地技能目录；修改 `openspec/skills/`
 * 后必须先运行 `bun scripts/generate-skills-registry.ts` 再构建 Worker。
 */
import { McpServer } from "@modelcontextprotocol/server";
import { ResourceForStaticSkills } from "@peri-code/mcpp/skills/static";
import { STATIC_SKILL_RESOURCES } from "./static-skills.generated.ts";

/** 构造不依赖运行时文件系统的 OpenSpec Child MCP。 */
export function createStaticOpenspecServer(): McpServer {
    const server = new McpServer(
        { name: "openspec-recipes", version: "1.0.0" },
        {
            instructions:
                "Exposes OpenSpec workflow skills (openspec-*) as build-time bundled resources. " +
                "Read skill://{skillName}/SKILL.md to load the workflow.",
        },
    );
    ResourceForStaticSkills(server, { resources: STATIC_SKILL_RESOURCES });
    return server;
}
