//! instance 注册表（架构 §7.1/§4.5/§7.5）。
//!
//! instance 生命周期（REGISTERED → ONLINE ⇄ OFFLINE）+ 指令下发（spawn/kill/
//! forward_rpc）+ ack 跟踪（oneshot 回填 + 超时）+ hello 幂等替换（fencing）。
//! 判定性时间戳由 server 权威时钟（§4.7：`last_heartbeat` 用 [`Instant`]）。

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::{mpsc, oneshot, RwLock};
use tokio_util::sync::CancellationToken;
use tracing::{debug, info, warn};

use peri_studio_proto::frame::Frame;
use peri_studio_proto::instance::{
    InstanceForwardAck, InstanceHeartbeat, InstanceHello, InstanceKill, InstanceKillAck,
    InstanceProcessExit, InstanceSpawn, InstanceSpawnAck,
};
use peri_studio_proto::resource::InstanceResourceResult;

use crate::channel::OutboundMsg;
use crate::control::{ChatRegistry, ChatState};

/// instance 生命周期状态（§7.1 图）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstanceState {
    /// hello 成功（含双向认证，§9.2 步骤 2）。
    Registered,
    /// 心跳活跃。
    Online,
    /// 心跳超时（默认 30s）/ 连接断开。
    Offline,
}

impl InstanceState {
    /// 是否可接收指令（spawn/kill/forward_rpc）。
    pub fn can_serve(self) -> bool {
        matches!(self, InstanceState::Registered | InstanceState::Online)
    }

    /// 状态标签（脱敏日志）。
    pub fn as_str(self) -> &'static str {
        match self {
            InstanceState::Registered => "registered",
            InstanceState::Online => "online",
            InstanceState::Offline => "offline",
        }
    }
}

/// instance 在线连接句柄（fencing 后失效）。
#[derive(Debug, Clone)]
pub struct InstanceConn {
    /// 连接发送通道（gateway 的 ws 发送队列）。
    pub tx: mpsc::Sender<OutboundMsg>,
}

/// ack 回填（§4.5：spawn_ack/kill_ack/forward_ack 按 command_id 路由）。
#[derive(Debug, Clone, PartialEq)]
pub enum InstanceAck {
    /// `instance/spawn_ack`。
    Spawn(InstanceSpawnAck),
    /// `instance/kill_ack`。
    Kill(InstanceKillAck),
    /// `instance/forward_ack`（下行 JSON-RPC 转发确认，L1+L2，§4.4）。
    Forward(InstanceForwardAck),
    /// `instance/resource_result`（按 request_id 路由）。
    Resource(InstanceResourceResult),
    /// `instance/process_exit`（无 command_id，按 chat 路由）。
    ProcessExit(InstanceProcessExit),
}

/// hello 处理产物（补推协调输入，§4.5/§7.5）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HelloOutcome {
    /// 是否 fencing 了旧连接（§4.5 幂等替换）。
    pub fenced_previous: bool,
    /// `buffer_lost` 上报（daemon 崩溃缓冲丢失，§7.5）。
    pub buffer_lost: bool,
    /// instance 声称存活的 chat 清单（§8.3 对账输入）。
    pub alive_sessions: Vec<String>,
    /// per-chat 流纪元映射（§4.5.1）。
    pub chat_epochs: HashMap<String, u64>,
}

/// 权威心跳快照的变化语义。Gateway 只把这个 outcome 交给恢复协调器，
/// 不自行推断“空列表是否可信”或“是否已经完成启动恢复”。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HeartbeatOutcome {
    /// hello 后收到的第一个 authoritative `alive_sessions` 快照。
    pub first_snapshot: bool,
    /// 与上一份 authoritative 快照相比是否变化；首份恒为 true。
    pub changed: bool,
}

/// 指令下发结果。
#[derive(Debug, Clone, PartialEq)]
pub enum SpawnOutcome {
    /// spawn_ack 已回填。
    Acked(InstanceSpawnAck),
}

/// 指令下发结果。
#[derive(Debug, Clone, PartialEq)]
pub enum KillOutcome {
    /// kill_ack 已回填。
    Acked(InstanceKillAck),
}

