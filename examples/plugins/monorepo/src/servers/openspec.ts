/**
 * openspec 子 server —— 把 openspec/ 下的 OpenSpec skills 挂载为 resources
 * （MCPP 3.4 通道 B 投影），经聚合网关在 /openspec/mcp 端点暴露。
 *
 * 来源：Fission-AI/OpenSpec 的 skills 集合（驱动 `openspec` CLI 的工作流，
 * 13 个 openspec-* skill，见 openspec/skills/README.md）。本项目作为
 * 第三方 skills 集直接投放：任何客户端连上该端点即可发现与读取 SKILL.md。
 *
 * 与 office 一致：skills/ 目录的每个子目录（含 SKILL.md）即一个 skill，
 * 列表/读取实时按目录扫描，新增 skill 无需重启。
 */
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import { ResourceForSkills } from "@peri/mcpp";

/** 构造 openspec 子 server；skillsDir 固定指向聚合项目下的 openspec/skills。 */
export function createOpenspecServer(): McpServer {
    const server = new McpServer(
        { name: "openspec-recipes", version: "1.0.0" },
        {
            instructions:
                "Exposes OpenSpec workflow skills (openspec-*) as resources. " +
                "Read skill://{skillName}/SKILL.md to load the workflow.",
        },
    );

    ResourceForSkills(server, {
        skillsDir: resolve(import.meta.dir, "..", "..", "openspec", "skills"),
    });

    return server;
}