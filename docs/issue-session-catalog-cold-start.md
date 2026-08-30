---
status: resolved
date: 2026-08-30
resolved: 2026-08-30
---

# Issue：冷启动后已有 ACP session 不显示

## 现象

进入 Peri Studio 后，项目可以显示，但已有 ACP session 不在侧栏中；用户必须新建 session，侧栏才开始出现 session。

## 影响

服务端重启或浏览器重新进入时，agent 磁盘中的已有 ACP session 无法被发现。新建 session 会制造新的 Registry 投影，因此会掩盖问题，但不会恢复之前的 session。

## 根因

服务端启动时按顺序发送 Registry snapshot 和 `ready`。Web 端 `DocStore` 为降低渲染成本，把 Registry 投影延迟到下一帧：

1. `ready` 到达时，`projects()` 仍为空。
2. `sessionCatalogBootstrap.schedule()` 没有找到 active project，直接返回。
3. 下一帧完成 Registry hydration 后，旧的启动 effect 可能只读取了非响应式的 `connectionReady()`，没有订阅 `registryHydrated`。
4. 因此没有发送 `session/discover`，而服务端按设计不会从 SQLite 恢复 `project_sessions`。

此外，空的首帧 catalog 会让 session navigator 提前消费恢复机会，导致 discovery 完成后无法自动恢复记忆中的 session。

## 修复

- 将连接 ready 状态改为 Solid 响应式信号。
- 启动 effect 显式读取 ready 和 Registry hydration 两个信号，任一到达顺序都能触发 session catalog bootstrap。
- 空 catalog 不再消费 session restore attempt，等待 discovery 后再决定是否恢复。
- 连接建立、断开和状态重置时统一撤销 ready 状态，避免旧连接状态泄漏。

## 验证

- 新增连接 ready/hydration 首帧竞态回归测试。
- 新增空 catalog 等待 discovery 的导航回归测试。
- 启动、导航、目录、投影、Yjs 相关测试：5 个文件、30 项通过。
- Web 全量验证：93 个测试文件、697 项测试通过，生产边界检查通过。
