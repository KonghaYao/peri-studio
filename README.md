# Peri Studio

Peri Studio 是 ACP agent 的持久 Web 工作台。发布包只有一个
`peri-studio` 可执行文件，同时具备 server 与 instance 两种运行角色。server
负责认证、项目/会话元数据、运行实例编排和 Yjs 只读投影；instance
连接 server 并管理 ACP 进程。SolidJS Web 只消费 server 事实，不在浏览器
里伪造对话历史。

## 安装

Peri Studio 以单一原生二进制发布。安装器沿用 Peri 的 `~/.peri` 目录和 PATH
约定，但使用独立的 `peri-studio` 文件名和版本目录，因此二者可以共存。

支持的首发目标：

- Linux x86_64（glibc）；
- macOS Apple Silicon。

macOS / Linux：

```bash
curl -fsSL https://raw.githubusercontent.com/KonghaYao/peri-studio/main/scripts/install.sh | bash
```

默认安装布局：

```text
~/.peri/
  peri-studio                         # 当前版本入口
  peri-studio-v<version>/peri-studio  # 版本化实体
  peri-studio-current-version.txt
```

脚本从 GitHub Release 选择对应平台资产，强制校验同名 `.sha256` 后才原子安装，并把 `~/.peri` 加入用户 PATH。指定版本可设置 `PERI_STUDIO_INSTALL_VERSION=0.2.0`；自定义目录可设置 `PERI_STUDIO_INSTALL_DIR`。安装脚本和首发二进制尚未签名，macOS Gatekeeper 可能显示来源警告。Windows 尚未纳入当前 GitHub Release 矩阵；如需 Windows 支持，请从源码自行构建。

安装后直接运行：

```bash
peri-studio
```

再打开 <http://127.0.0.1:8456/>。Web 静态资产已内嵌，无需部署 `web/dist`。
默认 ACP 启动命令是 `peri acp`，因此还需安装 Peri，或通过
`PERI_STUDIO_ACP_CMD` / `config.toml` 配置其他 ACP agent。

## 从源码快速开始

前置环境：Rust toolchain、Bun，以及可配置的 ACP agent。

```bash
cd peri-studio
./dev.sh
```

`dev.sh` 每次都会重新构建 Web 和 Rust workspace，随后启动 loopback server 和本地
instance；只有 listener 就绪且 instance 完成认证注册后才会打印“已就绪”。脚本
会在构建前识别并优雅停止占用目标端口的旧 `peri-studio` listener，再启动新的
`local` 实例；不会按进程名批量终止其他程序。若端口仍由非 Peri Studio 进程占用，
脚本会拒绝启动并提示先释放端口。
默认页面是 <http://127.0.0.1:8456/>；每次运行使用独立的
`.tmp/peri-studio.<pid>.log`，避免旧 daemon 输出污染新一轮 readiness 判定。
日志、instance token 和运行时目录以私有 umask 创建。按 `Ctrl+C` 停止本次开发进程。

发布版直接运行 `peri-studio`，等价于 `peri-studio local`：server 启动后
以**同一可执行文件**拉起独立的 `connect` 子进程，后者通过真实
`/instance` WebSocket 和 HMAC 双向认证回连本机 server。两个运行角色不绕过
网络协议，也不共享失败命运；server 异常退出时 instance 与 ACP 进程继续
运行并等待重连。

第一次打开本地页面时，server 会自动创建一个受管 `full` token，并通过仅限同源
loopback 的一次性交换直接建立 HttpOnly 浏览器会话；token 不会进入 URL、日志或页面，
用户无需运行命令或复制凭据。显式登出后，或连接单独管理的 server 时，仍可使用已有
`full` token 登录；管理员也可以执行：

```bash
cargo run -q -p peri-studio -- token generate --name web --role full
```

完整 token 只打印一次。它仅用于显式管理的登录场景，不要提交到 Git、日志、issue
或聊天记录。浏览器登录成功后使用 HttpOnly opaque cookie 建立会话；仅当用户手动输入
token 时，当前兼容流程才会将其保存在本机浏览器以便下次自动登录，登出即清除。首次
自动引导不会把 token 写入浏览器存储、WebSocket 帧或 URL。

server 会确保名为 `local` 的 instance token 存在，并把本地连接凭据原子发布到
`<data_dir>/instance.token`（`0600`）；启动路径从不打印 token 本体。
`local`/`serve --local` 只把该受限文件路径交给受监督的 `connect` 子进程，无需解析
`tokens.toml` 或抓取日志。

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

