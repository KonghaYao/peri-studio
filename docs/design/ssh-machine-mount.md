# SSH 机器挂载与机器管理页

> 状态：R1–R4 已落地（feat/ssh-machine-mount worktree）；checksum 表在 release 时钉选更新；真 sshd 契约测 `#[ignore]` + `SSH_MACHINE_CONTRACT=1`
> 日期：2026-08-30
> 定位：把远端 Unix 主机加成 Peri Studio 一台 **instance** 的唯一推荐路径；并规定主 server Web 面板的机器管理与项目绑定交互。协议身份、ws 帧、Ack 码仍以 [`docs/terminology.md`](../terminology.md) 与 [`docs/architecture.md`](../architecture.md) 为准。不可逆裁决见 [ADR-0002](../adr/0002-ssh-machine-provisioner.md)。
> 实现约束：`machine/*` 进入 `ActionEnvelope` + whitelist 必须与本文件 **同一 PR**；未进 proto 之前不得把 §4.3 表当成已交付协议。落地后回写 architecture 删除「实现未开始」。

本文已吸收用户使用与程序设计两路对抗审查。下列产品题已拍板，实现不得再各自发挥。

| 题 | 裁决 |
| --- | --- |
| A 启动是否自动连 SSH | **默认自动。** 已 Trust、未归档、`auto_reconnect=true` 的 SSH 机器在本机 studio 进入 Healthy **之后** 由 app 重建隧道。失败不得挡住 Healthy。用户可关单机自动重连。 |
| B Disconnect 含义 | **两个动作。** Disconnect tunnel 只拆本机 `ssh -R`；Stop agents 经 SSH exec 优雅关闭远端 `connect` 并结束其 ACP。 |
| C Offline 时 Remove | **禁止直接吊销。** 必须先 Stop agents（必要时先 Connect）。停不干净则不能 Remove。 |
| D 同一 SSH 目标再添加 | **禁止第二行。** 未归档 `(destination, port)` 唯一；墓碑用 Restore 恢复同一 `instance_id`。 |
| E 项目 cwd | **必须在目标机器上选路径。** SSH 机器未 Online 时不可创建绑定它的 project。 |
| H 仅密码/TTY 跳板 | **v1 不支持。** 文档与 UI 明确：需要口令或交互 MFA 的主机不可添加。 |

---

## 1. 决策摘要

1. **SSH 是供应器与隧道，不是第二套 instance 协议。** 远端执行 `peri-studio connect`，走 `/instance` WebSocket、协议版本校验与 HMAC。禁止 SSH mux、浏览器 SSH、把 listener 改成 `0.0.0.0` 来「省掉隧道」。
2. **默认连通是反向隧道。** server 继续听 `127.0.0.1`。远端连 `ws://127.0.0.1:<allocated>/instance`（loopback，禁止 `--allow-insecure`）。机密性由 SSH 提供，冒充仍由 HMAC 防。
3. **P3 切成两层，禁止混写。** 进程层：本机 studio / 隧道退出 **不得 SIGKILL** 远端 ACP。控制面层：`ssh -R` **必须随本机 studio 进程退出**（与 local instance 的 `kill_on_drop(false)` **相反**）。隧道仍在且 listener 仍在时，远端 `connect` 按现有退避重连。studio 从退出到再次建隧道的窗口允许 turn interrupted 与缓冲溢出；UI 必须说清楚。
4. **SSH runtime 永不进入全局 `recovery_instances`。** 只有本进程保证能拉起的控制面（当前即 `local`）挡住 Restarting。SSH 的 chat 重建为未确认；隧道恢复后的首份心跳走 **per-instance** `RecoveryCoordinator` lane，不挡 Healthy、不挡 `machine/*`。
5. **没有 peri-studio 就安装；版本不对就先停再换。** 用户目录、不要求 root。同 OS/arch 优先 scp `current_exe`；否则按本机产品 semver 拉对应 release 二进制及同名 SHA256，校验后安装。禁止 `curl \| sh`、禁止在远端编译、禁止对正在运行的 inode 直接覆盖。
6. **浏览器不持有私钥，不收集 SSH 密码。** OpenSSH 只跑在 **跑 `peri-studio local/serve` 的那台 OS**。认证：`ssh-agent`、用户 `~/.ssh/config`、可选本机 Identity 路径。需要 TTY/口令 → 失败 + 可复制 `ssh <destination>`。
7. **机器意图在 SQLite；live 连接只来自 hello/心跳。** 管理页展示未归档记录 ∪ live instance。离线机器不得从列表消失。
8. **主管理面是带可见标签的 Machines 页**，不是帮助图标里的只读拓扑。侧栏对话树不承担机器生命周期。Web 英文动词见 §11.0，**UI 禁用 Mount**。

---

## 2. 范围、非目标、诚实边界

### 2.1 范围内

