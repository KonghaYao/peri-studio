---
status: accepted
date: 2026-08-21
---

# 单发布二进制，保留 server/instance 独立进程角色

Peri Studio 只发布一个 `peri-studio` 可执行文件，但 server 与 instance 仍为独立
OS 进程角色。默认/`local` 与 `serve --local` 由 server 角色在就绪后以同一可执行
文件拉起 `connect` 子进程；本地 instance 与远程 instance 都必须通过真实
`/instance` WebSocket、协议版本校验与 HMAC 双向认证连接 server。

## 考虑过的方案

- **两个发布二进制**：故障隔离正确，但安装、版本一致性与本地启动负担不符合
  产品要求。
- **单进程内并行运行 server 与 instance**：启动简单，但 server panic/退出会
  同时终止 instance 与 ACP，破坏 P3（server 崩溃不中断 agent）。
- **本地进程内直接调用，远程才走 ws**：会形成两套认证、重连、补推与失败语义，
  本地验证不能为远程路径提供证据。

## 后果

- 合并的是分发和版本边界，不是故障域；server/instance 库仍互不依赖。
- 交互式本地模式可以一条命令启动；系统托管仍应使用两个 service 执行同一
  文件的 `serve` 和 `connect` 命令，避免 cgroup/job 清理扩大故障。
- server 异常退出不得级联终止 instance；优雅关闭则由明确的监督契约收束
  子进程。重启后的 local 可以接管幸存 instance，但必须逐项匹配 owner lock 的
  managed-local token id、endpoint、凭据摘要、PID 与出生指纹；任一不匹配都拒绝
  接管且不发送信号。
- 接管后监督所有权转移给新 local：持续观察 owner lock，owner 消失则恢复
  spawn/backoff；新 local 优雅退出时经 0600 Unix socket 发出绑定完整 owner 身份的
  HMAC 请求，由 instance 自行关闭，避免 PID 检查与发信号之间的复用竞态。server
  异常退出则解除监督并保留 instance/ACP，认证失败、坏记录与探测错误一律 fail closed。