/// instance 注册表错误。
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum InstanceError {
    /// instance 未登记（hello 未到达）。
    #[error("instance not registered: {0}")]
    UnknownInstance(String),
    /// instance 离线（OFFLINE，§7.1）。
    #[error("instance offline")]
    Offline,
    /// 下发超时（spawn 10s / kill 10s / forward 10s，§6.2/§16）→ AGENT_UNAVAILABLE(retryable)。
    #[error("command timeout")]
    Timeout,
    /// instance 侧转发确认失败（`instance/forward_ack` ok=false：ACP 进程已
    /// 退出/管道关闭等）→ AGENT_UNAVAILABLE(retryable)。
    #[error("forward rejected: {0}")]
    ForwardRejected(String),
    /// 连接已 fencing/关闭。
    #[error("instance connection gone")]
    ConnectionGone,
    /// JSON-RPC 帧协议形态错误（如 `forward_rpc` 缺 `id`）——是帧构造
    /// 异常而非连接消失，归类 ConnectionGone 会误导上层走重连/失败路径。
    /// 映射为稳定错误码 `INVALID_STATE`（确定性失败，非 retryable）。
    #[error("malformed JSON-RPC frame: {0}")]
    MalformedFrame(String),
    /// instance 未声明当前资源协议能力，不能向其发送资源帧。
    #[error("instance does not support the resource protocol")]
    ResourceUnsupported,
    /// instance 未声明终端协议能力。
    #[error("instance does not support the terminal protocol")]
    TerminalUnsupported,
}

/// instance 条目（进程内状态）。
struct InstanceEntry {
    state: InstanceState,
    token_id: String,
    hostname: String,
    resource_protocol_version: Option<u32>,
    resource_write: bool,
    terminal_protocol_version: Option<u32>,
    terminal_ready: bool,
    conn: Option<mpsc::Sender<OutboundMsg>>,
    disconnect: Option<CancellationToken>,
    last_heartbeat: Instant,
    /// command_id → ack oneshot（spawn/kill ack 跟踪，§4.5）。
    pending_acks: HashMap<String, oneshot::Sender<InstanceAck>>,
    /// hello 上报的 per-chat 流纪元（§4.5.1；relay 入站校验输入）。
    chat_epochs: HashMap<String, u64>,
    /// 最近 authoritative heartbeat 的 alive_sessions；hello 不携带该字段，
    /// 因此必须以 None 区分“尚未知晓”和“已确认空集合”。
    alive_sessions: Option<Vec<String>>,
    /// 最近 hello 的 buffer_lost。
    buffer_lost: bool,
}

/// instance 生命周期注册表（§7.1）。
#[derive(Clone)]
pub struct InstanceRegistry {
    inner: Arc<InstanceInner>,
}

struct InstanceInner {
    instances: RwLock<HashMap<String, InstanceEntry>>,
    /// 离线判定超时（§16 默认 30s）。
    offline_timeout: Duration,
    /// spawn/kill 下发超时（§6.2/§16 默认 10s）。
    cmd_timeout: Duration,
    chats: ChatRegistry,
}

impl InstanceRegistry {
    /// 以离线超时与指令超时构建（§16：30s / 10s）。
    pub fn new(offline_timeout: Duration, cmd_timeout: Duration, chats: ChatRegistry) -> Self {
        InstanceRegistry {
            inner: Arc::new(InstanceInner {
                instances: RwLock::new(HashMap::new()),
                offline_timeout,
                cmd_timeout,
                chats,
            }),
        }
    }

    /// hello 处理（认证在 gateway 完成，§9.2；§4.5 幂等替换）：同 instance_id
    /// 新连接 → 旧连接 fencing（旧连接事件丢弃、关闭）；注册/替换连接与
    /// capability 输入。返回 [`HelloOutcome`]；authoritative 对账输入只来自
    /// 后续 heartbeat，hello 的空集合不得用于孤儿清理。
    pub async fn on_hello(
        &self,
        instance_id: &str,
        token_id: &str,
        conn: InstanceConn,
        hello: &InstanceHello,
    ) -> HelloOutcome {
        self.register_connection(instance_id, token_id, conn, hello, None)
            .await
    }

    /// 生产 gateway 注册入口：绑定强制断链令牌，供关键清理帧背压失败时 fail-close。
    pub async fn on_connection_hello(
        &self,
        instance_id: &str,
        token_id: &str,
        conn: InstanceConn,
        hello: &InstanceHello,
        disconnect: CancellationToken,
    ) -> HelloOutcome {
        self.register_connection(instance_id, token_id, conn, hello, Some(disconnect))
            .await
    }

