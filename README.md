# Peri Studio

Peri Studio 是本地 ACP agent 的持久 Web 工作台。server 负责认证、项目/会话元数据、
运行实例编排和 Yjs 只读投影；SolidJS Web 只消费 server 事实，不在浏览器里伪造
对话历史。

## 快速开始

前置环境：Rust toolchain、Bun，以及可由 `peri-instance` 启动的 ACP agent。

```bash
cd peri-studio
./dev.sh
```

`dev.sh` 每次都会重新构建 Web 和 Rust 二进制，随后启动 loopback server 和本地
instance；只有 listener 就绪且 instance 完成认证注册后才会打印“全部就绪”。脚本
只清理自己启动并记录 PID 的进程，不会用进程名终止其他 peri-studio。
如果目标端口已有 listener，脚本会在构建前停止并直接提示打开现有页面或先释放端口；
它不会尝试接管、覆盖或终止那个进程。
默认页面是 <http://127.0.0.1:8456/>；每次运行使用独立的
`.tmp/server.<pid>.log` 和 `.tmp/instance.<pid>.log`，避免旧 daemon 输出污染新一轮
readiness 判定。日志、instance token 和运行时目录以私有 umask 创建。按 `Ctrl+C`
停止本次开发进程。

第一次打开页面需要一个 `full` token。登录页的“令牌在哪里？”会显示**当前
运行 server 实际使用的** token 文件和可复制生成命令；不要猜测配置目录。
也可以在默认配置下执行：

```bash
cargo run -q -p peri-studio-server -- token generate --name web --role full
```

完整 token 只打印一次。它只应粘贴到本机登录页，不要提交到 Git、日志、issue
或聊天记录。浏览器登录成功后使用 HttpOnly opaque cookie 建立会话；token 会
保存在本机浏览器（localStorage）用于下次自动登录，登出即清除，不写入
WebSocket 帧或 URL。

server 仅在 stderr 直连交互终端时显示首次 bootstrap instance token；由
`dev.sh`、systemd 或日志管道启动时不会把它写入日志，只会提示受 `0600` 权限保护的
`tokens.toml` 路径。

## 产品模型

- 左栏只显示由 Hub 创建或由用户明确导入的持久会话；ACP 历史不会自动污染目录。
- project session 是持久入口，ACP session 是 agent thread，runtime chat 是一次进程
  激活；三者身份不可互换。
- server 重启后不会伪装成恢复旧进程。打开持久会话时使用精确 ACP session id
  建立新 runtime，并通过 `session/load` 恢复上下文。
- project/session 元数据保存在 `<data_dir>/metadata.sqlite3`；聊天 Yjs 日志与 outbox
  保持独立的崩溃恢复语义。

完整身份模型与安全边界见 [架构契约](docs/architecture.md)，术语见
[terminology](docs/terminology.md)。当前 UI/UX 工作与验证证据在源码仓库的
`spec/issues/2026-08-13-acp-hub-uiux-audit.md`；release 归档不携带内部 issue 历史。
`ui.md` 仅是重构前历史基线，不是当前实现说明。

## 常用命令

```bash
# Web
cd web
bun run test
bun run build

# Rust workspace
cd ..
cargo test -p peri-studio-proto
cargo test -p peri-studio-server --lib
cargo clippy --workspace --all-targets -- -D warnings

# 本机 liveness；加 --ready 后，restarting/degraded 返回非零
cargo run -q -p peri-studio-server -- status --json
cargo run -q -p peri-studio-server -- status --ready

# 无敏感值地列出 token 记录，或吊销一个 token
cargo run -q -p peri-studio-server -- token list
cargo run -q -p peri-studio-server -- token revoke <token_id>
```

需要自定义目录时，server、token CLI 与 `dev.sh` 使用相同环境变量：

```bash
PERI_STUDIO_CONFIG_DIR=/path/to/config PERI_STUDIO_DATA_DIR=/path/to/data ./dev.sh
```

`PERI_STUDIO_LISTEN_ADDR`/`PERI_STUDIO_LISTEN_PORT` 会同时决定 server listener、instance
outbound URL 和最终打印的 Web 地址；如需跨主机连接，可用 `PERI_STUDIO_SERVER_URL`
显式覆盖 instance URL。

当前浏览器部署只支持 loopback 明文 HTTP。不要把 `8456` 直接暴露到公网；远程
部署需要 TLS、Secure cookie 与相应的 non-loopback 安全配置。

## 后台服务与升级

仓库提供可审阅的 [systemd user unit、launchd plist 和日志轮转模板](deploy/README.md)。
它们默认保持 loopback 边界，不内嵌 token，也不会接管已有进程。`GET /api/health`
是无凭据的本机 liveness endpoint：任何进程状态都返回 HTTP 200，`ready` 仅在全局
状态为 healthy 时为 true；peer 与 Host 必须同时是 loopback，避免把内部状态暴露给
DNS rebinding 请求。

升级时先升级 server、再升级 instance，最后以 `status --ready` 验收。Instance hello
显式携带协议版本；版本不匹配会在 token/nonce 消耗前被拒绝，日志中呈现稳定的
`protocol_version_mismatch`，避免把升级问题误诊为凭据损坏。

## Release 产物

`peri-studio-v<workspace-version>` tag 触发独立的 Linux/macOS 原生 release workflow。每个
归档包含同版本的 `peri-studio-server`、`peri-instance`、LICENSE、运行架构文档、部署模板
和 runbook，并用 `BUILD-METADATA` 记录 target、源码 commit 与 dirty 状态；同时携带
`SECURITY.md`、`deny.toml`、Cargo/Bun lock 作为可审阅的安全与精确依赖事实（它们不是
SBOM 或第三方许可证清单）。产物明确排除 `test-child`、token、配置目录与运行数据。
构建顺序固定为：

1. 固定版本的 cargo-deny 刷新 RustSec 并检查 advisory/license/source/bans；Bun 审计
   committed lock。数据库/网络失败即失败，不降级成“无漏洞”；
2. 安装 lock 对应的 Chromium，运行五场景/三 viewport 的真实浏览器契约；失败保留
   trace/screenshot，native build 不启动；
3. `bun install --frozen-lockfile`，运行 Web 单元/组件测试并生成当前 `web/dist`；
4. `cargo test --workspace --locked`；
5. `cargo build --workspace --release --locked`，由 server build script 内嵌 Web；
6. 生成规范化 tar/gzip、SHA-256，并重复打包验证字节级可复现。

本地可用同一条产物链验证，不会安装或发布任何内容：

```bash
cd web && bun install --frozen-lockfile && bun run test && bun run build && cd ..
cd web && bunx playwright install chromium && bun run test:browser && cd ..
cargo deny check advisories licenses bans sources
cargo test --workspace --locked
cargo build --workspace --release --locked
scripts/package-release.sh
```

归档名中的 target 来自 `rustc -vV` 的 host triple；聚合 release job 只做结构与校验和
验证，二进制 `--version` 在各自原生构建 runner 内执行。详细安装步骤见
[deploy/README.md](deploy/README.md)。安全边界和私密漏洞报告入口见
[SECURITY.md](SECURITY.md)。
