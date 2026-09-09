//! DocManager：Y.Doc 唯一提交边界（§5.6）与每 chat 单写者 API（§7.4）。
//!
//! 命令、事件应用、写者持久化分别位于 `doc_manager_command.rs`、
//! `doc_manager_apply_*.rs`、`doc_manager_*_persist.rs`；本文件保留类型和 API。

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use tokio::sync::{mpsc, oneshot, RwLock};
use tokio::task::JoinHandle;
use tracing::debug;

use peri_studio_proto::conn::DocId;
use peri_studio_proto::schema::ChatSummary;

use crate::state::aggregator::ApplyResult;
use crate::state::factory::Factory;
use crate::state::normalized::NormalizedEvent;
use crate::state::registry::{RegistryError, RegistryMsg, RegistryState};

pub use super::doc_manager_command::DocCommand;
use super::doc_manager_persist::{chat_writer_loop, is_batchable};
use super::doc_manager_registry_persist::registry_writer_loop;

/// 微批次/队列参数（§6.4/§8.6）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BatchConfig {
    /// 微批次窗口（§6.4 默认 16ms）。
    pub batch_window: Duration,
    /// 增量字节阈值（【决策】默认 4KB；与 §14 开放问题 2 的 4KB 截断对齐）。
    pub batch_bytes: usize,
    /// 每 chat 命令队列上限（§8.6 默认 64）。
    pub chat_queue: usize,
}

/// persist 失败重试缓冲上限（§8.4 故障面：失败 update 不广播不丢弃，进
/// 缓冲随下次 flush 重投；磁盘长时不可用时缓冲可能增长——超过上限丢弃
/// 最旧并保持 degraded，防止无界内存）。
pub(crate) const PERSIST_RETRY_MAX: usize = 64;

impl Default for BatchConfig {
    fn default() -> Self {
        BatchConfig {
            batch_window: Duration::from_millis(16),
            batch_bytes: 4096,
            chat_queue: 64,
        }
    }
}

/// 提交产物：update 的消费者（UpdateSink 投递到内存镜像 + 广播；§8.4 提交点纪律）。
///
/// 【决策】trait 而非具体类型——F6 提供实现；DocManager 只要求「投递完成后再
/// 应答」。
#[async_trait]
pub trait UpdateSink: Send + Sync {
    /// 将 update 投递到 UpdateSink（内存镜像 + 广播，无落盘）；返回投递结果。
    async fn persist_update(&self, doc: DocId, update: Vec<u8>) -> Result<(), PersistError>;
}

/// persist 错误（F6 返回；内容脱敏，不携带正文/路径细节）。
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("persist error: {0}")]
pub struct PersistError(pub String);

/// 广播载荷（§4.2 `ysync.update` 的素材；背压/合并/跳过属 broadcaster，F7）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocUpdate {
    pub doc: DocId,
    pub update: Vec<u8>,
}

/// 提交结果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SubmitResult {
    /// 已应用（含 applied=false 的幂等/守卫拒绝——调用方按 reason 处理）。
    Applied(ApplyResult),
    /// 队列满 / chat 已关闭等。
    Rejected(SubmitError),
    /// 投递失败（F6 persist 错误；§17.2 degraded 输入）。
    PersistFailed,
}

/// 提交拒绝原因。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SubmitError {
    /// 队列满（RATE_LIMITED 语义，§8.6）。
    QueueFull,
    /// chat 不存在 / 已关闭（CHAT_NOT_FOUND 语义）。
    ChatNotFound,
    /// 写者通道已关闭。
    ChannelClosed,
    /// 语义性拒绝：当前 chat 状态不允许该命令（回放进行中 / 不可校准缺口），
    /// 与背压（QueueFull）语义分离——调用方按状态迁移处理，不做重试。
    InvalidState,
    /// Registry 写者错误（保留 NotFound 等诊断上下文，§9.3 错误可定位）。
    Registry(RegistryError),
}