- 从跑 Peri 的那台电脑，把 OpenSSH BatchMode 能到达的 Unix 主机加成 instance。
- 探测、安装或对齐二进制、签发 instance token、监督隧道、等待 hello、自动重连已 Trust 的机器。
- Machines 页：添加、Trust、连接、拆隧道、停 agents、重试、重命名、移除、恢复墓碑。
- 新建 project：选择 **Online 机器 + 该机器上的目录**。
- 与 `local` 并存；`local` 仍走现有 supervisor，不走 SSH。

### 2.2 明确不做

- SSH 作为 instance 传输；浏览器内 SSH；agent forwarding 默认开启。
- Windows 远端、WSL/Dev Container/远程 Docker 作为独立 provider。
- Web 表单收 SSH 密码；v1 支持仅密码或交互 MFA 的跳板（即使 `ProxyJump` 写在 config 里，BatchMode 失败即失败）。
- 卸载远端 `peri-studio` 二进制；跨 instance 迁移 chat；自动负载均衡。
- M4：公网 `wss`、非回环监听、从另一台电脑的浏览器管理本机 SSH（物理上 loopback 面板做不到）。
- 把「窄窗全屏 Dialog」宣传成 iPhone 能管 GPU。

### 2.3 对用户必须写明的边界（UI 页脚 / 空态 / README）

- 只能从 **正在运行 Peri Studio 的这台电脑** 添加机器。
- 使用这台电脑上的 OpenSSH 与 ssh-agent；**不能在 Peri 里输入密码**。
- 关掉 Peri 或 Disconnect tunnel **不会**自动停掉那台电脑上的 agents；要停请用 Stop agents。
- 无密钥、只有密码的主机无法添加。

### 2.4 当前实现缺口

System → Machines 仍是只读拓扑（`MachinePanel`），空文案 “No machines connected”，无添加入口。New project 的 Browse 只调本机 `/api/local/pick-directory`，`project/create` 可不传 `instance_id`（默认 local）。本设计落地时必须改这两处。

---

## 3. 术语

代码、ws、SQLite 主键仍是 `instance_id`，禁止复活 `machine_id`。

| 产品用词（英文 UI） | 协议/代码 | 含义 |
| --- | --- | --- |
| Machine | `machines` 行 + 可选 live instance | 用户可管理的一台能跑 ACP 的计算机 |
| This computer | `instance_id = "local"` | 本机 instance；不可 SSH 添加/移除 |
| Remote computer | `kind = ssh` | 经本设计加成的远端 |
| Add computer | `machine/add` | 创建记录并启动供应管道 |
| Connect | `machine/connect` | 重建隧道（及必要时 start） |
| Disconnect tunnel | `machine/disconnect` | 只拆本机 `ssh -R` |
| Stop agents | `machine/stop` | 关闭远端 connect + ACP |
| Remove from Peri | `machine/remove` | 停干净后吊销 token 并归档 |
| Instance | InstanceRegistry | 已 hello 的运行角色 |

中文文档可称「机器」；「实例」只指已 hello 的 instance 角色。管道全过程在文档中称 **供应（provision）**，不在 UI 使用 Mount。

---

## 4. 拓扑与故障域

```text
浏览器（同源 Web 面板，与 server 同机 loopback）
        │  Action/Ack + y-sync
        ▼
本机 peri-studio 进程树
        ├── server 角色：MachineService（SQLite / 准入 / 投影 / token id）
        ├── app 角色：LocalSupervisor + SshBackend（OpenSSH 子进程）
        └── local connect（现有路径）
                │
                │  ssh（argv 数组，见 §6.4）探测 / scp / exec / -N -R
                ▼
        远端 peri-studio connect ws://127.0.0.1:P/instance
                ▼
        远端 ACP
```

- instance **仍然 outbound**。NAT 穿越只靠 `-R` bind 远端 `127.0.0.1`。禁止 `GatewayPorts` 把转发开到公网。
- **SshBackend 在 `app/` 实现并注入 `ServerRuntime`。`server/` 禁止 `Command::new("ssh")`。** 测试用 fake backend。
- 隧道进程：独立 process group、`wait()`、随 studio **退出而退出**（SIGTERM → wait → SIGKILL）。**禁止** `kill_on_drop(false)` 留下孤儿 `-R`（否则「不自动重连」与「自动重连」都会被孤儿隧道破坏）。
- local instance 监督契约不变：server 异常退出不杀 local ACP。
- 远端 `connect` 对隧道消失后的 loopback `connection refused`：沿用指数退避，但 **同一 endpoint 连续 refused 时日志降为 debug（每 epoch 第一条 warning）**；不新增暂停 outbound 的协议。Remove/吊销仍靠 hello 失败 4502 停掉 instance。

---

## 5. 恢复（与 architecture §8.3 对齐，开工必改代码）

