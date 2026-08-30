# CLAUDE.md


## 核心工程原则

1. **架构与领域优先**：计划阶段应以理想架构为目标，明确业务目标、领域边界、模块职责、依赖方向和数据流，形成符合领域规律、面向长期维护且可持续演进的设计后再进入编码；不得以短期实现便利牺牲整体设计。
2. **追求优雅的代码模块**：模块应高内聚、低耦合，通过精简且稳定的接口封装内部复杂度，使职责、命名、依赖和扩展方式清晰自然；代码按单一职责拆分，单个文件不得超过 500 行，接近上限时应优先重构模块边界。
3. **保持边界与数据流清晰**：协议模型、领域模型、持久化模型和视图模型不得相互泄漏；数据必须在边界处完成校验和独立转换，避免跨层共享可变状态。
4. **安全与隔离默认开启**：所有功能均按多租户、多用户场景设计，明确认证、授权和数据隔离边界；遵循最小权限原则，任何外部输入均视为不可信，敏感信息不得进入代码、日志或响应。
5. **面向并发与故障设计**：后端应主动考虑幂等性、竞态、事务边界、超时、取消、重试、背压和资源释放；不得通过无边界重试、吞错或隐式共享状态掩盖问题。
6. **保障完整前端体验**：前端应控制渲染成本、异步状态和并发请求，保持清晰的 UI 结构；用户流程必须覆盖加载、空状态、错误、重试、反馈和可访问性。
7. **复用稳定的业务语义**：优先复用已有模块和能力，但不要仅因代码外形相似而过早抽象；确需重复时，必须注释说明其独立演进或暂不抽象的原因。
8. **为未来维护者保留上下文**：代码、注释、测试和架构文档是跨越时间的协作媒介。非显然的设计决策、兼容约束、已知缺陷和临时方案，必须记录原因、影响范围、潜在风险及移除条件；技术债务应关联可追踪任务，关键架构决策应同步到 ADR，禁止留下缺少上下文的 `TODO`。
9. **确保变更可验证、可观测、可回滚**：每项改动都应行为可测试、运行状态可观测、故障可定位，并兼顾向后兼容和回滚路径；错误与日志必须保留诊断上下文，但不得泄露敏感信息。

本文件为 Claude Code 提供项目上下文。项目所有文档、commit message 均为中文，请沿用。但项目中的 ui 前端，后端的 log 均需要使用英文。

## 项目概览

Peri Studio 是 ACP agent 的持久 Web 工作台（仓库名 peri-studio，产品名 Peri Studio）：server 负责认证、project/session 元数据、运行实例编排与 Yjs 只读投影；SolidJS Web 只消费 server 事实，不在浏览器里伪造对话历史。产品只发布一个 `peri-studio` 可执行文件，但保留 server / instance 两种进程角色：server 是中心控制面，instance 是实际运行 ACP 进程的宿主 daemon，二者经 WebSocket 联通。本地模式由 server 启动同一文件的 `connect` 子进程并走真实协议回连；远程连接必须优先使用 TLS。

## 仓库结构

- `app/`（peri-studio）：唯一产品二进制、CLI、OS signal、本地进程监督与运行角色装配
- `proto/`（peri-studio-proto）：共享协议 crate——ws 帧、HMAC 双向认证、RPC schema、Yjs 同步，三端共用的事实源
- `server/`（peri-studio-server library）：中心控制面运行时，模块按职责拆分：`auth`（token/审计）、`channel`（命令协调、runtime 生命周期、catalog 同步）、`control`（registry、心跳）、`persist`（SQLite、outbox）、`protocol`（ACP 通道）、`state`、`web`；`build.rs` 编译期内嵌 `web/dist` 产物
- `instance/`（peri-instance library）：运行 ACP 子进程的宿主运行时；仅测试辅助二进制 `test-child` 独立存在
- `web/`：SolidJS 单页 SPA（**五层目录**：`app` / `pages` / `widgets` / `features` / `entities` / `shared` + `store`；权威规范见 `docs/design/frontend-architecture.md` 与根目录 `AGENTS.md`）。`panel/` 仅遗留 shim 与待迁 `lib`，**禁止在此新增业务实现**
- `docs/`：`architecture.md`（权威架构基准，v2.14 与实现对齐）、`terminology.md`（唯一权威术语表）、`topology.md`、`adr/`、`design/`（设计决策与验证证据）
- `scripts/`：契约测试与端到端验证脚本（含 release 打包）
- `dev.sh`：一键启动 server + instance 并校验就绪

