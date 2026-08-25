# @peri-code/mcpp

MCPP（MCP Plus）的 Server 侧 TypeScript 参考实现。该包基于 MCP SDK，提供 Skills 资源挂载、MCP Server 双模式启动、多 Server HTTP 网关，以及 Agent Plugin 清单校验。

> 当前状态：`0.6.5`。MCPP 规范仍处于 Draft 阶段，API 可能随规范演进而调整。

## 版本更新

| 版本 | 主要更新 |
| --- | --- |
| `0.6.5` | 为 `ResourceForStaticSkills` 增加与实时 Skills 一致的 MCPP Cache（`McppCache`）、TTL、`public` / `private` scope 和 opaque authorization context 隔离；同时支持协商 Server Cache Version（`cacheVersion`），相等时可直接复用 MCPP Response Cache 与 Resource Content Cache，不相等时拒绝旧条目。 |
| `0.5.0` | 引入统一的进程内 `McppCache`；实时 `ResourceForSkills` 支持按 origin、MCP method、参数和授权上下文隔离缓存，并可按 Resource URI 精确失效。 |
| `0.3.0` | 支持将 Skill 根内全部经安全校验的普通文件投影为附属 Resource；新增构建期静态 registry，使无本地文件系统的 Worker 可以挂载 Skills。 |

升级到 `0.6.5` 时，缓存仅在调用方显式传入 `cache` 后启用。`cacheScope: "private"` 必须同时提供由宿主生成的、不含 token、cookie 或其他凭据的 opaque `authorizationContext`。

## 功能

- **Skills 资源挂载**：将 `skills/<name>/SKILL.md` 及其目录内经过安全与预算限制的所有普通文件实时投影为 `skill://<name>/<path>` MCP Resource。
- **Agents 资源挂载**：将通过 frontmatter、UTF-8、大小和路径安全校验的 `agents/<name>/agent.md` 实时投影为 `agent://<name>/agent.md` MCP Resource。
- **Skills 元数据处理**：解析 frontmatter、提取 `io.mcpp/*` 编排字段、生成 SHA-256 digest。
- **双模式 Server 启动**：默认使用 Streamable HTTP，也可通过 `--stdio` 或配置切换到 stdio。
- **多 Server HTTP 网关**：在单个端口上按路径挂载多个 MCP endpoint，并隔离各 endpoint、各客户端会话。
- **Server Catalog**：从静态挂载表派生只读目录，支持 Child MCP 的列表、查询和 content-bound 连接解析；不下发、安装、启动、provision 或代理能力。
- **Server Catalog 页面 helper**：提供无需构建链的、可嵌入 Bun / Worker 的同源 Catalog 检查页面；页面只发现 Child MCP 的 Tools / Resources 元数据与生成连接配置。
- **Serverless 路由**：提供标准 `fetch(Request): Promise<Response>` handler，可嵌入 Worker 或其他 Web Standard 运行时。
- **插件清单校验**：使用 Zod 校验 Agent Plugin 的 `plugin.json` 与 `mcp.json`。

完整规范见 [`MCPP/index.md`](../../MCPP/index.md)。相关主题包括 [Agent Plugin](../../MCPP/agent-plugin.md)、[MCP Mono Server](../../MCPP/mcp-mono-server.md)、[MCP Channel](../../MCPP/mcp-channel.md) 和 [Channel SDK 接口](../../MCPP/channel-sdk.md)。

## 运行要求

- Bun
- TypeScript 7
- `@modelcontextprotocol/server` 2.x

## 安装

该包当前作为 monorepo workspace 使用。在仓库根目录安装依赖：

```bash
bun install
```

workspace 内的其他包可以直接引用：

```ts
import { ResourceForSkills } from "@peri-code/mcpp/skills";
```

## 快速开始

### 挂载 Skills 并启动 Server

目录约定：

```text
my-plugin/
├── server.ts
└── skills/
    └── code-review/
        └── SKILL.md
```

`SKILL.md` 至少包含 `name` 和 `description`：