1. **【v1.2 / ADR-0003】** `session_runtime_history` 已删除；`Hub::rebuild_chat_views` 为 **no-op**，ChatRegistry 启动为空。SSH 上非终态 chat **不得**在 server 重启后仅凭「内存无登记」即 reconcile kill。首连窗口：SSH instance hello + 心跳若上报存活 chat，走 **register-unconfirmed + resume**（或等价 per-instance lane），禁止默认 `to_kill`。实现须在 R2 供应管道前闭合，与 §5.6 默认「Connect 成功后再打开」一致。
2. 进入全局 Restarting pending 的 **仅** `kind=local` 的 `instance_id`（以及未来「本进程内保证可拉起控制面」的同类）。**所有 `kind=ssh` 的 id 不得加入 `recovery_instances`。**
3. local hello + 首份心跳完成后 `clear_restarting`。此时 SSH 机器在管理页为 Offline 或 Connecting（若自动重连已开始），其 chat 为未确认 / interrupted。
4. app 在 Healthy 之后对符合 §8 的 SSH 行启动 Connect 管道（best-effort，并行、有界并发例如 4）。
5. 某 SSH hello 到达后，**只**走该 id 的 `RecoveryCoordinator` lane：心跳对账 → 存活则 resume，意外存活按 §7.5，未确认打开走 spawn+`session/load`。
6. 禁止在 SSH 尚未 hello 时，仅因「未确认」就对新打开的 session **立刻** spawn 第二份 ACP 与仍活着的远端进程并行。打开必须等到 Connect 成功或用户取消等待；若用户坚持打开而隧道失败，才 spawn+load，并在 UI 标明可能与仍在跑的旧进程冲突（`DELIVERY_UNKNOWN` 同类诚实）。默认：Connect 成功后再打开。

P3 产品表对 SSH 的可读表述：**关掉 / 重启本机 Peri 不会杀掉远端 agent；再次打开 Peri 后会自动尝试把隧道接回去（可关闭）。接上之前对话显示中断。** 缓冲有界承诺只覆盖隧道仍在的短暂 server 重启，不覆盖「本机关机一小时」。

---

## 6. 供应管道

每条未归档 SSH 机器同一时刻最多一条管道。键是 `instance_id` + `pipeline_generation`（单调）。同 `commandId` 只覆盖 **admit / 元数据命令** 本身，不覆盖远端 start。

### 6.1 步骤表

| 顺序 | 步骤 id | 做什么 | 成功证据 | 失败 `machines.error_code` |
| --- | --- | --- | --- | --- |
| 0 | `admit` | 校验、唯一性、插入或复用行、`phase=pending`、generation++ | SQLite 提交 | 见 §10 wire |
| 1 | `host_key_probe` | **不** BatchMode 连接。`ssh-keyscan`（钉死 `HostKeyAlgorithms`）采集公钥行，算 SHA256 | 得到完整 known_hosts 行 | `ssh_connect_failed` / `ssh_host_key_mismatch` |
| 1b | `awaiting_host_key` | 文件中无匹配行：投影指纹，等 `machine/trust-host` | 用户 Trust 且指纹逐字节相等 | 取消 → `failed` |
| 1c | `ssh_connect` | **仅当** Peri known_hosts 已有匹配行：BatchMode 会话 | 远端 shell | `ssh_auth_*` / `ssh_connect_failed` |
| 2 | `probe` | `uname -s/-m`；约定路径 `--version` 或未安装 | OS/arch + 版本或缺失 | `ssh_exec_failed` / `remote_os_unsupported` |
| 3 | `install` | 见 §7.3。先停旧 owner 再 rename 安装 | 绝对路径可执行且版本对齐 | `instance_binary_*` |
| 4 | `provision` | 签发或复用 token，scp `0600`，建 data-dir | 远端权限正确 | `token_provision_failed` |
| 5 | `tunnel` | `ssh -N -R 127.0.0.1:0:127.0.0.1:<listen>`，解析 Allocated port，写入 `remote_forward_port` | 本机 ssh 进程存活且 `ExitOnForwardFailure` | `tunnel_failed` |
| 6 | `start` | 仅当远端 data-dir **无**活 owner lock：经 ssh exec 启动 connect | owner fingerprint 可记录 | `connect_start_failed` |
| 7 | `connecting` | 等该 `instance_id` hello 且可服务 | hello | `hello_timeout` |
| 8 | `online` | `phase=online` | 管理页 Online | — |

Connect / 自动重连从步骤 5 起跑（已知 Trust、二进制与 token 仍在）。若 probe 发现协议版本变化，先走 3 再 5。**每次 Connect 重新 `-R :0`**，不得死守旧端口。**【v1.2】** 动态端口与远端 `connect` URL 绑定：隧道重建后 **必须** 同步 restart connect（或 owner shutdown → tunnel → start），禁止「owner lock 仍在则只建隧道」单独成功。Disconnect tunnel 后重连同理。

### 6.2 副作用分类（幂等）

