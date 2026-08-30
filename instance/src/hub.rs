//! instance daemon 主循环（F6，§4.2）：InstanceConfig + Sessions 会话表 +
//! 帧转发调度 + 补推协调 + 心跳。
//!
//! 取代旧 stdio 主循环（IDE stdin 读/写、child_msg 转发 stdout 已删除）：收
//! spawn/kill（**认证通过前不执行**，§9.2 步骤 3）、上报 event/process_exit/
//! heartbeat、断线缓冲 + 重连补推（§4.5/§4.5.1/§7.1/§8.5）。
//!
//! 职责要点：
//! - **seq/epoch 分配**（§4.5.1）：session 新开 epoch=1、首帧 seq=1（§5 依据：
//!   f3-persist §6 无日志时 `(0,0)`，`from_seq = last_seq+1 = 1`）；进程重建 /
//!   daemon 重启后 `epoch = 水位 + 1`、seq 重置 1；
//! - **spawn/kill 幂等**（§4.5/§7）：同 chat_id 二次 spawn 不二次起进程；
//!   kill 目标不存在/已退出视为已达成；
//! - **转发调度**：在线（认证通过且未缓冲）→ `instance/event`（`send_acked`
//!   写成功后推进 `last_sent_seq` 并写环形滑窗）；断线 → `buffer::push`；
//!   单帧超限跳过 + gap（§8.5，seq 消耗以保持流完整）；
//!   `peri/oauth` 是敏感瞬时帧：仅在线直送，任何失败都只形成缺口，绝不进入
//!   内存 ring、断线 buffer 或磁盘日志（分类规则与已知局限见
//!   [`forward::child_frame_delivery_class`]）；
//! - **补推协调**：Authenticated 后启动补推任务——对每个 `buffered` session
//!   分批 `instance/buffer_sync`（256 帧 / 512KB【决策】），pending 清空才转
//!   实时（§8.5 补推纪律）；发送中断 → rollback（from_seq 不变，重连重发）；
//! - **心跳**：每 `heartbeat_interval` 发 `instance/heartbeat { load,
//!   alive_sessions }`（load = min(100, alive×20)【决策】，§17.1 无精确语义）；
//! - **孤儿清理三层**（§8）：kill_on_drop（Drop）→ 进程组 kill（kill 指令）→
//!   启动时水位所有权验证后的进程组 SIGKILL + buffer/ 目录删除（崩溃路径）；
//! - **child 事件汇聚背压**（问题 3）：`child_tx` 为有界通道（4096），满时
//!   stdout 读任务挂起在 `send().await`，管道背压传导给 ACP 进程——主循环
//!   阻塞窗口（ack 等待/kill grace）内不再无界堆积。

mod config;
mod control;
mod forward;
mod handlers;
mod resync;
mod startup;

use std::collections::HashMap;
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use peri_studio_proto::instance::{InstanceHeartbeat, InstanceHello};
use peri_studio_proto::Frame;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use crate::auth::{AuthClient, AuthSession, HelloCtx};
use crate::buffer::{Buffer, RingBuffer, Watermark};
use crate::child::{AcpProcess, ChildOutput};
use crate::transport::{self, StoppedReason, TransportConfig, TransportEvent, TransportHandle};

pub use config::InstanceConfig;

use forward::forward_child_output;
use handlers::{handle_inbound, mark_all_buffered, shutdown_all};
use startup::{env_allowlist_extra, startup_cleanup};

/// instance owner 的结构化身份，用于本地 supervisor 安全接管。
pub use startup::InstanceOwnerIdentity;

/// 查询持有指定 instance 数据目录的运行进程，用于本地 supervisor 接管。
pub fn owner_identity(data_dir: &std::path::Path) -> anyhow::Result<Option<InstanceOwnerIdentity>> {
    startup::current_owner(data_dir)
}

/// 经身份绑定的本地控制通道请求 owner 自行优雅关闭。
pub async fn request_owner_shutdown(
    data_dir: &std::path::Path,
    owner: &InstanceOwnerIdentity,
    token: &str,
) -> anyhow::Result<()> {
    control::request_shutdown(data_dir, owner, token).await
}