    async fn register_connection(
        &self,
        instance_id: &str,
        token_id: &str,
        conn: InstanceConn,
        hello: &InstanceHello,
        disconnect: Option<CancellationToken>,
    ) -> HelloOutcome {
        let mut instances = self.inner.instances.write().await;
        let fenced = if let Some(old) = instances.get(instance_id) {
            if let Some(disconnect) = &old.disconnect {
                disconnect.cancel();
            } else if let Some(old_tx) = &old.conn {
                // 测试/嵌入式调用没有强制断链令牌时，仍以有界非阻塞 close fencing。
                let _ = old_tx.try_send(OutboundMsg::Close(1011));
            }
            true
        } else {
            false
        };
        let epochs = hello.stream_epochs.clone().unwrap_or_default();
        // M1 hello 无存活清单字段（§4.5 表 instance/hello 无 alive_sessions；
        // 存活清单经 instance/heartbeat 上报，§8.3 对账在其后由心跳驱动）。
        let alive: Vec<String> = Vec::new();
        let buffer_lost = hello.buffer_lost.unwrap_or(false);
        instances.insert(
            instance_id.to_string(),
            InstanceEntry {
                state: InstanceState::Online,
                token_id: token_id.to_string(),
                hostname: hello.hostname.clone(),
                resource_protocol_version: hello
                    .caps
                    .pointer("/resources/protocolVersion")
                    .and_then(serde_json::Value::as_u64)
                    .and_then(|value| u32::try_from(value).ok()),
                resource_write: hello
                    .caps
                    .pointer("/resources/write")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false),
                terminal_protocol_version: hello
                    .caps
                    .pointer("/terminals/protocolVersion")
                    .and_then(serde_json::Value::as_u64)
                    .and_then(|value| u32::try_from(value).ok()),
                terminal_ready: disconnect.is_none(),
                conn: Some(conn.tx),
                disconnect,
                last_heartbeat: Instant::now(),
                pending_acks: HashMap::new(),
                chat_epochs: epochs.clone(),
                alive_sessions: None,
                buffer_lost,
            },
        );
        let (token_id, hostname, buffer_lost) = {
            let entry = instances.get(instance_id).expect("just inserted");
            (
                entry.token_id.clone(),
                entry.hostname.clone(),
                entry.buffer_lost,
            )
        };
        drop(instances);
        info!(
            instance_id,
            token_id,
            hostname,
            fenced,
            buffer_lost,
            alive_sessions = alive.len(),
            "instance hello registered (idempotent replace)"
        );
        HelloOutcome {
            fenced_previous: fenced,
            buffer_lost,
            alive_sessions: alive,
            chat_epochs: epochs,
        }
    }

    /// 心跳更新（§7.1：5s；alive_sessions 供对账，§8.3）。
    ///
    /// 返回首份/变化语义；对账、resume 与恢复门禁由 RecoveryCoordinator
    /// 串行拥有。M1 hello 无存活清单，首个空心跳同样是权威快照。
    #[cfg(test)]
    pub async fn on_heartbeat(
        &self,
        instance_id: &str,
        hb: &InstanceHeartbeat,
    ) -> Result<HeartbeatOutcome, InstanceError> {
        self.record_heartbeat(instance_id, None, hb).await
    }

    /// 生产 gateway 路径：heartbeat 必须来自当前登记连接。hello fencing 后
    /// 旧连接的滞后帧不能确认 runtime 或完成恢复 barrier。
    pub async fn on_connection_heartbeat(
        &self,
        instance_id: &str,
        conn: &InstanceConn,
        hb: &InstanceHeartbeat,
    ) -> Result<HeartbeatOutcome, InstanceError> {
        self.record_heartbeat(instance_id, Some(&conn.tx), hb).await
    }

    async fn record_heartbeat(
        &self,
        instance_id: &str,
        expected_conn: Option<&mpsc::Sender<OutboundMsg>>,
        hb: &InstanceHeartbeat,
    ) -> Result<HeartbeatOutcome, InstanceError> {
        let outcome = {
            let mut instances = self.inner.instances.write().await;
            let Some(entry) = instances.get_mut(instance_id) else {
                return Err(InstanceError::UnknownInstance(instance_id.to_string()));
            };
            if expected_conn.is_some_and(|expected| {
                !entry
                    .conn
                    .as_ref()
                    .is_some_and(|current| current.same_channel(expected))
            }) {
                return Err(InstanceError::ConnectionGone);
            }
            entry.last_heartbeat = Instant::now();
            entry.state = InstanceState::Online;
            let first_snapshot = entry.alive_sessions.is_none();
            let changed = first_snapshot
                || entry
                    .alive_sessions
                    .as_ref()
                    .is_some_and(|previous| previous != &hb.alive_sessions);
            entry.alive_sessions = Some(hb.alive_sessions.clone());
            HeartbeatOutcome {
                first_snapshot,
                changed,
            }
        };
        debug!(instance_id, load = hb.load, "instance heartbeat");
        Ok(outcome)
    }

    /// 离线判定 tick（与心跳同 tick）：`offline_timeout` 无心跳 → OFFLINE；
    /// 返回本次离线集合（由 hub 联动 `RelayEventHandler::on_instance_disconnect`，
    /// §7.1 离线即刻生效）。
    ///
    /// **连接句柄保留**：心跳超时只代表判定离线，TCP 连接可能仍存活；若清
    /// 空 `conn`，机器心跳恢复 → ONLINE 后仍不可服务（conn 无恢复路径），
    /// 而机器不会重连（连接健康）——服务瘫痪。真正断开由
    /// [`Self::on_disconnect`]（连接结束路径）清句柄。
    pub async fn sweep_offline(&self, now: Instant) -> Vec<String> {
        let mut instances = self.inner.instances.write().await;
        let mut offline: Vec<String> = Vec::new();
        for (id, entry) in instances.iter_mut() {
            if entry.state == InstanceState::Offline {
                continue;
            }
            if now.duration_since(entry.last_heartbeat) >= self.inner.offline_timeout {
                entry.state = InstanceState::Offline;
                offline.push(id.clone());
                warn!(
                    instance_id = id,
                    timeout_ms = self.inner.offline_timeout.as_millis() as u64,
                    "instance offline (heartbeat timeout)"
                );
            }
        }
        offline
    }

    /// 连接断开（gateway 连接结束路径）：仅当断开的是**当前登记连接**时置
    /// OFFLINE（§7.1 图：连接断开 → OFFLINE）+ 清连接句柄。
    ///
    /// hello fencing（§4.5 幂等替换）后，旧连接滞后断开不得触碰新连接状态
    /// ——以 `conn` 句柄比对（`same_channel`）识别陈旧断开，返回 false。
    /// 返回值 = 是否曾在线（供 gateway 决定是否触发断链清理，§8.2）。
    pub async fn on_disconnect(&self, instance_id: &str, conn: &InstanceConn) -> bool {
        let mut instances = self.inner.instances.write().await;
        let Some(entry) = instances.get_mut(instance_id) else {
            return false;
        };
        let is_current = entry
            .conn
            .as_ref()
            .is_some_and(|tx| tx.same_channel(&conn.tx));
        if !is_current {
            // 陈旧断开（fencing 后旧连接退出）：状态已被新 hello 替换。
            return false;
        }
        let was_online = entry.state != InstanceState::Offline;
        entry.state = InstanceState::Offline;
        entry.conn = None;
        entry.disconnect = None;
        was_online
    }

    /// 指令下发（§4.5）：发送 + ack 表登记 + 超时（spawn/kill 10s，§16）。
    /// 超时 → [`InstanceError::Timeout`]（→ AGENT_UNAVAILABLE retryable）；
    /// OFFLINE → [`InstanceError::Offline`]。
    pub async fn send_spawn(
        &self,
        instance_id: &str,
        cmd: InstanceSpawn,
    ) -> Result<SpawnOutcome, InstanceError> {
        let ack = self
            .send_command(
                instance_id,
                cmd.command_id.clone(),
                Frame::InstanceSpawn(cmd),
            )
            .await?;
        match ack {
            InstanceAck::Spawn(s) => Ok(SpawnOutcome::Acked(s)),
            _ => Err(InstanceError::ConnectionGone),
        }
    }

    /// 指令下发（§4.5）：kill + ack 跟踪（kill_ack；幂等——已死成功返回）。
    pub async fn send_kill(
        &self,
        instance_id: &str,
        cmd: InstanceKill,
    ) -> Result<KillOutcome, InstanceError> {
        let ack = self
            .send_command(
                instance_id,
                cmd.command_id.clone(),
                Frame::InstanceKill(cmd),
            )
            .await?;
        match ack {
            InstanceAck::Kill(k) => Ok(KillOutcome::Acked(k)),
            _ => Err(InstanceError::ConnectionGone),
        }
    }
    /// hello 上报的 per-chat 流纪元查询（relay 入站 epoch 校验，§4.5.1）。
    pub async fn chat_epoch(&self, instance_id: &str, chat_id: &str) -> Option<u64> {
        self.inner
            .instances
            .read()
            .await
            .get(instance_id)
            .and_then(|e| e.chat_epochs.get(chat_id).copied())
    }

    /// instance 状态查询（诊断/测试）。
    pub async fn state(&self, instance_id: &str) -> Option<InstanceState> {
        self.inner
            .instances
            .read()
            .await
            .get(instance_id)
            .map(|e| e.state)
    }
}

// 结构拆分：指令下发 / ack 跟踪 / 孤儿清理为同目录实现段（instance_commands.rs）。
#[path = "instance_commands.rs"]
mod instance_commands;

#[cfg(test)]
#[path = "instance_registry_test.rs"]
mod instance_registry_test;