| 阶段 | 外部效果 | Ack / 重试 |
| --- | --- | --- |
| admit | SQLite 行 | metadata_commands 幂等；`committed` = 行可见。同 commandId 重放不二开管道 |
| host_key / ssh / probe | 无 Peri token | 失败可从该步 Retry |
| install | 远端文件 | 失败可 Retry；成功则幂等跳过 |
| provision | 远端 token 文件 | **不得新签发**；复用未吊销同名 token。scp 失败可重传同一 secret |
| tunnel | 本机 ssh 进程 | 可拆可建 |
| start 及之后 | 远端进程 | **非幂等**。`machine/cancel` 若已执行 start → wire `DELIVERY_UNKNOWN`，phase=`failed`，`error_code=connect_delivery_unknown`，**禁止自动再 start**。用户 Retry 必须先 Stop 或确认无 owner lock |

server 进程重启：所有 `kind=ssh` 且 phase 属于进行中集合（`pending`…`connecting`、`awaiting_host_key`）→ `failed` + `server_restarted`，busy 清除。然后按 A 对合格行 **新开** Connect（generation++），不从半截 scp 续传。

hello_timeout：`failed`，**不**再 spawn。Retry：若 owner lock 仍在，只建隧道；否则先 Stop 再 start。超时默认 60s（跨网络 + 冷启动）；不向 Web 暴露旋钮。

### 6.3 取消

- `machine/cancel`：仅进行中管道。未 start：拆隧道、phase=`failed`/`canceled`，wire `committed`。
- 已 start：wire `DELIVERY_UNKNOWN`，记录可能仍活，UI 引导 Stop agents。
- 已 hello：cancel 为 `INVALID_STATE`，应 Disconnect tunnel 或 Stop agents。
- **关闭 Add 对话框 / Esc / 点遮罩 ≠ cancel。** 管道继续；必须 toast「Still adding …」并在列表行显示进度。

### 6.4 OpenSSH 不变量（开工清单）

所有调用必须是 **参数数组**（`execvp`），禁止 `sh -c`。destination 放在 `--` 之后。拒绝：空、NUL、控制字符、前导 `-`、`://`、`user:pass@`、空白、长度 > 255。

固定 `-o`（用户 config 仍可读，但下列项 **命令行覆盖**）：

- `BatchMode=yes`（probe 采集与 `-N` 隧道；**host_key_probe 用 ssh-keyscan，不用这条连接**）
- `StrictHostKeyChecking=yes`
- `UserKnownHostsFile=<data_dir>/ssh/known_hosts`
- `GlobalKnownHostsFile=/dev/null`（或 OS 等价）
- `ControlMaster=no`
- `ControlPath=none`
- `ExitOnForwardFailure=yes`（隧道进程）
- 若有 identity：`IdentitiesOnly=yes` 且 `-i` 为绝对路径或 `./` 开头，拒绝前导 `-`，拒绝位于 `config_dir` / `data_dir` 的路径（防止把 Peri token 当密钥）

隧道：`-N -R 127.0.0.1:0:127.0.0.1:<listen_port>`。解析 Allocated port 失败则 `tunnel_failed`。Identity 内容 **不得**读进 server 内存或日志；只把路径交给 ssh。

`ProxyJump` / `Host` 别名交给用户 config。产品不解析该文件。跳板要口令时与直连一样 `ssh_auth_interactive_required`。

---

## 7. 身份、凭据、安装

### 7.1 `instance_id` 与唯一性

- `local` 保留。SSH 首次 admit 生成 `ssh_<ulid>`（小写）。
- 即 token `name` 与 InstanceRegistry 键。`TokenStore` 必须保证 **未吊销 instance token 的 name 唯一**；不得「取第一条同名」。
- 展示名独立，默认 destination；rename 不改 id。
- **未归档唯一约束：** `normalize(ssh_destination) + coalesce(ssh_port,0)`。冲突：wire `INVALID_STATE`，payload/message 带已有 `instance_id`，UI 聚焦该行并 Connect/Retry，禁止第二条管道。
- 墓碑（`archived_at` 非空）：`machine/restore` 清归档、**同一** `instance_id`、新签发 token（旧已吊销）、从 probe 起跑。

### 7.2 Token

- 角色 `instance`。本机写临时 `0600` 再 scp；远端必须 `0600`，否则 fail-closed 并删本机临时文件。
- 审计只记 token id。token 正文禁止进入日志、Ack、Registry、toast、scp argv 诊断。
- Remove 成功后吊销。Restore 新 secret、同一 name。

### 7.3 二进制

| 条件 | 行为 |
| --- | --- |
| 远端 OS/arch = `current_exe` | scp 到 `.tmp` → fsync → rename 到约定路径 → `0755` |
| 不同 arch/OS | 按 **本机产品 semver** 下载匹配 target 的 release 二进制与同名 `.sha256`；本机强制校验后再 scp（同上原子安装） |
| 已安装且协议版本一致 | 跳过 |
| 已安装但协议版本不同 | **先**经 ssh exec 对 data-dir 做 owner shutdown（fingerprint fail-closed，禁止裸 PID），**再**安装，**再** start |
| 无资产或 checksum 失败 | `instance_binary_unavailable` |
| 其他 uname | `remote_os_unsupported` |

约定路径（不可改成任意远端绝对路径）：

