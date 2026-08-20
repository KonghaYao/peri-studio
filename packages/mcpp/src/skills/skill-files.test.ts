import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import { McppCache } from "../cache.ts";
import { createGatewayRoutes } from "../gateway.ts";
import { ResourceForSkills } from "./ResourceForSkills.ts";
import {
    readSkillResourceFile,
    scanSkillResourceFiles,
} from "./skill-files.ts";
import {
    buildStaticSkillResources,
    renderStaticSkillResourcesModule,
} from "./build-static-skills.ts";
import {
    createStaticSkillResources,
    ResourceForStaticSkills,
} from "./static-skills.ts";
import {
    decodeSkillFilePath,
    skillFileUri,
} from "./skill-uri.ts";

const protocolVersion = "2026-07-28";

type Gateway = ReturnType<typeof createGatewayRoutes>;

async function request(
    gateway: Gateway,
    method: string,
    params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": protocolVersion,
        "Mcp-Method": method,
    };
    if (typeof params.uri === "string") headers["Mcp-Name"] = params.uri;

    const response = await gateway.fetch(
        new Request("http://localhost/skills/mcp", {
            method: "POST",
            headers,
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: method,
                method,
                params: {
                    ...params,
                    _meta: {
                        "io.modelcontextprotocol/protocolVersion": protocolVersion,
                        "io.modelcontextprotocol/clientInfo": { name: "skill-files-test", version: "1" },
                        "io.modelcontextprotocol/clientCapabilities": {},
                    },
                },
            }),
        }),
    );
    const body = await response.text();
    expect(response.status, body).toBe(200);
    const payload = JSON.parse(body) as { result?: Record<string, unknown>; error?: unknown };
    expect(payload.error).toBeUndefined();
    return payload.result ?? {};
}

async function createFixture(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "mcpp-skill-resources-"));
    const skillRoot = join(root, "demo");
    await Promise.all([
        mkdir(join(skillRoot, "references"), { recursive: true }),
        mkdir(join(skillRoot, "scripts"), { recursive: true }),
        mkdir(join(skillRoot, "assets"), { recursive: true }),
        mkdir(join(skillRoot, "private"), { recursive: true }),
        mkdir(join(skillRoot, "automation", "nested"), { recursive: true }),
    ]);
    await Promise.all([
        writeFile(join(skillRoot, "SKILL.md"), "---\nname: demo\ndescription: Demo skill\n---\n\n# Demo\n"),
        writeFile(join(skillRoot, "references", "guide.md"), "# Guide\n"),
        writeFile(join(skillRoot, "references", "中文 文档.md"), "# 中文\n"),
        writeFile(join(skillRoot, "run.js"), "export default 'run';\n"),
        writeFile(join(skillRoot, "automation", "nested", "check.py"), "print('checked')\n"),
        writeFile(join(skillRoot, "automation", "nested", "instructions.custom"), "custom instructions\n"),
        writeFile(join(skillRoot, "automation", "nested", "payload.data"), Buffer.from([0, 1, 2])),
        writeFile(join(skillRoot, "private", "notes.md"), "must not be exposed by default\n"),
        writeFile(join(skillRoot, ".private.md"), "must not be exposed\n"),
        writeFile(join(skillRoot, "fake-text.md"), Buffer.from([0, 1, 2])),
        writeFile(join(skillRoot, "secret.bin"), Buffer.from([0, 1, 2])),
    ]);
    await symlink(join(root, "outside"), join(skillRoot, "references", "outside-link"));
    await writeFile(join(root, "outside"), "outside data\n");
    return root;
}

