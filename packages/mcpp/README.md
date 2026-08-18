# @peri-code/mcpp

MCPP（MCP Plus）的 Server 侧 TypeScript 参考实现。该包基于 MCP SDK，提供 Skills 资源挂载、MCP Server 双模式启动、多 Server HTTP 网关，以及 Agent Plugin 清单校验。

> 当前状态：`0.2.0`。MCPP 规范仍处于 Draft 阶段，API 可能随规范演进而调整。

## 功能

- **Skills 资源挂载**：将 `skills/<name>/SKILL.md` 实时投影为 `skill://<name>/SKILL.md` MCP Resource。
- **Skills 元数据处理**：解析 frontmatter、提取 `io.mcpp/*` 编排字段、生成 SHA-256 digest。
- **双模式 Server 启动**：默认使用 Streamable HTTP，也可通过 `--stdio` 或配置切换到 stdio。
- **多 Server HTTP 网关**：在单个端口上按路径挂载多个 MCP endpoint，并隔离各 endpoint、各客户端会话。
- **Serverless 路由**：提供标准 `fetch(Request): Promise<Response>` handler，可嵌入 Worker 或其他 Web Standard 运行时。
- **插件清单校验**：使用 Zod 校验 Agent Plugin 的 `plugin.json` 与 `mcp.json`。

完整规范见仓库根目录的 [`MCPP.md`](../../MCPP.md)。

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
    ResourceForSkills,
    startServer,
} from "@peri-code/mcpp";

const createServer = () => {
    const server = new McpServer({
        name: "example-mcpp-server",
        version: "0.1.0",
    });

    ResourceForSkills(server, {
        skillsDir: new URL("./skills", import.meta.url).pathname,
    });
    return server;
};

const started = await startServer(createServer);
```

默认监听 `127.0.0.1:8457`，仅接受 MCP `2026-07-28`。旧版请求会以 `-32022` 拒绝。可通过选项或环境变量修改地址：

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
```

安全约束：

- 只扫描 `skills/` 的直接子目录，不递归发现更深层 Skill。
- 每个目录必须包含根级 `SKILL.md`。
- Skill 名只允许字母、数字、下划线和连字符，长度为 1–64。
- URI 中的 Skill 名经过白名单校验，防止路径穿越。

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

- 路径会被规范化，例如 `review/mcp/` 转为 `/review/mcp`。
- 重复路径会在启动时抛出错误。
- 未注册路径返回 `404`。
- MCP `2025-era` 请求统一以 unsupported protocol version 拒绝。
- 不使用 `mcp-session-id`；0728 请求按协议要求自描述。
- 不同 endpoint 的 Server 实例和 subscription 总线相互隔离。

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
| `@peri-code/mcpp/skills` | Skills 扫描、frontmatter、URI、digest 与 Resource 挂载 |
| `@peri-code/mcpp/server` | `startServer`、`main` 与启动类型 |
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