/// `yrs::Subscription` 的 Send 包装。
///
/// yrs 在非 `sync` feature 下未声明 `Subscription: Send`，但其内部字段
/// （`Origin(SmallVec<[u8; 8]>)` + `Weak<RefCell<Vec<Origin>>>`）均为 `Send`；
/// 按实际布局包装使 writer task 可跨 await 持有观察句柄。Drop 即退订。
///
/// 【升级复检】yrs 版本升级（尤其 0.27 → 1.x，`sync` feature 与订阅内部
/// 布局都可能变化）时必须复检 `Subscription` 的字段布局仍为 `Send`，否则
/// 本 `unsafe impl` 构成 UB。CI 应固定 yrs 版本，升级 PR 显式复检此项。
#[allow(dead_code)] // 观察句柄：存活即注册，drop 即退订
pub(crate) struct SendSubscription(pub(crate) Option<yrs::Subscription>);

// SAFETY: 字段均为 Send（见上）。
unsafe impl Send for SendSubscription {}

/// DocManager 生命周期错误（open/close）。
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum DocManagerError {
    /// chat 不存在。
    #[error("chat not found: {0}")]
    ChatNotFound(String),
    /// 通道关闭。
    #[error("chat writer closed")]
    ChannelClosed,
}

/// 控制路径写入命令（§5.6「控制面状态迁移如 cancelling/interrupted/decision/
/// 标题、定时器 CAS」全部经此）。
struct ChatHandle {
    tx: mpsc::Sender<ChatMsg>,
    /// 入队未消费计数（§7.4 规则 6：入队检查与 in_flight 标记同一临界区）。
    inflight: Arc<AtomicUsize>,
    writer: JoinHandle<()>,
}

/// 写者通道消息（§8.2）。
pub(crate) enum ChatMsg {
    /// 事件（聚合路径）；挂 oneshot 的调用方 await 投递确认（§8.2 提交点纪律）。
    Event(Box<NormalizedEvent>, Option<oneshot::Sender<SubmitResult>>),
    /// 命令（控制路径）。
    Command(DocCommand, Option<oneshot::Sender<SubmitResult>>),
    /// 关闭：writer 完成在途批次后退出。
    Shutdown(oneshot::Sender<()>),
    /// 只读：Session Doc 当前 active turn 投影（cancel 等控制路径与 Yjs 对账）。
    ReadSessionActiveTurn(oneshot::Sender<(Option<String>, String)>),
    /// 只读：Chat Doc 同回合 assistant 是否已终态（L3 超时防误报）。
    ReadChatTurnTerminal(String, oneshot::Sender<bool>),
    /// 只读：当前 chat 是否处于 session/load 回放窗口。
    ReadLoadReplayActive(oneshot::Sender<bool>),
}

/// 唯一提交边界（§5.6）。
pub struct DocManager {
    chats: RwLock<HashMap<String, ChatHandle>>,
    registry_tx: mpsc::Sender<RegistryMsg>,
    cfg: BatchConfig,
    sink: Arc<dyn UpdateSink>,
    factory: Factory,
    /// 广播订阅者（unbounded；背压在下游 broadcaster，§6.4）。
    broadcast: Arc<RwLock<Vec<mpsc::UnboundedSender<DocUpdate>>>>,
}

impl DocManager {
    /// 创建 DocManager：spawn 全局 Registry 写者（Registry Doc 也是 Doc，受
    /// 唯一提交边界约束，§5.6）。Registry Doc 以全新结构起步。
    pub fn new(cfg: BatchConfig, sink: Arc<dyn UpdateSink>) -> Self {
        Self::with_recovered_registry(cfg, sink, None)
    }