```md
---
name: code-review
description: 审查代码并给出可执行的改进建议
metadata:
  io.mcpp/version: "1.0.0"
  io.mcpp/tools:
    required:
      - read_file
---

# Code Review

按照项目约定审查代码，优先识别正确性、安全性和可维护性问题。
```

创建并启动 MCP Server：

```ts
import { McpServer } from "@modelcontextprotocol/server";
import {
    createCacheVersion,
    createMcppServerFactory,
    ResourceForAgents,
    ResourceForSkills,
    startServer,
} from "@peri-code/mcpp";

const cacheVersion = await createCacheVersion({
    schemaVersion: "1",
    skills: bundledSkillMetadata,
    resourceContentDigests: bundledSkillDigests,
});

const createServer = createMcppServerFactory(
    { cacheVersion },
    (_request, mcpp) => {
        const server = new McpServer(
            {
                name: "example-mcpp-server",
                version: "0.1.0",
            },
            { capabilities: mcpp.capabilities },
        );

        ResourceForSkills(server, {
            skillsDir: new URL("./skills", import.meta.url).pathname,
            origin: "example-mcpp-server",
            ...mcpp.resourceCache,
        });
        ResourceForAgents(server, {
            agentsDir: new URL("./agents", import.meta.url).pathname,
            origin: "example-mcpp-server",
            ...mcpp.resourceCache,
        });
        return server;
    },
);

const started = await startServer(createServer);
```

默认监听 `127.0.0.1:8457`，仅接受 MCP `2026-07-28`。`createCacheVersion` 会确定性排序对象键，并对完整可缓存状态计算 `sha256:<hex>`；数组顺序保留语义。示例中的 `bundledSkillMetadata` 是规范化 Skill 目录，`bundledSkillDigests` 是 Resource URI 到内容 digest 的映射。调用方应确保输入覆盖 tools、prompts、resources、skills 及所有可缓存内容，避免内容变化但 Server Cache Version 未变化。

`createMcppServerFactory` 在请求级 `McpServer` 实例之外共享 MCPP Response Cache 与 Resource Content Cache，默认 TTL 为 1 天；`cacheVersion` 相等时可跨连接复用。调用方可通过 `ttlMs` 覆盖默认值，设为 `0` 可禁用条目写入。旧版请求会以 `-32022` 拒绝。可通过选项或环境变量修改地址：

```ts
await startServer(createServer, {
    mode: "http",
    host: "127.0.0.1",
    port: 9000,
});
```

支持的环境变量：

- `HOST`：默认 `127.0.0.1`
- `PORT`：默认 `8457`

切换到 stdio：

```bash
bun run server.ts --stdio
```

也可以显式指定：

```ts
await startServer(createServer, { mode: "stdio" });
```

HTTP 与 stdio 都由 SDK 的 MCP 2026-07-28 serving entry 承载，并显式设置 `legacy: "reject"`。HTTP 每个请求创建独立 Server 实例，stdio 每条连接固定一个实例。

### Subscription 通知

HTTP 启动句柄暴露 SDK 原生 `subscriptions/listen` 发布端：

```ts
const started = await startServer(createServer);

started.subscriptions?.toolsChanged();
started.subscriptions?.promptsChanged();
started.subscriptions?.resourcesChanged();
started.subscriptions?.resourceUpdated("skill://code-review/SKILL.md");
```

这些方法只向已经通过 `subscriptions/listen` 订阅对应事件的客户端发送通知；没有订阅者时调用是安全的 no-op。多进程部署应通过 `StartServerOptions.bus` 注入共享 `ServerEventBus`。

## Agents API

### `ResourceForAgents(server, options)`

将 `agents/<name>/agent.md` 实时挂载为 `agent://<name>/agent.md`。入口必须是有效 UTF-8 Markdown，frontmatter 的 `name` 必须与目录名一致，并包含非空 `description`；默认单文件上限为 256 KiB。远端 Agent 仍是不可信配置，Host 必须在激活阶段执行 digest 绑定、用户批准和权限收敛。