# 本地复合模式（默认）；或只运行 server
cargo run -q -p peri-studio
cargo run -q -p peri-studio -- serve

# 使用 instance 角色连接一个 server
cargo run -q -p peri-studio -- connect ws://127.0.0.1:8456/instance \
  --token-file /path/to/instance.token

# 本机 liveness；加 --ready 后，restarting/degraded 返回非零
cargo run -q -p peri-studio -- status --json
cargo run -q -p peri-studio -- status --ready

# 无敏感值地列出 token 记录，或吊销一个 token
cargo run -q -p peri-studio -- token list
cargo run -q -p peri-studio -- token revoke <token_id>
```

需要自定义目录时，server、token CLI 与 `dev.sh` 使用相同环境变量：

```bash
PERI_STUDIO_CONFIG_DIR=/path/to/config PERI_STUDIO_DATA_DIR=/path/to/data ./dev.sh
```

`PERI_STUDIO_LISTEN_ADDR`/`PERI_STUDIO_LISTEN_PORT` 决定 server listener 和 Web 地址。
`local` 与 `serve --local` 从实际绑定结果派生 loopback instance URL；`connect <URL>`
则始终以显式 URL 为准。`https://host` 会规范化为 `wss://host/instance`；
非 loopback 的明文 `ws://` 默认拒绝，只能通过显式 `--allow-insecure` 临时放开。

当前浏览器部署只支持 loopback 明文 HTTP。不要把 `8456` 直接暴露到公网；远程
部署需要 TLS、Secure cookie 与相应的 non-loopback 安全配置。

## 后台服务与升级

仓库提供可审阅的 [systemd user unit、launchd plist 和日志轮转模板](deploy/README.md)。
它们默认保持 loopback 边界，不内嵌 token，也不会接管已有进程。`GET /api/health`
是无凭据的本机 liveness endpoint：任何进程状态都返回 HTTP 200，`ready` 仅在全局
状态为 healthy 时为 true；peer 与 Host 必须同时是 loopback，避免把内部状态暴露给
DNS rebinding 请求。

单二进制升级是原子替换：先替换 `peri-studio`，再重启 server 角色，最后
重启或滚动更新使用旧进程的 instance 角色。server 停机期间 instance/ACP 不停，
它们会在 server 恢复后重连。Instance hello 显式携带协议版本；版本不匹配会
在 token/nonce 消耗前被拒绝，日志中呈现稳定的
`protocol_version_mismatch`。验收使用 `peri-studio status --ready`。

## GitHub Release 产物

`peri-studio-v<workspace-version>` tag 触发 Linux x86_64 与 macOS Apple Silicon 原生 release workflow。每个平台发布一个可直接执行的单一
`peri-studio` 二进制及其 `.sha256`、源码 revision metadata 和 SPDX SBOM；同时
发布 `install.sh`。Web 产物已内嵌，release 不包含独立 Web 部署包，
也明确排除 `test-child`、token、配置目录与运行数据。
构建顺序固定为：

1. 固定版本的 cargo-deny 刷新 RustSec 并检查 advisory/license/source/bans；Bun 审计
   committed lock。数据库/网络失败即失败，不降级成“无漏洞”；
2. `bun install --frozen-lockfile`，运行 Web 单元/组件测试并生成当前 `web/dist`；
3. `cargo test --workspace --locked`；
4. `cargo build --release --locked --bin peri-studio`，将 Web 产物内嵌进唯一产品二进制；
5. 复制规范化命名的原生二进制，生成 SHA-256 与源码 revision metadata，并在
   Linux/macOS 重复打包验证字节级可复现。

本地可用同一条产物链验证，不会安装或发布任何内容：

```bash
cd web && bun install --frozen-lockfile && bun run test && bun run build && cd ..
cargo deny check advisories licenses bans sources
cargo test --workspace --locked
cargo build --release --locked --bin peri-studio
scripts/package-release-binary.sh
```

资产名中的 target 是 Rust target triple；聚合 release job 只做结构与校验和
验证，`peri-studio --version` 在各自原生构建 runner 内执行。后台服务说明见
[deploy/README.md](deploy/README.md)。安全边界和私密漏洞报告入口见
[SECURITY.md](SECURITY.md)。