```text
~/.local/share/peri-studio/bin/peri-studio
~/.local/share/peri-studio/instances/<instance_id>/instance.token    # 0600
~/.local/share/peri-studio/instances/<instance_id>/                  # data-dir
```

替换正在使用的二进制必须走「停 → rename → start」。Linux 直接覆盖运行中 inode → `ETXTBSY` 视为 `instance_binary_install_failed`。**首次替换已有 peri-studio 须 UI 确认**（Add 进度里 Confirm replace）；自动重连路径：版本不齐则失败并要用户在管理页确认，避免无交互覆盖用户自己的 server 二进制。

checksum 信任锚：固定为本机产品 semver 对应的 GitHub Release，同一 release 中的二进制与同名 `.sha256` 必须同时下载并匹配；不是「GitHub 上最新」。缺少 target 资产、checksum 文件或校验失败时，跨 arch 直接 `instance_binary_unavailable`。

---

## 8. 持久化与投影

### 8.1 SQLite（迁移 V7）

`machines` 表为权威。禁止存：私钥、token 正文、口令、known_hosts 公钥行以外的密钥材料。pending Trust 的公钥行可暂存在 `pending_host_key_line`（0600 语义由 DB 文件权限承担），Trust 后写入文件并清空列。

| 列 | 含义 |
| --- | --- |
| `instance_id` | PK |
| `kind` | `local` \| `ssh` |
| `display_name` | 展示名 |
| `ssh_destination` | 不含密码 |
| `ssh_port` | 可空 |
| `identity_file` | 本机绝对路径或空；**不**投影到 Y.Doc |
| `auto_reconnect` | 默认 1 |
| `remote_forward_port` | 上次成功 Allocated port；Connect 时作废重分 |
| `pipeline_generation` | 单调 |
| `phase` | §6.1 / 生命周期 |
| `error_code` | 域错误；成功空 |
| `host_key_sha256` | 已信任指纹 |
| `pending_host_key_fingerprint` | 等待 Trust 时 |
| `pending_host_key_line` | 等待 Trust 的完整行 |
| `remote_owner_fingerprint` | 可空 |
| `created_at` / `updated_at` | RFC3339 |
| `archived_at` | 墓碑 |

`local` 行由 local 模式启动确保存在。未归档 `(ssh_destination, ssh_port)` 唯一索引（仅 `kind=ssh`）。

**进程重启修复：** 进行中 phase → `failed`/`server_restarted`（见 §6.2）。

### 8.2 磁盘白名单（修订 architecture §8.4）

除 `metadata.sqlite3` 与既有 token/config 文件外，本设计允许：

- `<data_dir>/ssh/known_hosts`（`0600`，Trust 写入完整行）
- `<data_dir>/ssh/` 目录 `0700`

不修改用户 `~/.ssh/known_hosts`。

### 8.3 Registry schema v3

新增 `machines` map（SQLite 单写投影，与 `projects` 同模式）。旧客户端忽略未知键。

投影字段（**仅这些**）：`instanceId`、`kind`、`displayName`、`sshDestination`、`sshPort`、`phase`、`errorCode`、`hasIdentityFile`（布尔）、`autoReconnect`、`hostKeySha256`（仅 `awaiting_host_key` 时非空）、`updatedAt`、`archivedAt`（默认列表过滤非空）。

**禁止投影：** `identity_file` 路径、token、`pending_host_key_line`、内部 fingerprint 以外的连接串。

`instances` map 仍只反映 live hello/心跳。管理页 join：`machines[id]` 为列表源；`instances[id]` 覆盖 Online 与 hostname、`chat_count`。

phase 更新：按步骤切换写 Doc，禁止每秒进度。`connecting` 等待 hello 不刷 Yjs。

---

## 9. 生命周期动作

```text
add → 管道 → online ⇄ offline
                │
                ├── disconnect → 拆隧道，connect 仍退避，ACP 保留
                ├── stop → exec owner shutdown + kill ACP，拆隧道，offline
                ├── connect / auto_reconnect → tunnel…（无 owner 才 start）
                ├── 隧道随 studio 死 → offline，ACP 保留
                └── stop 成功后才允许 remove → 墓碑 + 吊销
restore(墓碑) → 新 token，同一 id，从 probe 起
```

| 动作 | 隧道 | 远端 connect | ACP | 记录 | Token |
| --- | --- | --- | --- | --- | --- |
| Disconnect tunnel | 关 | 保留（退避连死端口） | 保留 | offline | 保留 |
| Connect | 重建 | 有 owner 则只隧道；无则 start | 对账，禁止无判据再 spawn | → online | 保留 |
| Stop agents | 关 | owner shutdown（经 **ssh exec**，不经已拆的 `-R`） | 经仍活的 instance 连接 kill；无 hello 则只 shutdown connect | offline | 保留 |
| Remove | 已关 | 必须已 Stop | 无非终态 runtime | `archived_at` | 吊销 |
| Restore | — | — | — | 清归档 | 新签发 |