**本地启动权限**：`dev.sh` 只能由用户在本地终端手动执行。Agent 不得调用
`./dev.sh`、重启其进程或通过后台 shell 代执行；需要运行时验证时应停止并请用户执行。
Agent 可以阅读或修改脚本，以及运行不启动 server/instance 的静态检查，但不得启动
本地 server 或 instance。

## 技术栈

- 后端：Rust 2021 workspace + tokio + sqlx(SQLite) + yrs(Yjs) + tracing + clap；依赖版本单一事实源在根 `Cargo.toml` 的 `[workspace.dependencies]`
- 前端：SolidJS + Tailwind v4 + Vite + Yjs，Bun 管理依赖与脚本；构建产物内嵌进 server，不单独部署
- 测试：Rust 侧模块内联 `*_test.rs` + `tests/` 契约/集成测试；Web 侧 vitest 单测 + `node --test` 协议测试 + Playwright 浏览器测试

## 常用命令

```bash
# 一键开发（重建 Web → 启动 server + instance，http://127.0.0.1:8456/）
./dev.sh

# Web（Bun）
cd web && bun run test        # typecheck + node --test + vitest + 生产边界校验
bun run test:browser          # Playwright 浏览器契约
bun run build                 # 生成 web/dist（cargo 构建前必须先执行）

# Rust workspace
cargo test -p peri-studio-proto
cargo test -p peri-studio-server --lib
cargo test -p peri-instance
cargo clippy --workspace --all-targets -- -D warnings   # 必须零告警

# 唯一产品 CLI
cargo run -q -p peri-studio -- local
cargo run -q -p peri-studio -- serve --local
cargo run -q -p peri-studio -- connect https://peri.example --token-file /secure/instance.token
cargo run -q -p peri-studio -- token generate --name web --role full
cargo run -q -p peri-studio -- status --json | --ready
```

自定义目录/端口用环境变量：`PERI_STUDIO_CONFIG_DIR`、`PERI_STUDIO_DATA_DIR`、`PERI_STUDIO_LISTEN_ADDR`、`PERI_STUDIO_LISTEN_PORT`；远程 instance 连接地址由 `connect <URL>` 显式提供。

## 关键架构契约

权威细节见 `docs/architecture.md` 与 `docs/terminology.md`，改动架构语义前必须阅读并同步这两份文档：

- **术语以 terminology.md 为准**：`session` 特指 ACP 进程内的会话；`chat` 是 server 侧对话容器；`project`/`project session` 是 Web 侧持久分组/入口。代码标识符、ws 帧、持久化格式一律使用本表术语。
- **四层身份不可互换**：`project_id` / `project_session_id` / ACP `session_id` / `chat_id` 各有边界；server 重启后不复活旧 runtime，打开持久入口必须以精确 ACP session id 走 `session/load`。
- **SQLite 是唯一落盘产物**：`<data_dir>/metadata.sqlite3` 持有 project/session 元数据与全局 commandId 去重；per-chat Yjs 投影与 outbox 均为内存态，崩溃恢复由 ACP 重放提供，不复制第二份持久事实。
- **副作用边界**：runtime create 横跨 Hub chat 状态、instance child 与 ACP durable thread；`session/new` 一旦可能进入 ACP stdin，kill child 也不能证明 thread 未创建，命令必须收敛为 `DELIVERY_UNKNOWN` 且禁止自动重放。客户端以同一 `commandId` 重发不得产生重复副作用。
- **安全边界**：loopback 明文 HTTP/ws 仅限本机；非回环 `connect` 默认要求 `wss`，`--allow-insecure` 只用于受控测试网络；`/api/health` 的 peer 与 Host 必须同为 loopback；token（`full`/`instance` 等角色）不得进入代码、日志、issue 或聊天记录；浏览器会话用 HttpOnly opaque cookie；日志不得泄露敏感信息。