```ts
ResourceForAgents(server, {
    agentsDir: "/absolute/path/to/agents",
    organizationPrefix: "example.org",
});
```

配置组织前缀后，URI 为 `agent://example.org/<name>/agent.md`。辅助 API 也从 `@peri-code/mcpp/agents` 导出，包括 `scanAgentsDir`、`readAgentMeta`、`readAgentResource`、`parseAgentFrontmatter` 和 `agentUri`。

## Skills API

### `ResourceForSkills(server, options)`

将一个 Skills 目录挂载到 MCP Server。每次执行 Resource 列表或读取操作时都会重新读取目录，因此新增 Skill 不需要重启 Server。

```ts
ResourceForSkills(server, {
    skillsDir: "/absolute/path/to/skills",
    namePrefix: "project",
});
```

挂载后的资源 URI：

```text
skill://code-review/SKILL.md
skill://code-review/references/checklist.md
skill://code-review/scripts/verify.py
skill://code-review/assets/diagram.svg
skill://code-review/templates/report.json
```

只有根 `SKILL.md` 是 Skill 入口；其余 URI 均是附属 Resource，必须由 Agent 按需读取，不能据此获得执行权限。

`ResourceForSkills` 默认递归公开 Skill 根内的**全部普通文件**（目录名与扩展名不参与发现决策）。如需收紧，可设置 `resourceLimits` 的预算上限（无法用目录白名单控制，规避文件会绕过预算校验）：

```ts
ResourceForSkills(server, {
    skillsDir: "/absolute/path/to/skills",
    resourceLimits: {
        maxFileBytes: 512 * 1024,
        maxSkillBytes: 4 * 1024 * 1024,
        maxSkillFiles: 64,
    },
});
```

安全约束：

- 只扫描 `skills/` 的直接子目录，不递归发现更深层 Skill；每个目录必须有通过 frontmatter 校验的根 `SKILL.md`。
- Skill 根内除 `SKILL.md` 外的全部普通文件均为可发现 Resource：有效 UTF-8 文本按扩展名取精确 MIME（未知扩展名退化为 `text/plain`）；二进制按内容判定为 blob（已知图片取 `image/*`，其余为 `application/octet-stream`）。扩展名只影响 MIME 映射，不决定文件是否可发现或按文本/二进制呈现。
- 隐藏路径、`node_modules`、`..` 穿越、反斜杠/NUL、符号链接及指向 Skill 根外的解析结果均被拒绝；SKILL.md 必须是可读 UTF-8 文本。
- 默认限制为：单文件 1 MiB、单 Skill 8 MiB / 128 文件、一次挂载总计 32 MiB / 1024 文件、每 Skill 扫描 1024 个目录项；读取时会重新扫描、检查路径和内容，降低扫描后替换的风险。
- scripts 作为 Resource 可读取不表示可以执行；执行仍须经过独立 Tool 与批准流程。

### `ResourceForStaticSkills(server, options)`：Worker 构建期投影

Worker 没有可用的本地文件系统时，不能使用 `ResourceForSkills` 的实时扫描。构建阶段用 `buildStaticSkillResources()` 收集同一套预算/安全校验后的文件，将结果写成源码；运行时以 `ResourceForStaticSkills()` 挂载该表。

```ts
// scripts/generate-skills-registry.ts（构建阶段）
import { writeFile } from "node:fs/promises";
import {
    buildStaticSkillResources,
    renderStaticSkillResourcesModule,
} from "@peri-code/mcpp/skills/build";

const resources = await buildStaticSkillResources("./skills");
await writeFile(
    "./src/static-skills.generated.ts",
    renderStaticSkillResourcesModule(resources),
);
```

```ts
// Worker 运行时
import { McppCache } from "@peri-code/mcpp";
import { ResourceForStaticSkills } from "@peri-code/mcpp/skills/static";
import { STATIC_SKILL_RESOURCES } from "./static-skills.generated.ts";

// 在 Server factory 外创建，才能跨 HTTP 请求创建的 Server 实例复用缓存。
const cache = new McppCache();

ResourceForStaticSkills(server, {
    resources: STATIC_SKILL_RESOURCES,
    cache,
    origin: "example-static-skills",
    ttlMs: 30_000,
});
```