/// child 事件汇聚通道容量（问题 3：有界，满时反压到 ACP 管道）。
const CHILD_CHANNEL_CAP: usize = 4096;

// ---------------------------------------------------------------------------
// 状态
// ---------------------------------------------------------------------------

/// 会话条目（§4.2）。
pub(super) struct ChatEntry {
    /// None = 进程已退出但会话状态保留（供重建 epoch+1）。
    pub(super) acp: Option<Arc<AcpProcess>>,
    /// 流纪元（§4.5.1）。
    pub(super) epoch: u64,
    /// 下一帧 seq（首帧 1）。
    pub(super) next_seq: u64,
    /// 已确认送达的最大 seq（在线 = 写成功；补推 from_seq = last_sent_seq+1）。
    pub(super) last_sent_seq: u64,
    /// 有待补推（断线缓冲或补推进行中）。
    pub(super) buffered: bool,
}

/// daemon 共享状态（std Mutex 保护——临界区均为同步短操作，不跨 await）。
///
/// 字段 `pub(super)`：子模块（handlers/forward/resync）访问，crate 其余模块
/// 不可见（维持原私有面）。
pub(super) struct HubState {
    /// Retains exclusive ownership of the instance data directory for daemon lifetime.
    pub(super) _owner_lock: startup::InstanceOwnerLock,
    pub(super) chats: StdMutex<HashMap<String, ChatEntry>>,
    pub(super) buffer: StdMutex<Buffer>,
    pub(super) rings: StdMutex<HashMap<String, RingBuffer>>,
    pub(super) watermark: StdMutex<Watermark>,
    /// 启动清理是否发生缓冲丢失（重启后 true，§7.5）。
    pub(super) buffer_lost: bool,
    /// 机器 hostname（hello 字段）。
    pub(super) hostname: String,
    /// 子进程事件汇聚通道（各 session spawn 共用，有界，问题 3）。
    pub(super) child_tx: mpsc::Sender<ChildOutput>,
    /// 资源查询宿主在 daemon 生命周期内共享，保证同一仓库 mutation 串行。
    pub(super) resource_host: crate::resource::ResourceHost,
    /// 无法提取 sessionId 的帧计数（§3.3 本地缺口）。
    pub(super) dropped_no_sid: AtomicU64,
    /// stdout 超长行丢弃计数（问题 4 本地缺口）。
    pub(super) oversize_lines: AtomicU64,
    /// 单帧超限跳过计数（§8.5 gap，单一计数入口，问题 13）。
    pub(super) oversize_gaps: AtomicU64,
    /// 敏感瞬时帧因离线/积压/发送失败/超限而丢弃的计数。只记数量，不记载荷。
    pub(super) sensitive_ephemeral_gaps: AtomicU64,
    /// 认证通过前收到 spawn/kill 的丢弃计数（§9.2 步骤 3）。
    pub(super) pre_auth_dropped: AtomicU64,
    /// env 白名单追加项（`PERI_STUDIO_ENV_ALLOWLIST`，§9.6 双端校验）。
    pub(super) env_allowlist: Vec<String>,
}

// ---------------------------------------------------------------------------
// 主循环
// ---------------------------------------------------------------------------