describe("Skill 目录附属 Resource 投影", () => {
    test("递归枚举 Skill 根内的普通文件，拒绝隐藏路径与符号链接", async () => {
        const root = await createFixture();
        try {
            const files = await scanSkillResourceFiles(root);
            expect(files.map((file) => file.uri)).toEqual([
                "skill://demo/SKILL.md",
                "skill://demo/automation/nested/check.py",
                "skill://demo/automation/nested/instructions.custom",
                "skill://demo/automation/nested/payload.data",
                "skill://demo/fake-text.md",
                "skill://demo/private/notes.md",
                "skill://demo/references/guide.md",
                "skill://demo/references/%E4%B8%AD%E6%96%87%20%E6%96%87%E6%A1%A3.md",
                "skill://demo/run.js",
                "skill://demo/secret.bin",
            ]);
            expect(files.find((file) => file.relativePath === "SKILL.md")?.kind).toBe("skill");
            expect(files.find((file) => file.relativePath === "automation/nested/check.py")?.mimeType).toBe("text/x-python");
            expect(files.find((file) => file.relativePath === "automation/nested/instructions.custom")).toMatchObject({
                mimeType: "text/plain",
                contentKind: "text",
            });
            expect(files.find((file) => file.relativePath === "fake-text.md")).toMatchObject({
                mimeType: "application/octet-stream",
                contentKind: "blob",
            });
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("读取任意目录与未知扩展名的附属文件，且不允许绕过 Skill 根", async () => {
        const root = await createFixture();
        try {
            const reference = await readSkillResourceFile(root, "demo", "references/中文 文档.md");
            expect(reference).toMatchObject({
                uri: "skill://demo/references/%E4%B8%AD%E6%96%87%20%E6%96%87%E6%A1%A3.md",
                mimeType: "text/markdown",
                text: "# 中文\n",
            });

            const script = await readSkillResourceFile(root, "demo", "automation/nested/check.py");
            expect(script).toMatchObject({
                mimeType: "text/x-python",
                text: "print('checked')\n",
            });
            const binary = await readSkillResourceFile(root, "demo", "automation/nested/payload.data");
            expect(binary).toMatchObject({
                mimeType: "application/octet-stream",
                blob: "AAEC",
            });
            expect(await readSkillResourceFile(root, "demo", "references/outside-link")).toBeUndefined();
            expect(decodeSkillFilePath("references/%2E%2E/secret.md")).toBeUndefined();
            expect(decodeSkillFilePath("references%2Fsecret.md")).toBeUndefined();
            expect(skillFileUri("demo", "references/中文 文档.md")).toBe(
                "skill://demo/references/%E4%B8%AD%E6%96%87%20%E6%96%87%E6%A1%A3.md",
            );
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("普通目录默认可公开", async () => {
        const root = await createFixture();
        try {
            expect((await scanSkillResourceFiles(root)).some((file) => file.relativePath === "private/notes.md")).toBe(true);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("拒绝被符号链接替换的 Skill 根或子目录", async () => {
        const root = await createFixture();
        const skillRoot = join(root, "demo");
        const references = join(skillRoot, "references");
        const referenceBackup = join(skillRoot, "references-safe");
        const rootBackup = join(root, "demo-safe");
        try {
            await rename(references, referenceBackup);
            await symlink(referenceBackup, references);
            expect((await scanSkillResourceFiles(root))
                .some((file) => file.relativePath.startsWith("references/"))).toBe(false);

            await rm(references);
            await rename(skillRoot, rootBackup);
            await symlink(rootBackup, skillRoot);
            expect(await scanSkillResourceFiles(root)).toEqual([]);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("根 SKILL.md 不可公开时，不单独公开附属文件", async () => {
        const root = await createFixture();
        try {
            expect(await scanSkillResourceFiles(root, { maxFileBytes: 8 })).toEqual([]);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("静态 registry 跨 Server 实例按 TTL 缓存资源列表和读取结果", async () => {
        const root = await createFixture();
        let now = 1_000;
        const cache = new McppCache(() => now);
        const resources = await buildStaticSkillResources(root);
        const gateway = createGatewayRoutes([{
            path: "/skills/mcp",
            createServer: () => {
                const server = new McpServer({ name: "static-skill-cache-fixture", version: "1" });
                ResourceForStaticSkills(server, {
                    resources,
                    cache,
                    origin: "static-skill-cache-fixture",
                    ttlMs: 100,
                });
                return server;
            },
        }]);
        try {
            await request(gateway, "resources/list", {});
            await request(gateway, "resources/read", { uri: "skill://demo/SKILL.md" });
            const listKey = {
                origin: "static-skill-cache-fixture",
                method: "resources/templates/list",
                params: { template: "skill://{skillName}/{+path}" },
            };
            const readKey = {
                origin: "static-skill-cache-fixture",
                method: "resources/read",
                params: { uri: "skill://demo/SKILL.md" },
            };
            expect(cache.get(listKey)).toBeDefined();
            expect(cache.get(readKey)).toBeDefined();

            now += 100;
            expect(cache.get(listKey)).toBeUndefined();
            expect(cache.get(readKey)).toBeUndefined();

            await request(gateway, "resources/list", {});
            await request(gateway, "resources/read", { uri: "skill://demo/SKILL.md" });
            expect(cache.get(listKey)).toBeDefined();
            expect(cache.get(readKey)).toBeDefined();
        } finally {
            await gateway.close();
            await rm(root, { recursive: true, force: true });
        }
    });

    test("构建期 registry 在删除源目录后仍可供 Worker 形态读取", async () => {
        const root = await createFixture();
        const resources = await buildStaticSkillResources(root);
        const gateway = createGatewayRoutes([{
            path: "/skills/mcp",
            createServer: () => {
                const server = new McpServer({ name: "static-skill-fixture", version: "1" });
                ResourceForStaticSkills(server, { resources });
                return server;
            },
        }]);
        try {
            const reference = resources.find((resource) => resource.relativePath === "references/guide.md");
            expect(resources).toHaveLength(10);
            expect(reference).toBeDefined();
            expect(createStaticSkillResources([
                ...resources,
                { ...reference!, skillName: "orphan", uri: "skill://orphan/references/guide.md" },
                { ...reference!, relativePath: ".hidden.md", uri: "skill://demo/.hidden.md" },
            ]).some((resource) => (
                resource.skillName === "orphan" || resource.relativePath === ".hidden.md"
            ))).toBe(false);
            expect(renderStaticSkillResourcesModule(resources)).toContain("STATIC_SKILL_RESOURCES");

            await rm(root, { recursive: true, force: true });
            const listed = await request(gateway, "resources/list", {});
            expect((listed.resources as Array<{ uri: string }>).map((resource) => resource.uri)).toContain(
                "skill://demo/references/guide.md",
            );
            const read = await request(gateway, "resources/read", {
                uri: "skill://demo/references/guide.md",
            });
            expect(read.contents).toEqual([{
                uri: "skill://demo/references/guide.md",
                mimeType: "text/markdown",
                text: "# Guide\n",
            }]);
        } finally {
            await gateway.close();
            await rm(root, { recursive: true, force: true });
        }
    });

    test("通过 MCP resources/list 和 resources/read 传递附属文件", async () => {
        const root = await createFixture();
        const gateway = createGatewayRoutes([{
            path: "/skills/mcp",
            createServer: () => {
                const server = new McpServer({ name: "skill-fixture", version: "1" });
                ResourceForSkills(server, { skillsDir: root });
                return server;
            },
        }]);
        try {
            await request(gateway, "server/discover", {});
            const listed = await request(gateway, "resources/list", {});
            const resources = listed.resources as Array<{ uri: string; name: string }>;
            expect(resources.some((resource) => (
                resource.uri === "skill://demo/references/guide.md" &&
                resource.name === "references/guide.md"
            ))).toBe(true);
            expect(resources.some((resource) => (
                resource.uri === "skill://demo/SKILL.md" &&
                resource.name === "demo"
            ))).toBe(true);

            const read = await request(gateway, "resources/read", {
                uri: "skill://demo/references/guide.md",
            });
            expect(read.contents).toEqual([{
                uri: "skill://demo/references/guide.md",
                mimeType: "text/markdown",
                text: "# Guide\n",
            }]);
        } finally {
            await gateway.close();
            await rm(root, { recursive: true, force: true });
        }
    });
});