## Web 前端分层规范（必读）

**权威文档**：`docs/design/frontend-architecture.md`（目录、依赖、迁移）；`docs/design/ui-specification.md`（**视觉、token、组件、微文案**）；`AGENTS.md`（Agent 检查清单）。ADR：`docs/adr/0004-web-frontend-layered-architecture.md`。

| 层 | 路径 | 职责 |
|----|------|------|
| 外壳 | `web/src/app/` | `main.tsx`、全局样式入口 |
| 页面 | `web/src/pages/` | 路由级装配，只组合 widgets |
| 业务组件 | `web/src/widgets/` | Solid 组合块（shell / chat / composer / sidebar / auth / resource） |
| 特性 | `web/src/features/` | 纯 TS 领域用例；**禁止 import store**（依赖注入） |
| 实体 | `web/src/entities/` | Yjs 只读投影（chat / registry / resource / topology） |
| 共享 | `web/src/shared/` | `ui` 设计系统、`lib`、`protocol`、`yjs` |
| 组合根 | `web/src/store/index.ts` | 全局信号与 `install*` 装配；业务逻辑委托 features |

**硬规则**：依赖只能自上而下（`shared` → `entities` → `features` → `widgets` → `pages` → `app`）；`widgets` 不得直发协议帧；新代码用 `@/` 路径别名，勿在 `panel/` 下新增实现。UI 颜色/间距/组件须符合 `ui-specification.md`；改 Web 结构须同步 `architecture.md` §10.2。

## 代码与测试约定

- Rust 模块按单一职责拆分（参考 `server/src/channel` 各模块的拆分粒度），单元测试以 `*_test.rs` 与模块同目录内联；代码注释用中文，日志用英文。
- Web：组合根在 `web/src/store/index.ts`；feature/entity 测 `src/features`、`src/entities`；widget 测 `src/widgets`；契约测 `web/tests/*.test.mjs`；浏览器用 `bun run test:browser`。提交前 `cd web && bun run test`。
- 设计决策与验证证据同步到 `docs/design/`；历史功能计划文档（f1~f6）已有意删除（git 历史可溯），架构演进记录以 `docs/architecture.md` 的版本修订（v2.x 标注）为准。
- `web/dist`、`.tmp/`、`.peri/` 不提交 git；`cargo` 构建依赖 `web/dist` 就绪（缺失时 build.rs 直接编译失败并提示构建命令）。

## 构建与发布

- 升级以唯一 `peri-studio` 文件为原子发布物；后台双任务部署仍先重启 server 角色、确认恢复后再重启 connect 角色，最后 `status --ready` 验收。instance hello 显式携带协议版本，版本不匹配以稳定错误码 `protocol_version_mismatch` 拒绝。
- Release：`.github/workflows/ci.yml` 执行 Web、浏览器、供应链与 locked Rust 门禁；`peri-studio-v<workspace-version>` 触发 `.github/workflows/release.yml`，在 Linux/macOS 构建、双次打包比对、生成 SPDX SBOM 与 provenance attestation。对应本地产物链依次执行 cargo-deny、浏览器契约、Web 测试与构建、`cargo test --workspace --locked`、release 构建，再由 `scripts/package-release.sh` 打包、`scripts/verify-release.sh` 验证。产物排除 `test-child`、token、配置与运行数据。