/// 启动 instance daemon 主循环。
///
/// 调用方拥有 `shutdown`，因此独立 CLI、统一二进制的本地监督模块与测试都可
/// 使用同一运行入口；本模块不安装进程级信号处理。函数会阻塞到 transport
/// 停止、调用方请求关闭或发生错误，并在返回前清理 ACP 进程树。
pub async fn run(config: InstanceConfig, shutdown: CancellationToken) -> anyhow::Result<()> {
    // 0. 启动清理（§8 第三层）→ 水位 + buffer_lost。
    let (watermark, buffer_lost, owner_lock) = startup_cleanup(&config)?;
    let owner_control = config
        .managed_local_id
        .as_ref()
        .map(|_| control::OwnerControl::bind(&config.data_dir, owner_lock.identity()))
        .transpose()?;
    let owner_token = config.token.clone();
    let mut owner_shutdown = Box::pin(async move {
        match owner_control {
            Some(control) => control.wait_for_shutdown(owner_token).await,
            None => std::future::pending::<anyhow::Result<()>>().await,
        }
    });

    // 1. 认证客户端（token fail-fast）。
    let auth_client = AuthClient::new(config.token.clone())?;

    // 2. transport。
    let (events_tx, mut events_rx) = mpsc::channel::<TransportEvent>(256);
    let (handle, cancel_rx) = TransportHandle::new(1024);
    // 配置校验（review L4）：write_timeout=0 时每次写立即超时 → 每帧断线重连
    // 空转循环。不隐式 clamp（保持配置透明），仅警告提示。
    if config.write_timeout.is_zero() {
        tracing::warn!(target: "peri_studio::instance",
            "write_timeout is 0: every write will time out immediately and trigger reconnect (recommend >=1s)");
    }
    let t_config = TransportConfig {
        url: config.server_url.clone(),
        auth_timeout: config.auth_timeout,
        reconnect_base: config.reconnect_base,
        reconnect_max: config.reconnect_max,
        write_timeout: config.write_timeout,
    };

    // 3. 共享状态 + 子进程事件汇聚通道（有界，问题 3——不再 per-spawn 建
    // unbounded 转发层，spawn 直接向本通道投递）。
    let (child_tx, mut child_rx) = mpsc::channel::<ChildOutput>(CHILD_CHANNEL_CAP);
    // hostname：HOSTNAME env（shell 导出）优先；macOS/daemon 场景常无该
    // env（hello hostname="unknown"，registry 视图/面板显示断点）→ 回退
    // libc gethostname。两者都失败才用 "unknown"。
    let hostname = std::env::var("HOSTNAME")
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(|| {
            let mut buf = [0u8; 256];
            // SAFETY: `buf` 为栈上 256B 有效缓冲区，`buf.len()` 传递实际长度；
            // gethostname 成功（rc==0）时以 NUL 结尾，随后按 NUL 截断读取。
            let rc = unsafe { libc::gethostname(buf.as_mut_ptr() as *mut _, buf.len()) };
            if rc == 0 {
                let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
                let name = String::from_utf8_lossy(&buf[..end]).trim().to_string();
                (!name.is_empty()).then_some(name)
            } else {
                None
            }
        })
        .unwrap_or_else(|| "unknown".to_string());
    let state = Arc::new(HubState {
        _owner_lock: owner_lock,
        chats: StdMutex::new(HashMap::new()),
        buffer: StdMutex::new(Buffer::new(
            config.mem_buffer_bytes,
            config.buffer_limit_frames / 2,
            config.buffer_limit_bytes,
            config.buffer_limit_frames,
            config.max_frame_bytes,
            config.data_dir.join("buffer"),
        )),
        rings: StdMutex::new(HashMap::new()),
        watermark: StdMutex::new(watermark),
        buffer_lost,
        hostname,
        child_tx,
        resource_host: crate::resource::ResourceHost::default(),
        dropped_no_sid: AtomicU64::new(0),
        oversize_lines: AtomicU64::new(0),
        oversize_gaps: AtomicU64::new(0),
        sensitive_ephemeral_gaps: AtomicU64::new(0),
        pre_auth_dropped: AtomicU64::new(0),
        env_allowlist: env_allowlist_extra(),
    });

    let make_hello = {
        let state = state.clone();
        let auth = auth_client.clone();
        move || build_hello(&state, &auth)
    };
    tokio::spawn(transport::run(
        t_config,
        make_hello,
        events_tx,
        handle.clone(),
        cancel_rx,
    ));

    // 4. 主事件循环（§4.2）。
    let mut heartbeat = tokio::time::interval(config.heartbeat_interval);
    heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut resync: Option<JoinHandle<()>> = None;
    let mut authenticated = false;
    let mut owner_control_error = None;
    loop {
        tokio::select! {
            evt = events_rx.recv() => {
                let Some(evt) = evt else {
                    tracing::warn!(target: "peri_studio::instance", "transport task exited, daemon ending");
                    break;
                };
                match evt {
                    TransportEvent::Connected => {
                        tracing::info!(target: "peri_studio::instance", "ws connected, awaiting authentication");
                    }
                    TransportEvent::Authenticated => {
                        authenticated = true;
                        tracing::info!(target: "peri_studio::instance", "authenticated, starting resync");
                        // 中止旧补推任务：断线→快速重连窗口内旧任务可能仍在
                        // 20ms 空转或持 in-flight 批次，双任务并发 drain 同一
                        // session 会错乱 from_seq 并可能丢帧（§6.1/§6.2）。
                        if let Some(h) = resync.take() {
                            h.abort();
                        }
                        state
                            .buffer
                            .lock()
                            .expect("buffer mutex poisoned")
                            .rollback_all();
                        let s = state.clone();
                        let h = handle.clone();
                        let c = config.clone();
                        resync = Some(tokio::spawn(async move {
                            resync::resync_loop(&s, &h, &c).await;
                        }));
                    }
                    TransportEvent::Disconnected => {
                        authenticated = false;
                        mark_all_buffered(&state);
                        if let Some(h) = resync.take() {
                            h.abort();
                        }
                        // 中断的 resync 可能遗留 in-flight 批次 → 回置 pending。
                        state
                            .buffer
                            .lock()
                            .expect("buffer mutex poisoned")
                            .rollback_all();
                        tracing::info!(target: "peri_studio::instance", "disconnected: entering buffering mode");
                    }
                    TransportEvent::AuthTimeout => {
                        tracing::warn!(target: "peri_studio::instance", "handshake timeout (reconnect will stop)");
                    }
                    TransportEvent::Stopped(reason) => {
                        let reason_str = match reason {
                            StoppedReason::AuthFailed => "auth failed (audit counter)",
                            StoppedReason::ConfigFatal => "server closed with 4502 (config fatal)",
                            StoppedReason::Shutdown => "graceful shutdown",
                        };
                        tracing::error!(target: "peri_studio::instance", reason = reason_str,
                            "transport stopped reconnecting, daemon ending");
                        // §8 第一层：daemon 结束前进程组 kill 全部会话——仅靠
                        // kill_on_drop 只杀直接子进程，孙进程（shell/工具）会
                        // 孤儿残留到下次启动清理（Shutdown 分支已 kill，幂等）。
                        let had_acps = shutdown_all(&state, &config).await;
                        drain_exit_events(&state, &handle, &config, &mut child_rx, had_acps).await;
                        break;
                    }
                    TransportEvent::Frame(frame) => {
                        handle_inbound(&state, &handle, &config, *frame, authenticated).await;
                    }
                }
            }
            out = child_rx.recv() => {
                let Some(out) = out else { continue };
                forward_child_output(&state, &handle, &config, out, authenticated).await;
            }
            _ = heartbeat.tick() => {
                if handle.is_authenticated() {
                    send_heartbeat(&state, &handle).await;
                }
            }
            _ = shutdown.cancelled() => {
                tracing::info!(target: "peri_studio::instance", "shutdown requested, shutting down gracefully");
                let had_acps = shutdown_all(&state, &config).await;
                // 水位收尾（问题 20）：shutdown_all 只杀进程，Exit 事件由 stdout
                // 读任务 wait 后经 child_rx 上报；主循环即将退出不再消费——短暂
                // 消费至超时，让水位以 pgid=0 落盘，避免下次启动误报 buffer_lost。
                drain_exit_events(&state, &handle, &config, &mut child_rx, had_acps).await;
                handle.shutdown();
                break;
            }
            result = &mut owner_shutdown => {
                match result {
                    Ok(()) => tracing::info!(
                        target: "peri_studio::instance",
                        "authenticated owner shutdown requested"
                    ),
                    Err(error) => {
                        tracing::error!(
                            target: "peri_studio::instance",
                            %error,
                            "owner control channel failed"
                        );
                        owner_control_error = Some(error);
                    }
                }
                let had_acps = shutdown_all(&state, &config).await;
                drain_exit_events(&state, &handle, &config, &mut child_rx, had_acps).await;
                handle.shutdown();
                break;
            }
        }
    }

    handle.shutdown();
    if let Some(h) = resync {
        h.abort();
    }
    tracing::info!(target: "peri_studio::instance", "daemon exited");
    match owner_control_error {
        Some(error) => Err(error.context("owner control channel failed")),
        None => Ok(()),
    }
}