生成步骤必须在 Worker bundle 前执行；静态 registry 会再次校验 URI、内容长度和 Skill 根存在性，孤儿附属文件不会公开。传入 `cache`、稳定的 `origin` 和正数 `ttlMs` 后，`resources/list` 与 `resources/read` 会在 TTL 内复用结果；未传入 `origin` 时不跨 Server 实例复用缓存。

多用户场景使用 `cacheScope: "private"` 时，必须传入宿主生成的 opaque `authorizationContext`。它只能是不可逆的上下文标识，不能包含 token、cookie 或其他凭据。

### `scanSkillsDir(skillsDir, options?)`

扫描并返回按名称排序的 Skill 元数据：

```ts
import { scanSkillsDir } from "@peri-code/mcpp/skills";

const skills = await scanSkillsDir("./skills", {
    withDigest: true,
});

for (const skill of skills) {
    console.log(skill.name, skill.uri, skill.digest);
}
```

默认不计算 digest，以降低 Discovery 阶段的成本。传入 `withDigest: true` 后会生成 `sha256:<hex>` 格式的摘要。

同时提供以下底层能力：

- `readSkillMeta`
- `parseSkillFrontmatter`
- `extractMcppMetadata`
- `skillUri`
- `parseSkillUri`
- `computeDigest`
- `isValidSkillName`

## 多 Server HTTP 网关

`createGateway` 在一个 Bun HTTP Server 上按精确路径挂载多个仅支持 MCP `2026-07-28` 的 Server。每个 HTTP 请求都会通过 `createServer` 创建独立实例，各端点拥有独立的 `subscriptions/listen` 事件总线。

```ts
import { McpServer } from "@modelcontextprotocol/server";
import { createGateway } from "@peri-code/mcpp/gateway";

function createProjectServer() {
    return new McpServer({
        name: "project",
        version: "0.1.0",
    });
}

function createReviewServer() {
    return new McpServer({
        name: "review",
        version: "0.1.0",
    });
}

const gateway = await createGateway(
    [
        { path: "/project/mcp", createServer: createProjectServer },
        { path: "/review/mcp", createServer: createReviewServer },
    ],
    { host: "127.0.0.1", port: 8457 },
);

console.log(gateway.url);

// 发布该端点的变化通知：
gateway.endpoints[0]?.subscriptions.toolsChanged();

// 关闭监听并释放所有 handler：
// await gateway.stop();
```

网关行为：

- 可选 `catalog` 从 `routes[].catalog` 派生同 authority 的只读 `/catalog/mcp`；它仅提供 `mcpp/servers/list`、`mcpp/servers/get`、`mcpp/servers/resolve`，不会下载、安装、启动、provision 或代理 Child MCP。
- 每个 Catalog entry 的 `endpointPath` 固定来自实际挂载路径；`resolve` 需要对 entryDigest 回显校验，避免依据变更后的条目静默连接。

- 路径会被规范化，例如 `review/mcp/` 转为 `/review/mcp`。
- 重复路径会在启动时抛出错误。
- 未注册路径返回 `404`。
- MCP `2025-era` 请求统一以 unsupported protocol version 拒绝。
- 不使用 `mcp-session-id`；0728 请求按协议要求自描述。
- 不同 endpoint 的 Server 实例和 subscription 总线相互隔离。

### Catalog 检查页面 helper

`createCatalogPageHandler` 把只读 Catalog 页面作为 gateway fallback；页面自身只调用
Catalog 的 `list` / `resolve`，并在用户选择后直接向 Child endpoint 发现
`tools/list` 与 `resources/list` 元数据。它不会读取 Resource 内容或调用 Tool，且不依赖
`Bun.file`，因此可复用于 Worker。