Stop 的 owner shutdown：沿用 instance data-dir Unix socket HMAC 关闭语义，命令经 **另一次 ssh exec** 调用远端二进制/脚本，**禁止裸 PID**。SSH 当时不可用 → Stop 失败，Remove 仍拒绝。

Remove fail-closed：存在非终态 runtime、Stop 未 committed、或无法读取 runtime 状态。

本机 studio **退出**：隧道必须死。若存在 SSH 机器上非终态 runtime，退出前对话框：Keep running / Stop then quit。默认 Keep running。无此类 runtime 则静默退出。

`auto_reconnect=false` 的行启动后保持 Offline，直到用户 Connect。

---

## 10. 协议：Web → server

浏览器只发 Action。`machine/*` 与 `project/*` 同属 **元数据域**：`committed` = SQLite + Registry 屏障（**不是** ACP stdin）。架构 §4.4 对 chat 域的 stdin 定义不变。

| type | payload | 语义 |
| --- | --- | --- |
| `machine/add` | `{ destination, displayName?, port?, identityFile? }` | 唯一性 + admit + 启动管道。`committed` 带 `instanceId` |
| `machine/connect` | `{ instanceId }` | 从 tunnel 起；`committed` = 管道已受理（非 Online） |
| `machine/disconnect` | `{ instanceId }` | 拆隧道 |
| `machine/stop` | `{ instanceId }` | Stop agents；越过 shutdown 且结果不清 → `DELIVERY_UNKNOWN` |
| `machine/cancel` | `{ instanceId }` | §6.3 |
| `machine/retry` | `{ instanceId }` | 仅 `failed`；**新 commandId**；同 id/token |
| `machine/trust-host` | `{ instanceId, fingerprint }` | 与 `pending_host_key_fingerprint` 逐字节相等后写 known_hosts |
| `machine/rename` | `{ instanceId, name }` | 展示名 |
| `machine/set-auto-reconnect` | `{ instanceId, enabled }` | 布尔 |
| `machine/remove` | `{ instanceId }` | §9 |
| `machine/restore` | `{ instanceId }` | 墓碑恢复 |

禁止对 `local`：connect/disconnect/stop/remove/restore/trust-host/retry（stop local 不是本设计；关本机会话用现有 chat/close）。read-only：`FORBIDDEN`，UI 不发送。

**wire `action_error.code` 只允许现有 `ErrorCode`。** 域细节在 `machines.error_code` 与脱敏 `message`。

| 场景 | wire code | retryable |
| --- | --- | --- |
| 只读 | `FORBIDDEN` | false |
| 形状非法、对 local 误用、busy、唯一冲突、未 Stop 就 Remove、指纹不符、phase 不允许 | `INVALID_STATE` | false |
| SSH 暂不可达、hello 等待中超时且确定未 start | `AGENT_UNAVAILABLE` | true |
| 已 start 的 cancel/stop/install 停进程结果不清 | `DELIVERY_UNKNOWN` | false |
| 未知 id | `INVALID_STATE` | false |

`machine/add` 的 `committed` 不表示 Online。管道失败 **不**对原 add commandId 发第二终态；列表 `error_code` 为准。Add 对话框超时：与 catalog 相同「结果尚未确认」，**同一 commandId** 只用于承认已受理；用户点 Retry 发 **新** `machine/retry`。

---

## 11. 机器管理页

### 11.0 动词与入口

英文 UI 只用 §3 表。禁用 Mount、不要把副标题做成 `local` 协议词（用 Built-in）。

入口：

1. 侧栏底栏 **可见短标签 Machines**（图标 Monitor）。这是管理，不是帮助。命中白纸「图标被误解则恢复标签」。
2. Dialog 标题 Machines；页签 Machines | About。About 只放连接/健康/schema。
3. 等待 Trust、failed、隧道应自动连却 Offline：入口打点。
4. 左栏空项目 / New project 无 Online 远端时：Add a computer 链到本页。
5. 窄视口全屏同一 Dialog（loopback 桌面窄窗，**不是**宣称手机远程运维）。

read-only：可浏览；mutation 禁用；**不自动弹 Trust**；显示 Waiting for the owner to trust this host。

### 11.1 列表

local 置顶，其余按 displayName。**不**嵌套 chat 树，**不**显示 runtime `chat_count`（左栏才是对话）。

Local：This computer · Built-in · 状态。无 SSH 动作。溢出菜单禁用项说明 This is the computer running Peri.

SSH 行：displayName · destination[:port] · 状态 · 动作。溢出：Rename、Disconnect tunnel 或 Connect、Stop agents、Remove from Peri、Toggle auto-reconnect。破坏性有确认。

空态：删除 “No machines connected”。SSH 为零时：Add a remote computer over SSH to run agents on another computer. 页脚贴 §2.3 三句边界。

### 11.2 状态文案