    /// 同 [`Self::new`]，但可注入恢复后的 Registry Doc（§8.4.1：server 重启
    /// 时从 registry.log 重放，`registry.log` 非空时必须注入——否则 writer
    /// 以全新 client 重写结构，与镜像中历史结构的 CRDT LWW 冲突，后续增量
    /// 引用被覆盖的结构而不可见）。
    ///
    /// 注入的 doc 应已应用 registry.log 全部记录（历史 client 的结构/数据）；
    /// writer 后续增量以新 client 写入业务键，与历史键无冲突。
    pub fn with_recovered_registry(
        cfg: BatchConfig,
        sink: Arc<dyn UpdateSink>,
        recovered_registry: Option<yrs::Doc>,
    ) -> Self {
        let factory = Factory::new();
        let registry_doc = recovered_registry.unwrap_or_else(|| factory.create_registry_doc());
        let (registry_tx, registry_rx) = mpsc::channel::<RegistryMsg>(cfg.chat_queue);
        // Registry 写者：即到即写（§8.5），无微批次。
        let broadcast: Arc<RwLock<Vec<mpsc::UnboundedSender<DocUpdate>>>> =
            Arc::new(RwLock::new(vec![]));
        {
            let broadcast = broadcast.clone();
            let sink = sink.clone();
            // Registry 写者需要 self.registry()（observe 失败上报等）；
            // RegistryState 仅持有 tx 克隆，可在此构造。
            let registry = RegistryState::new(registry_tx.clone());
            tokio::spawn(registry_writer_loop(
                registry_doc,
                registry_rx,
                sink,
                broadcast,
                registry,
            ));
        }
        DocManager {
            chats: RwLock::new(HashMap::new()),
            registry_tx,
            cfg,
            sink,
            factory,
            broadcast,
        }
    }

    /// Registry 状态源单写句柄（channel 层 instance 生命周期 / 恢复流程使用）。
    pub fn registry(&self) -> RegistryState {
        RegistryState::new(self.registry_tx.clone())
    }

    /// 打开 chat：Factory 创建双 Doc + ensure_schema（补结构）→ spawn writer
    /// task → RegistryState 写活跃摘要（§12.4）。重复打开按幂等处理（返回现有
    /// 句柄）。
    ///
    /// `cwd`/`workspace_id`：ACP 进程工作目录与归属工作区（§6.3 workspace
    /// 扩展）——registry 摘要随 doc 打开即写入（`write_chat_summary` 对已存在
    /// 条目只刷新 updated_at，cwd 必须在首写带上）；调用方无信息时传 None。
    pub async fn open_chat(
        &self,
        chat_id: &str,
        instance_id: &str,
        title: Option<&str>,
        cwd: Option<&str>,
        workspace_id: Option<&str>,
    ) -> Result<(), DocManagerError> {
        // 写锁内完成「检查 + create/spawn/insert」——`create_chat_doc` 与
        // `tokio::spawn` 均无 await，可整体入临界区（§7.4 单一写者注册）。
        // 并发打开同一 chat 时后到者看到先到者已注册，直接幂等返回，不
        // 产生孤儿 writer task（先到者的 ChatHandle 不被覆盖）。
        let (chat_id, registry) = {
            let mut chats = self.chats.write().await;
            if chats.contains_key(chat_id) {
                return Ok(());
            }
            let pair = self.factory.create_chat_doc();
            let (tx, rx) = mpsc::channel::<ChatMsg>(self.cfg.chat_queue);
            let inflight = Arc::new(AtomicUsize::new(0));
            let broadcast = self.broadcast.clone();
            let sink = self.sink.clone();
            let registry = self.registry();
            let cfg = self.cfg;
            let chat_id = chat_id.to_string();

            let writer = tokio::spawn(chat_writer_loop(
                chat_id.clone(),
                rx,
                pair,
                cfg,
                sink,
                broadcast,
                registry.clone(),
            ));

            chats.insert(
                chat_id.clone(),
                ChatHandle {
                    tx,
                    inflight,
                    writer,
                },
            );
            (chat_id, registry)
        };

        // Registry 活跃摘要（§12.4 create 更新）。写锁已释放（upsert 是
        // 跨 task await，不得持锁）。
        let summary = ChatSummary {
            id: chat_id.clone(),
            instance_id: instance_id.to_string(),
            title: title.unwrap_or_default().to_string(),
            status: "accepting".to_string(),
            gap: None,
            updated_at: chrono::Utc::now().to_rfc3339(),
            cwd: cwd.unwrap_or_default().to_string(),
            workspace_id: workspace_id.map(str::to_string),
        };
        if let Err(e) = registry.upsert_chat(summary).await {
            tracing::warn!(chat_id, error = ?e, "registry upsert chat failed");
        }
        debug!(chat_id, "chat opened");
        Ok(())
    }

