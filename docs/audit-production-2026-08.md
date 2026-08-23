# 远程 FS/Git 生产化十轮审计（2026-08-23）

本报告记录从 `03b3cb2` 之后围绕远程文件系统、Git 工作台、恢复一致性与发布
工程进行的十轮“审计 → 修复 → 回归”循环。它补充而非改写历史报告
`docs/audit-2026-08.md`；后者描述此前的通用工程治理，本报告描述本次资源工作台
的生产化证据。

## 目标与判定边界

本阶段目标是交付接近 VS Code 资源工作台的高频体验：响应式 Explorer、只读文件
预览、Source Control 状态与 diff、stage/unstage/discard/commit/pull/push/sync，
同时保持浏览器不接触可信 root、文件正文不进入 Yjs、写操作具有 generation fence，
并可由 CI/发布流水线重复验证。

“接近 VS Code”只用于交互参照，不代表已经实现 VS Code 的全部能力。当前明确未
宣称完成的能力是：可写文本编辑器、文件新建/重命名/删除、冲突解决器、历史/分支
图、FS/Git watcher 的长期增量投影，以及 instance → server 的真正 HTTP/流式数据
面。当前该内部一跳仍是受 8 MiB 原始正文、12 MiB WebSocket message 上限保护的
base64 中继；浏览器最后一跳才使用短租约 HTTP blob。

## 十轮审计与修复

| 轮次 | 审计面 | 发现 | 修复与证据 |
| --- | --- | --- | --- |
| 0 | 基线与可回退性 | 工作区包含恢复边界与资源投影的多域改动，缺少稳定回退点 | 先提交 `d182f30` 与 `3b35efb` 两个里程碑；后续修复保持独立 diff，最终统一验证 |
| 1 | 恢复架构 | hello 不携带权威 alive 集合，却会提前清理、resume 和打开恢复门；首个空 heartbeat 也不对账 | hello 仅认证/fencing/能力注册；首个权威 heartbeat 才 reconcile → 幂等 resume → 多 instance barrier；失败进入 Degraded。19 个恢复测试和真实 gateway 测试覆盖 |
| 2 | 并发与状态所有权 | heartbeat 每帧独立 spawn，旧快照可能后完成；不同 repo mutation 的 refresh/reset 会清掉另一请求状态；资源投影持锁 await | 每 instance 单 worker，连接 epoch fencing，未执行快照 latest-wins；repo 定向刷新并保留独立 pending/error；投影先预留 publishing lease、锁外持久化、再激活 |
| 3 | 文件与网络安全 | 文件 canonicalize 后再 open 存在 symlink TOCTOU；远程 WS Host/Origin 策略与显式远程监听不一致；blob 内部中继上限过大 | Unix 用 root dirfd + `openat(O_NOFOLLOW)` 逐段打开并从同一 fd 读 metadata/正文；远程浏览器要求 TLS 同源 Origin，native instance 可无 Origin；blob 限为 8/12 MiB |
| 4 | Explorer UI/响应式 | 资源区在中小视口拥挤，Explorer 操作按钮是无行为的省略号 | wide/medium/compact 三档 shell、rail/overlay/drawer、状态栏；Explorer 改为真实 Refresh 操作，目录分页与加载/错误态保留 |
| 5 | 可访问性 | 文件树缺少完整单 tab-stop 导航语义，图标操作依赖视觉猜测 | ARIA tree/treeitem/group，roving tabindex，方向键/Home/End/Enter/Space；图标按钮提供可访问名称与 tooltip；组件测试覆盖 |
| 6 | SCM 高风险交互 | 仅有 diff 与 stage/unstage，无法完成常用工作流；失败与并发反馈不够局部 | 增加提交框、Cmd/Ctrl+Enter、UTF-8 4096B 限制、commit/discard/pull/push/sync、discard 二次确认、repo 级 busy/error/retry；固定 argv、无 shell、无交互 Git、超时 kill-on-drop |
| 7 | 数据量与模块深度 | 大文本可能无界渲染；store 与 aggregator 写入模块超过或逼近 500 行；内部 base64 可造成峰值内存 | 预览最多 5000 行；拆出 resource mutation/preview、store projection、aggregator tool projection；所有生产 Rust/TS/TSX 文件 ≤500 行；relay 在编码前后双重限额 |
| 8 | CI、发布与部署 | release tag 约定错误、只有 Linux、无双次归档字节比较，文档仍称发布资产缺失 | tag 固定 `peri-studio-v<workspace-version>`；Linux/macOS matrix；Web 产物先构建；cargo-deny/Bun audit/SBOM/provenance；同源同 commit 打包两次并 `cmp`；契约测试锁定 |
| 9 | 浏览器对抗验证 | fixture 直接动态 import store，Vite 创建第二模块实例，导致一个文件预览场景假失败 | dev-only fixture 暴露同依赖图桥接，不进入 production boundary；1280/1024/390 与交互矩阵 39/39 通过 |
| 10 | 独立 Standards/Spec 复审 | 复审指出恢复竞态、SCM 能力缺口、文档漂移、release 契约、真实资源传输测试缺失 | 逐项修复；新增真实 Gateway client ↔ server ↔ fake instance ↔ Yjs 资源闭环；文档改为协议 v4 和真实数据面边界；全量门禁通过 |