| 条件 | 点 | 文案 | 主动作 |
| --- | --- | --- | --- |
| 管道步骤 | 脉冲 | Checking SSH… / Waiting for you to trust this host… / Installing Peri Studio… / Downloading linux-x64 build… / Copying Peri Studio… / Starting instance… / Waiting for instance… | Cancel |
| `awaiting_host_key` | 警告 | Trust this host to continue | Trust 对话框（管理页已开则自动一次；否则靠入口打点，不静默） |
| live online | 成功 | Online | Disconnect tunnel |
| offline，无管道 | 中性 | Offline | Connect |
| failed | 危险 | §11.4 | Retry |
| removing | 脉冲 | Removing… | 无 |

第一次该机器 Online：一句（非色块）Agents keep running on that computer if you quit Peri or disconnect the tunnel. Use Stop agents to shut them down.

会话头现有 Online = **本机面板到 server**。机器行 Online = **该电脑的 instance**。不得在会话头复用同一词表示 GPU。会话头保持现有连接文案；机器状态只在 Machines 与侧栏分组。

### 11.3 错误句（可执行）

每条：原因 + 一个动作。失败 Close 文案 Keep this computer in the list to retry. 主按钮 Retry 不是再开 Add。

| error_code | 句子 | 动作 |
| --- | --- | --- |
| `ssh_auth_interactive_required` | SSH needs a key in the agent on the computer running Peri. | Copy `ssh-add` hint；Copy `ssh <dest>` |
| `ssh_auth_failed` | SSH could not authenticate. Check the destination and keys on this computer. | Copy ssh |
| `ssh_host_key_mismatch` | The host key changed. Peri refused to connect. Verify the host, then Remove from Peri and add it again. | 无 Trust |
| `ssh_connect_failed` | Could not reach the SSH host. Check VPN, hostname, and port. | Retry |
| `tunnel_failed` | Could not open an SSH tunnel. The host may disable TCP forwarding. | Retry |
| `instance_binary_unavailable` | No Peri Studio build is available for that computer’s system (or checksums are missing). | 无 |
| `instance_binary_install_failed` | Could not install Peri Studio on that computer. | Retry |
| `hello_timeout` | The remote instance did not connect in time. | Retry |
| `connect_delivery_unknown` | The remote instance may already be running. Stop agents before retrying. | Stop agents |
| `server_restarted` | Peri restarted while adding this computer. | Connect / Retry |
| `machine_has_live_runtime` | Stop agents on this computer before removing it from Peri. | Stop agents |
| 其他 | Could not add this computer. | Retry |

`instance_binary_unavailable` **不要**写成「该系统不受支持」，除非 `remote_os_unsupported`。

### 11.4 Add computer 对话框

前提短句（提交前可见）：Uses OpenSSH on the computer running Peri. Put keys in ssh-agent or pick an identity file. Passwords cannot be entered here.

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| Destination | 是 | `user@host` 或 ssh config Host |
| Display name | 否 | 默认 destination |
| Port | 否 | |
| Identity file | 否 | 本机绝对路径；提供与目录选择器同类的 **本机文件选取**（只回路径，不读内容） |

校验同 §6.4。同一 destination 已有未归档行或进行中管道：禁止提交，打开该行。

提交后切进度（aria-current）。成功 Online 关闭 + toast Computer online。失败留在对话框。Esc/遮罩：关窗、管道继续、toast Still adding {name}…。

嵌套模态：Trust 叠在 Add 上时，Esc 先关 Trust；Add 进度开着时 Esc 关 Add 进度窗但不 cancel。

### 11.5 Trust host

算法名 + SHA256 等宽可复制。This fingerprint is stored only for Peri Studio. Cancel = `machine/cancel`。mismatch 无 Trust。

### 11.6 Disconnect / Stop / Remove 确认

- Disconnect tunnel：Agents on this computer keep running. Only the tunnel to this Peri will close.
- Stop agents：This stops Peri Studio and agents on that computer. Conversations stay saved.
- Remove：This removes the computer from Peri and revokes its access. Agents must be stopped first. Offline 时主路径是 Reconnect, stop agents, then remove，不是直接 Remove。

### 11.7 新建 project / 侧栏

New project **必须**：

1. Computer：Online 列表；Connecting 可见但禁用，旁注 Adding… 链到 Machines。
2. Folder：**该计算机上的路径**。local → 现有本机选夹。SSH → 经已有 resource/FS 协议列目录（instance Online 后）。禁止在 SSH 目标上弹出本机 Browse。
3. 侧栏分组上的 ＋ **带上该组 `instance_id`**。

`project/create`：绑定 SSH 时 `instance_id` 必填且必须 Online；`cwd` 为远端路径。缺省 `instance_id` 仍表示 local（兼容），UI 不得在用户选了远端时省略。

资源工作台：Disconnect 后远端租约失败，显示该计算机 Offline + Connect，不把错误写成文件损坏。

---

## 12. 用户旅程（验收）