    /// 同步入队检查（§7.4 同一临界区）：调用方在 outbox 去重索引更新前调用，
    /// 返回 false 表示队列满（RATE_LIMITED）或 chat 不存在（CHAT_NOT_FOUND）。
    pub async fn try_reserve(&self, chat_id: &str) -> bool {
        let chats = self.chats.read().await;
        let Some(handle) = chats.get(chat_id) else {
            return false;
        };
        handle
            .inflight
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| {
                if n < self.cfg.chat_queue {
                    Some(n + 1)
                } else {
                    None
                }
            })
            .is_ok()
    }

    /// 释放 `try_reserve` 占用的名额（§7.4 配对：谁 reserve 谁 release）。
    ///
    /// 由调用方（command-coordinator 执行器）在命令消费完成后调用；**仅**
    /// 配对 [`Self::try_reserve`] 的成功返回——submit 内部不做 reserve
    /// （入队即消费，与 try_reserve 无关；失败路径无名额可释放）。
    pub async fn release_reserve(&self, chat_id: &str) {
        let chats = self.chats.read().await;
        if let Some(handle) = chats.get(chat_id) {
            handle.inflight.fetch_sub(1, Ordering::SeqCst);
        }
    }

    /// 聚合路径（F5 ACPChannel 产物 / 补推流）：经该 chat 写者应用。
    ///
    /// 应答语义（§8.2「需要应答的提交挂 oneshot」）：
    /// - delta 类事件（MessageDelta/ReasoningDelta）进入 16ms 微批次，**不挂
    ///   投递应答**——入队即返回 `Applied`（投递随批次 flush，§8.3）；调用方
    ///   不得把该返回值当作「已投递」；
    /// - 控制类事件挂 oneshot，writer 应用 + flush + 投递确认后回填
    ///   `SubmitResult`（提交点纪律 §4.4「投影 user entry → committed Ack」）。
    pub async fn submit_event(&self, ev: NormalizedEvent) -> SubmitResult {
        let chat_id = ev.chat_id.clone();
        let chats = self.chats.read().await;
        let Some(handle) = chats.get(&chat_id) else {
            return SubmitResult::Rejected(SubmitError::ChatNotFound);
        };
        // delta 类：入队即返回（§8.2 微批次不逐事件应答；挂 reply 会使调用方
        // 在窗口内阻塞至 flush，破坏流式语义）。
        if is_batchable(&ev.body) {
            if handle
                .tx
                .send(ChatMsg::Event(Box::new(ev), None))
                .await
                .is_err()
            {
                return SubmitResult::Rejected(SubmitError::ChannelClosed);
            }
            return SubmitResult::Applied(ApplyResult {
                applied: true,
                reason: None,
            });
        }
        let (reply, rx) = oneshot::channel();
        if handle
            .tx
            .send(ChatMsg::Event(Box::new(ev), Some(reply)))
            .await
            .is_err()
        {
            return SubmitResult::Rejected(SubmitError::ChannelClosed);
        }
        rx.await
            .unwrap_or(SubmitResult::Rejected(SubmitError::ChannelClosed))
    }

    /// 控制路径（F7 command-coordinator / 定时器）：注册 user entry、权限 CAS、
    /// 标题更新、断链 interrupted、gap 同步、Registry 更新等（§8.5 DocCommand
    /// 表）。
    ///
    /// Registry 系命令路由到全局 registry 写者（§8.5【决策】）；其余命令经
    /// `chat_id` 路由到对应 chat 写者。
    pub async fn submit_command(&self, chat_id: &str, cmd: DocCommand) -> SubmitResult {
        if cmd.is_registry() {
            return self.submit_registry_command(cmd).await;
        }
        let chats = self.chats.read().await;
        let Some(handle) = chats.get(chat_id) else {
            return SubmitResult::Rejected(SubmitError::ChatNotFound);
        };
        let (reply, rx) = oneshot::channel();
        if handle
            .tx
            .send(ChatMsg::Command(cmd, Some(reply)))
            .await
            .is_err()
        {
            return SubmitResult::Rejected(SubmitError::ChannelClosed);
        }
        rx.await
            .unwrap_or(SubmitResult::Rejected(SubmitError::ChannelClosed))
    }

    /// 读 Session Doc 内嵌 active turn（与 DocCommand 投影同源；chat 未 open 时返回 None）。
    pub async fn read_session_active_turn(
        &self,
        chat_id: &str,
    ) -> Option<(Option<String>, String)> {
        let chats = self.chats.read().await;
        let handle = chats.get(chat_id)?;
        let (reply, rx) = oneshot::channel();
        if handle
            .tx
            .send(ChatMsg::ReadSessionActiveTurn(reply))
            .await
            .is_err()
        {
            return None;
        }
        drop(chats);
        rx.await.ok()
    }

    /// 读 Chat Doc：同回合 assistant 是否已终态（completed / error / cancelled）。
    pub async fn read_chat_turn_terminal(&self, chat_id: &str, turn_id: &str) -> bool {
        let chats = self.chats.read().await;
        let Some(handle) = chats.get(chat_id) else {
            return false;
        };
        let (reply, rx) = oneshot::channel();
        if handle
            .tx
            .send(ChatMsg::ReadChatTurnTerminal(turn_id.to_string(), reply))
            .await
            .is_err()
        {
            return false;
        }
        drop(chats);
        rx.await.unwrap_or(false)
    }

    /// 读当前 chat 是否处于 session/load 回放窗口；writer 缺失或关闭时返回 `None`。
    pub async fn read_load_replay_active(&self, chat_id: &str) -> Option<bool> {
        let chats = self.chats.read().await;
        let handle = chats.get(chat_id)?;
        let (reply, rx) = oneshot::channel();
        handle
            .tx
            .send(ChatMsg::ReadLoadReplayActive(reply))
            .await
            .ok()?;
        drop(chats);
        rx.await.ok()
    }

    async fn submit_registry_command(&self, cmd: DocCommand) -> SubmitResult {
        let (reply, rx) = oneshot::channel();
        if self
            .registry_tx
            .send(RegistryMsg::Command(cmd, reply))
            .await
            .is_err()
        {
            return SubmitResult::Rejected(SubmitError::ChannelClosed);
        }
        match rx.await {
            Ok(Ok(_)) => SubmitResult::Applied(ApplyResult {
                applied: true,
                reason: None,
            }),
            Ok(Err(e)) => {
                tracing::warn!(error = ?e, "registry command failed");
                SubmitResult::Rejected(SubmitError::Registry(e))
            }
            Err(_) => SubmitResult::Rejected(SubmitError::ChannelClosed),
        }
    }

    /// 关闭 chat：写者 drain 后退出；Doc 保留（终态视图供历史查看，§8.2）。
    pub async fn close_chat(&self, chat_id: &str) -> Result<(), DocManagerError> {
        let handle = {
            let mut chats = self.chats.write().await;
            chats.remove(chat_id)
        };
        let Some(handle) = handle else {
            return Err(DocManagerError::ChatNotFound(chat_id.to_string()));
        };
        let (reply, rx) = oneshot::channel();
        let _ = handle.tx.send(ChatMsg::Shutdown(reply)).await;
        let _ = rx.await;
        let _ = handle.writer.await;
        // Registry 活跃摘要移除（§12.4 close 清理）。
        let registry = self.registry();
        if let Err(e) = registry.remove_chat(chat_id).await {
            tracing::warn!(chat_id, error = ?e, "registry remove chat failed");
        }
        debug!(chat_id, "chat closed");
        Ok(())
    }

    /// 广播订阅（unbounded）：broadcaster（F7）消费做背压与 fan-out。
    /// 每次调用返回新的 receiver；发送方（writer）广播给全部订阅者。
    pub async fn subscribe_updates(&self) -> mpsc::UnboundedReceiver<DocUpdate> {
        let (tx, rx) = mpsc::unbounded_channel();
        self.broadcast.write().await.push(tx);
        rx
    }
}