## 关键协议结论

浏览器发送 project identity、相对路径或 opaque Git identity；server 从 metadata
解析可信 instance 与 workspace root。目录树和 Git 状态是短租约、principal 绑定的
Yjs 投影，适合小而频繁的状态同步；文件正文与 diff 不进入 Yjs，而是由浏览器使用
同源 HttpOnly session 获取一次性 HTTP blob。

Git mutation 统一使用 `expected_generation` 作 compare-and-swap fence。单 repo 内
串行，不同 repo 可并发；commit message 通过 stdin 交给 `git commit --file=-`，
discard 只处理 opaque change id 映射出的精确路径，pull/sync 强制 fast-forward-only。
所有 Git 子进程禁用 credential/UI prompt，公共错误不回显命令、路径或 stderr。

## 最终验证证据

在 macOS arm64、本地回环集成权限开启的环境完成：

```text
cargo fmt --all --check                                      PASS
cargo clippy --workspace --all-targets --locked -- -D warnings PASS
cargo test --workspace --locked                              PASS
cargo build --release --locked --bin peri-studio             PASS
cd web && bun run test                                       62 Node + 510 Vitest PASS
cd web && bun run test:browser                               39 Playwright PASS
production boundary                                          205 files PASS
release.yml YAML parse + deployment contract                 PASS
git diff --check                                             PASS
production Rust/TS/TSX line limit                            max 498 PASS
```

端到端资源测试 `e2e_resource_directory_projects_through_instance_and_ysync` 使用真实
Gateway socket、真实客户端认证/ready 时序和真实 instance 资源帧，验证 server 将
project 解析为可信 root、instance 结果发布为短租约资源 Doc，客户端随后收到 Yjs
快照。HTTP blob 的 cookie、ETag 与精确字节响应由真实 TCP HTTP 测试独立覆盖。

## 后续阶段

下一阶段若继续追求更完整的 VS Code 体验，优先级应为：

1. 为 FS/Git 建立长寿命 watcher 与 server 侧增量 Yjs Doc，而不是每次 refresh
   发布新快照。
2. 将 instance → server blob 中继替换为认证的数据流/HTTP fetch，支持 Range、
   backpressure 与 cancellation，删除 base64 峰值内存。
3. 在同一 generation/lease 模型上增加写文件、创建/重命名/删除与冲突解决，并
   先定义恢复和幂等语义再开放 UI。
4. 增加真实 Git 冲突、远端认证代理、超大仓库与断网恢复的产品级浏览器 E2E。