1. **首次成功（含 Mac→Linux）：** Machines → Add computer → Trust（若需要）→ 确认替换（若远端已有二进制）→ Online → New project 选该电脑 + 远端目录 → 对话可跑。刷新浏览器不杀远端 agent。
2. **ssh-agent：** 失败句可执行 → `ssh-add` → Retry 同机不同 commandId。
3. **关对话框：** Add 进度 Esc → 列表仍 Installing → 不得出现第二行同一 destination。
4. **Disconnect / Connect：** 拆隧道 → 会话 interrupted；Connect → 同一 ACP 对账，不无故第二进程。
5. **Stop then Remove：** Stop → 无 live runtime → Remove → 墓碑。Restore → 同一 id Online，旧 project 仍能绑该 id。
6. **启动自动重连：** 退出 Peri（Keep running）→ 再打开 → local Healthy 立刻可操作 → SSH 自动 Connecting → Online。agent 关 `auto_reconnect` 的行保持 Offline。
7. **Restarting 不自锁：** SSH 上曾有 runtime，本机重启后 **不** 卡在 Restarting；可建 local 项目；SSH 未连上时不能把该远端当 Online 选夹。
8. **read-only：** 能看不能改，不弹 Trust。
9. **密码主机：** 明确失败，Copy ssh，不提供密码框。

---

## 13. 安全与审计

- Web 只提交 destination 与本机路径字符串。server/app 不把 Identity 文件读进业务内存。
- destination 当不可信字符串：argv 数组、长度与字符白名单。
- Token 与 known_hosts 文件 `0600`。审计：`instance_id`、规范化 hostname（不要完整 `user@`）、结果码、耗时、generation。禁止 token、私钥、scp 含 token 的 argv。
- host key mismatch 无 override。
- 不降低 HMAC，不开放非回环明文 ws。

---

## 14. 模块与测试

| 模块 | 职责 |
| --- | --- |
| `server` `MachineService` | SQLite、准入、phase、Registry、token **id** 签发请求、恢复分类（SSH 不进全局 barrier） |
| `app` `SshBackend` | OpenSSH/scp/ssh-keyscan、隧道监督、exec |
| `instance/` | 无隧道语义；可选：loopback refused 日志降级 |
| Web `MachineActions` | 与 CatalogActions 同级 |
| Web New project | 机器 + 该机器目录 |

CommandCoordinator 只路由。MachineService 不碰 chat executor / ACP 通道。

**测试门禁：**

1. Fake ssh：断言 argv 含 BatchMode、ControlMaster=no、UserKnownHostsFile、`-R 127.0.0.1:0:...`、destination 在 `--` 后、拒绝前导 `-`。
2. Host key 状态机：未知 → awaiting；Trust 写行后再 BatchMode；mismatch 无 override。
3. 同 destination 第二次 add → INVALID_STATE。
4. server 重启：进行中 → `server_restarted`；local 可操作；SSH id 不在全局 Restarting pending。
5. hello_timeout 后 Retry 在 owner lock 存在时不第二 start。
6. 真 sshd 契约（可 `ignore`/单独 job）：add → hello → disconnect → connect；另测未知 host 与 mismatch。
7. Web：列表非树、Add Esc 不 cancel、New project SSH 不用本机选夹、read-only 不发帧。

---

## 15. 分阶段（R2 必须能讲 Mac→Linux）

| 阶段 | 交付 |
| --- | --- |
| R1 | V7 + Registry v3 投影 + Machines 列表（local + 空态 + 入口标签）+ Add 表单校验（不调 ssh）+ New project 机器字段（仍可只 local） |
| R2 | SshBackend 全管道、host key、同 arch scp **与** 钉选 checksum 跨 OS 安装、自动重连、Disconnect/Stop、Restarting 修补、fake ssh 单测 |
| R3 | Remove/Restore 门禁、远端选夹、侧栏 ＋ 带 instance_id、替换确认、退出对话框 |
| R4 | CLI 同源（经运行中 server，禁止直接改 SQLite）、隧道指标（无敏感标签） |

R1 的 Add 提交必须 `INVALID_STATE`「not available yet」或隐藏提交，**禁止**假进度。R2 起才允许真管道。

---

## 16. 验收清单

- [ ] `/instance` + HMAC；无 `--allow-insecure`；listener 仍 loopback；`-R` 只 bind 远端 127.0.0.1。
- [ ] `server/` 无 ssh 进程；app 注入 backend。
- [ ] SSH id 不进全局 Restarting；重启后 local 可操作。
- [ ] 隧道随 studio 死；不杀远端 ACP；合格行 Healthy 后自动建隧道。
- [ ] destination 未归档唯一；同 commandId 不二开 admit；start 后 cancel 为 DELIVERY_UNKNOWN。
- [ ] token/私钥/identity 路径不进 Y.Doc/日志/Ack。
- [ ] 管理页完成 Add/Trust/Retry/Disconnect/Stop/Remove/Restore；Esc ≠ cancel。
- [ ] New project：Online 机器 + 该机器目录。
- [ ] wire 错误只使用现有 ErrorCode；域码在 `machines.error_code`。
- [ ] `machine/*` 与 proto whitelist 同 PR。
- [ ] fake ssh + 重启契约测试绿灯；真 sshd 至少一条 add→hello→disconnect→connect。