/// 收尾消费 child_rx 中的 Exit 事件（优雅关闭后，问题 20）：进程已 SIGKILL，
/// wait 在毫秒级完成，短暂超时即可收齐；超时未收齐的由下次启动的
/// buffer_lost 对账兜底（server 侧权威）。
///
/// `had_acps=false`（无存活 ACP 会话被终止）时不会有 Exit 事件，直接返回，
/// 不再空等固定超时（原 800ms 在无会话关闭时造成 ~0.8s 的退出尾巴）。
async fn drain_exit_events(
    state: &HubState,
    handle: &TransportHandle,
    config: &InstanceConfig,
    child_rx: &mut mpsc::Receiver<ChildOutput>,
    had_acps: bool,
) {
    if !had_acps {
        return;
    }
    let drain = tokio::time::timeout(Duration::from_millis(150), async {
        while let Some(out) = child_rx.recv().await {
            if matches!(out, ChildOutput::Exit { .. }) {
                forward_child_output(state, handle, config, out, false).await;
            }
            // 非 Exit 帧（进程已杀后到达的残留帧）直接丢弃。
        }
    });
    let _ = drain.await;
}

/// hello 构造（每次连接调用：新 nonce，§9.2；会话状态实时读取）。
fn build_hello(state: &HubState, auth: &AuthClient) -> (AuthSession, InstanceHello) {
    let session = auth.begin();
    let ctx = {
        let chats = state.chats.lock().expect("chats mutex poisoned");
        let buffer = state.buffer.lock().expect("buffer mutex poisoned");
        let stream_epochs = chats
            .iter()
            .filter(|(_, e)| e.acp.is_some())
            .map(|(sid, e)| (sid.clone(), e.epoch))
            .collect();
        HelloCtx {
            hostname: state.hostname.clone(),
            buffered: buffer.has_any_pending(),
            buffer_lost: state.buffer_lost,
            stream_epochs,
        }
    };
    let hello = session.build_hello(&ctx);
    (session, hello)
}

