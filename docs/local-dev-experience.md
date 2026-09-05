# 本地开发踩坑与启动经验

> 记录日期：2026-08-30  
> 场景：macOS（Apple Silicon）首次在本机拉起 Peri Studio 并完成 Web 登录。

本文档汇总一次真实本地启动过程中遇到的问题、原因与解决办法，供后续开发者参考。权威契约仍以 `README.md`、`docs/architecture.md` 为准。

---

## 1. 最快启动路径

```bash
# 项目根目录
./dev.sh
```

`dev.sh` 会依次：

1. 构建 Web 前端（`web/` → `web/dist`），并默认后台 `vite build --watch`（`PERI_STUDIO_WEB_WATCH=0` 可关）
2. 以 **无内嵌前端** 的 debug 二进制启动（`cargo build -p peri-studio --no-default-features`）；静态文件由环境变量 **`PERI_STUDIO_WEB_DIST`**（默认 `web/dist`）在运行时从磁盘读取
3. 以 `peri-studio local` 启动 server + 受监督的本地 instance
4. 等待 instance 认证与 resync 完成
5. 前台输出日志

**只改前端时**：保存 → watch 更新 `dist` → **刷新浏览器**即可，**不必**再跑 `cargo build`。只有改 Rust 才需要重编二进制。

**生产/发布**仍使用默认 feature `embed-static-web`（`cargo build --release`），`web/dist` 编译期内嵌进二进制，不依赖 `PERI_STUDIO_WEB_DIST`。

就绪后访问：**http://127.0.0.1:8456/**

停止：在运行 `dev.sh` 的终端按 `Ctrl+C`。

---

## 2. 前置依赖

| 工具 | 用途 |
|------|------|
| **Bun** | Web 依赖安装与构建 |
| **Rust（stable）** | 编译 `peri-studio` 二进制 |
| **cargo / rustup** | Rust 工具链管理 |

`dev.sh` 还会检查：`grep`、`tail`、`lsof`。

常用环境变量（与 `dev.sh`、CLI 一致）：

| 变量 | 默认值 |
|------|--------|
| `PERI_STUDIO_CONFIG_DIR` | `~/.config/peri-studio` |
| `PERI_STUDIO_DATA_DIR` | `~/.local/share/peri-studio` |
| `PERI_STUDIO_LISTEN_ADDR` | `127.0.0.1` |
| `PERI_STUDIO_LISTEN_PORT` | `8456` |

---

## 3. 首次启动常见问题

### 3.1 Web 构建失败：`vite: command not found`

**现象**

```
$ vite build
/bin/bash: vite: command not found
error: script "build" exited with code 127
```

**原因**：`web/node_modules` 未安装。

**解决**

```bash
cd web && bun install
```

若在受限沙箱或部分环境下出现 tarball 解压失败（如 `lightningcss-darwin-arm64`、`@rolldown/binding-darwin-arm64`），在本机终端直接重试 `bun install` 即可。

---

### 3.2 Rust 编译失败：`if let` guards are experimental（`yrs`）

**现象**

```
error[E0658]: `if let` guards are experimental
  --> .../yrs-0.27.3/src/block.rs:1019:17
```

**原因**：项目依赖 `yrs 0.27`，需要较新的 Rust stable（`if let` guard 在 1.95+ 稳定）。若默认工具链停留在 1.94.x，会编译失败。

**解决**

```bash
rustup update stable
rustup default stable
rustc --version   # 确认 ≥ 1.95，实测 1.98.0 可正常编译
```

然后重新执行 `./dev.sh`。

---

### 3.3 `dev.sh` 等待 instance 超时

**现象**

```
!! 等待本地 instance 注册超时
```

**常见原因**

- 上一次 `cargo run` 实际编译失败，server 未真正就绪（多与 Rust 版本过旧有关）
- 旧的 `peri-studio` listener 未能优雅退出（`dev.sh` 会先尝试清理；非 Peri Studio 进程不会被接管）

