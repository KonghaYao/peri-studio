# Peri Studio 后台部署

发布归档只包含 `bin/peri-studio`。它可以作为 server 角色运行，也可以作为
instance 角色连接另一个 server。Web 静态资产已内嵌，不需要单独拷贝
`web/dist`。

## 运行模式

```bash
# 交互式本地模式：server + 同一可执行文件的 connect 子进程
peri-studio
peri-studio local

# 只启动 server，或让 server 同时拉起本地 instance
peri-studio serve
peri-studio serve --local

# 只启动 instance 角色
peri-studio connect ws://127.0.0.1:8456/instance \
  --token-file "$HOME/.config/peri-studio/instance.token"

# 连接已提供 TLS 的远程 server（自动补齐 /instance）
peri-studio connect https://peri.example \
  --token-file "$HOME/.config/peri-studio/instance.token"
```

`local` 与 `serve --local` 也必须通过 `/instance` WebSocket、协议版本校验与
HMAC 双向认证回连，不存在进程内直调快速路径。
非 loopback 明文 `ws://` 默认拒绝；`--allow-insecure` 只用于受控测试网络，
HMAC 不能替代 TLS 的机密性。

## 为什么后台模板仍是两个任务

单二进制是分发边界，不是故障域。systemd/launchd 模板使用同一个
`peri-studio` 文件分别执行 `serve` 和 `connect`，避免 server 任务的 cgroup/job
清理把 instance 与 ACP 进程一起终止。server 崩溃或重启期间，instance/ACP
继续运行并按退避策略重连。

## 凭据

server 的 `tokens.toml` 和 instance 的 token 文件必须由目标用户持有，且权限为
`0600`。先在 server 主机生成 instance token：

```bash
install -d -m 700 "$HOME/.config/peri-studio"
peri-studio token generate --name local --role instance \
  --output-file "$HOME/.config/peri-studio/instance.token"
```

该命令直接以私密权限创建文件。远程 instance 通过安全通道获取该文件；
不得把 token 放入 unit/plist、命令行、日志或发布归档。

## systemd user

1. 将 `peri-studio` 安装到 `/usr/local/bin/`，或同步修改两个 unit 的 `ExecStart`。
2. 把 `systemd/*.service` 复制到 `~/.config/systemd/user/`。
3. 准备 `~/.config/peri-studio/instance.token`，并执行 `chmod 600`。
4. 启动：

```bash
systemctl --user daemon-reload
systemctl --user enable --now peri-studio-serve.service
systemctl --user enable --now peri-studio-connect.service
peri-studio status --ready
```

instance unit 只 `Wants` server，不 `Requires` server；server 停止不会触发 instance 停止。

## launchd

先把两个 plist 中的 `REPLACE_ME` 替换为实际用户绝对路径，再复制到
`~/Library/LaunchAgents/`。两个 label 互不 KeepAlive 依赖，server job 退出不影响
instance job。plist 只引用 token 文件路径，不包含 token 本体。

```bash
mkdir -p "$HOME/Library/Logs/Peri Studio" "$HOME/Library/LaunchAgents"
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.perihelion.peri-studio.serve.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.perihelion.peri-studio.connect.plist
peri-studio status --ready
```

launchd 日志路径在 plist 中显式指定。`logrotate/peri-studio` 是外部轮转
示例；使用前必须替换其中的用户路径。

## 升级与回滚

1. 验证归档校验和，原子替换唯一 `peri-studio` 文件。
2. 重启 server 任务；instance/ACP 保持运行并等待重连。
3. server 恢复后重启 instance 任务，使两个角色都使用新版文件。
4. 以 `peri-studio status --ready` 验收。

如 `instance/hello` 报 `protocol_version_mismatch`，不要轮换凭据；应使 server 和
instance 两个运行角色使用同一版本。回滚时同样原子替换单个文件，并保留
SQLite 未知更高 schema 时的 fail-fast 语义。
