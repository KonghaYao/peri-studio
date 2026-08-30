---
status: accepted
date: 2026-08-30
---

# SSH 只作机器供应与反向隧道，不改 instance 协议

把远端主机加入 Peri Studio 时，SSH 只负责探测、安装 `peri-studio`、落盘
instance token，以及本机 `ssh -R` 把远端 loopback 转到本机 server。远端
必须继续 `peri-studio connect`，经 `/instance` WebSocket、协议版本校验与
HMAC 接入。可开工契约见 [ssh-machine-mount.md](../design/ssh-machine-mount.md)。

## 考虑过的方案

- **SSH 多路复用 instance 帧**：本机可直连，但会形成第二套传输、重连与补推，
  违反 ADR-0001「本地与远程同路」。
- **把 server 改听 `0.0.0.0` / 提前上 M4 `wss`**：扩大攻击面，与 loopback
  默认部署冲突。
- **仅文档化手工 `connect`**：默认监听下远端连不回本机，也无法在面板管理。
- **浏览器内 SSH**：私钥与口令进入 Web。
- **MachineSupervisor 放进 `server/` crate**：控制面崩溃会拆掉全部隧道，与
  ADR-0001「不把 instance 塞进 server」同一理由。否决。
- **SSH runtime 进入全局 Restarting pending**：studio 会等待尚未建隧道的机器
  而自锁。否决。

## 后果

- 本机 server 保持 `127.0.0.1`；机密性由 SSH 提供，认证完整性仍由 HMAC 提供。
- `SshBackend` 由 `app/` 实现并注入；隧道进程随 studio 退出。`instance/` 对
  隧道无感知。`server/` 只持 SQLite / 准入 / 投影 / token id。
- 全局 Restarting 只等待 `local`。已 Trust 的 SSH 机器在 Healthy 之后
  best-effort 自动重建隧道。Disconnect tunnel ≠ Stop agents。
- 未归档 SSH destination+port 唯一。项目 `cwd` 必须在目标 instance 上选择。
- 未安装或协议版本不一致时先停旧 owner 再替换用户目录中的单一二进制；不在
  远端编译，不要求 root。
- Web 只发 `machine/*`；OpenSSH 不出现在浏览器。wire 错误只用既有 `ErrorCode`。