**排查**

1. 确认 `rustc --version` 满足要求
2. 查看端口占用者：`lsof -nP -iTCP:8456 -sTCP:LISTEN`
3. 若占用者是旧 `peri-studio`，重新执行 `./dev.sh` 会先发送优雅停止信号
4. 查看 `.tmp/peri-studio.*.log` 中是否有 `instance connected` 与 `resync complete, all sessions live`

---

## 4. 认证：没有 API Key，用的是 Token

Peri Studio **不使用**「API Key」这一术语，认证凭据统一称为 **token**，按角色区分用途。

| 角色 | 用途 | 能否用于浏览器登录 |
|------|------|-------------------|
| `full` | Web / TUI 等可写客户端 | ✅ 是 |
| `read-only` | 只读客户端（预留档位） | ✅ 是 |
| `instance` | instance 进程连接 server | ❌ 否 |

**关键文件路径**

| 文件 | 说明 |
|------|------|
| `~/.config/peri-studio/tokens.toml` | 所有 token 元数据（权限 `0600`） |
| `~/.local/share/peri-studio/instance.token` | 本地 instance 连接凭据（`dev.sh` / `local` 模式自动维护） |

`instance.token` **仅供**本地 instance 子进程使用，**不能**粘贴到浏览器登录页。

---

## 5. 浏览器登录步骤

1. 打开 http://127.0.0.1:8456/
2. 在登录页生成并粘贴 **`full` 角色** token

```bash
cargo run -q -p peri-studio -- token generate --name web --role full
```

命令**只打印一次**完整 token（44 字符 base64）。复制后粘贴到登录页 **Access token** 输入框。

登录页「Where is my token?」会显示当前 server 实际读取的 `tokens.toml` 路径和可复制生成命令。

登录成功后：

- 服务端下发 **HttpOnly cookie** 维持会话（8 小时 TTL）
- 浏览器将 token 存入 `localStorage`（`peri_studio_token`）方便下次自动登录
- 登出或 token 失效后需重新输入

**安全纪律**：不要把 token 提交到 Git、日志、issue 或聊天记录。

---

## 6. 登录报错：token 无效

**前端提示**

> The token is invalid, revoked, or not a client token usable in the browser.

对应 HTTP **401**，常见原因：

| 原因 | 说明 |
|------|------|
| 误用 instance token | 把 `instance.token` 或 `role = instance` 的凭据贴进浏览器 |
| 没有 `full` token | 从未生成过浏览器可用 token |
| token 已吊销 | `tokens.toml` 中对应记录 `revoked = true` |
| 复制错误 | 复制了 `token_id`（UUID）而非 `token` 字段本体 |
| 浏览器缓存旧 token | `localStorage` 中仍是已失效凭据 |

**处理步骤**

1. 重新生成 `full` token（见上文命令）
2. 清空登录框，或开无痕窗口 / 清除站点 `localStorage` 后重试
3. 确认粘贴的是完整 44 字符字符串，无首尾空格
4. 可选：无敏感信息地查看已有 token 记录：

```bash
cargo run -q -p peri-studio -- token list
```

吊销某个 token：

```bash
cargo run -q -p peri-studio -- token revoke <token_id>
```

---

## 7. 健康检查

服务运行中可快速验证：

```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8456/api/health
# 期望输出：200
```

---

## 8. 推荐首次启动检查清单

- [ ] `bun --version`、`rustc --version`（stable ≥ 1.95）
- [ ] `cd web && bun install`
- [ ] `./dev.sh` 输出「已就绪：http://127.0.0.1:8456/」
- [ ] `token generate --name web --role full` 生成浏览器 token
- [ ] 登录页成功进入面板

---

## 9. 与 README 的关系

- 日常命令与架构契约：见根目录 `README.md`
- 本文档仅补充**实操踩坑**，不替代架构文档
- 若 `dev.sh`、token 流程或最低 Rust 版本在代码中变更，请同步更新本文档