```ts
import {
    createCatalogPageHandler,
    createGateway,
} from "@peri-code/mcpp";

const gateway = await createGateway(routes, {
    catalog: { path: "/catalog/mcp" },
    fallback: createCatalogPageHandler({
        pagePath: "/",
        catalogPath: "/catalog/mcp",
    }),
});
```

默认页面路径为 `/`，Catalog 路径为 `/catalog/mcp`。两者只能是同源安全绝对路径；helper
会以 `Cache-Control: no-store` 返回 HTML，避免浏览器使用旧页面脚本。

### Serverless / Web Standard

不需要 Bun 监听进程时，可以只创建路由 handler：

```ts
import { createGatewayRoutes } from "@peri-code/mcpp/gateway";

const gateway = createGatewayRoutes([
    { path: "/project/mcp", createServer: createProjectServer },
]);

export default {
    fetch(request: Request) {
        return gateway.fetch(request);
    },
};
```

每个路由 handler 自己维护进程内 subscription 事件总线。多实例部署应通过各路由的 `bus` 字段注入共享 `ServerEventBus`。

## 插件清单校验

### 校验 `plugin.json`

```ts
import { validatePluginJson } from "@peri-code/mcpp/plugin";

const result = validatePluginJson({
    name: "example-plugin",
    version: "1.0.0",
    description: "Example MCPP plugin",
});

if (!result.ok) {
    console.error(result.errors);
} else {
    console.log(result.value);
}
```

未知顶层字段会被忽略，不会使插件失效。已知字段仍需满足 schema 约束。

### 校验 `mcp.json`

stdio Server：

```ts
import { validateMcpJson } from "@peri-code/mcpp/plugin";

const result = validateMcpJson({
    mcpServers: {
        example: {
            type: "stdio",
            command: "bun",
            args: ["run", "server.ts", "--stdio"],
        },
    },
});
```

Streamable HTTP Server：

```ts
const result = validateMcpJson({
    mcpServers: {
        example: {
            type: "streamable-http",
            url: "http://127.0.0.1:8457/mcp",
        },
    },
});
```

校验器包含以下安全限制：

- stdio 的 `command` 必须是单个可执行 token，不进行 shell 拼接或占位符展开。
- `streamable-http` 与 `sse` 必须提供绝对 HTTP(S) URL。
- 非 loopback 地址必须使用 HTTPS。
- URL 不得包含 userinfo 或 fragment。
- `headers` 禁止 `authorization`、`proxy-authorization`、`cookie`、`x-api-key` 等凭据类字段。

## 导出入口

| 入口 | 内容 |
| --- | --- |
| `@peri-code/mcpp` | 全部公开 API |
| `@peri-code/mcpp/skills` | Skills 扫描、前端元数据、URI、digest、受限 Resource 挂载与纯公开策略 |
| `@peri-code/mcpp/skills/static` | Worker 的构建期静态 Skill Resource 挂载 |
| `@peri-code/mcpp/skills/build` | 仅构建阶段使用的静态 registry 收集与源码生成 |
| `@peri-code/mcpp/server` | 默认 HTTP 地址/端口、`startServer`、`main` 与启动类型 |
| `@peri-code/mcpp/catalog` | 只读 Server Catalog 类型、扩展标识、实现与 Catalog 页面 helper |
| `@peri-code/mcpp/gateway` | HTTP gateway 与 serverless routes |
| `@peri-code/mcpp/plugin` | `plugin.json`、`mcp.json` schema 与校验函数 |

## 开发

在仓库根目录运行：

```bash
bun install
bun run --cwd packages/mcpp typecheck
```

或者进入包目录：

```bash
cd packages/mcpp
bun run typecheck
```

## 已知边界

- 当前实现面向 Server 侧，不包含完整的 Agent/Host 生命周期实现。
- Server 仅支持 MCP `2026-07-28`，不兼容 2025-era 客户端。
- 默认 subscription 总线为进程内存态；多实例部署必须注入共享 `ServerEventBus`。
- Skills 目录不会自动监听文件变化；变更后需由应用调用对应的 `subscriptions` 发布方法。
- MCPP 规范仍为 Draft，使用前应核对仓库根目录的最新规范。