// ---------------------------------------------------------------------------
// 心跳 / 查询接口
// ---------------------------------------------------------------------------

/// 心跳：`instance/heartbeat { load, alive_sessions }`（§4.5）。
/// load【决策】= min(100, alive×20)（§17.1 无精确语义）。
async fn send_heartbeat(state: &HubState, handle: &TransportHandle) {
    let alive_sessions = {
        let chats = state.chats.lock().expect("chats mutex poisoned");
        chats
            .iter()
            .filter(|(_, e)| e.acp.is_some())
            .map(|(sid, _)| sid.clone())
            .collect::<Vec<_>>()
    };
    let load = (alive_sessions.len() * 20).min(100) as u32;
    let frame = Frame::InstanceHeartbeat(InstanceHeartbeat {
        load,
        alive_sessions,
    });
    let _ = handle.send(frame).await;
}

/// 环形滑窗快照（冲突 2 预留：server 发现缺口请求滑窗重发时使用）。
#[allow(dead_code)]
fn ring_snapshot(
    state: &HubState,
    chat_id: &str,
) -> Vec<peri_studio_proto::instance::BufferedFrame> {
    state
        .rings
        .lock()
        .expect("rings mutex poisoned")
        .get(chat_id)
        .map(RingBuffer::snapshot)
        .unwrap_or_default()
}

#[cfg(test)]
#[path = "hub_test_common.rs"]
mod hub_test_common;

#[cfg(test)]
#[path = "hub_startup_test.rs"]
mod hub_startup_test;

#[cfg(test)]
#[path = "hub_security_test.rs"]
mod hub_security_test;

#[cfg(test)]
#[path = "hub_flow_test.rs"]
mod hub_flow_test;

#[cfg(test)]
#[path = "hub_resync_test.rs"]
mod hub_resync_test;
