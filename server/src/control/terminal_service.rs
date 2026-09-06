//! 浏览器终端编排：不信任 browser cwd，从 metadata 解析 instance/root；
//! 经 InstanceRegistry 下发 PTY 指令并将输出精确路由回 owner 连接。

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;
use std::time::{Duration, Instant};

use peri_studio_proto::frame::Frame;
use peri_studio_proto::terminal::{
    decode_terminal_chunk, validate_terminal_dims, validate_terminal_id, InstanceTerminalInput,
    InstanceTerminalOpen, InstanceTerminalOpened, InstanceTerminalOutput, InstanceTerminalResize,
    TerminalClose, TerminalError, TerminalErrorCode, TerminalInput, TerminalOpen, TerminalOpened,
    TerminalOutput, TerminalResize, MAX_TERMINALS_PER_INSTANCE_HOST, MAX_TERMINALS_PER_PRINCIPAL,
};
use tokio::sync::{mpsc, Mutex};

use crate::channel::{ConnId, OutboundMsg};
use crate::control::{InstanceConn, InstanceRegistry};
use crate::persist::metadata::MetadataStore;

#[path = "terminal_service_util.rs"]
mod terminal_service_util;

#[path = "terminal_service_client.rs"]
mod terminal_service_client;
#[path = "terminal_service_instance.rs"]
mod terminal_service_instance;

use terminal_service_util::{map_instance_error, terminal_error};

const COMPLETED_REQUEST_CAP: usize = 1024;

#[derive(Clone)]
struct TerminalOwner {
    conn_id: ConnId,
    principal: String,
    request_id: String,
    instance_id: String,
    instance_conn: InstanceConn,
    client_tx: mpsc::Sender<OutboundMsg>,
    next_input_seq: u64,
    next_output_seq: u64,
}

struct PendingOpen {
    owner: TerminalOwner,
    terminal_id: String,
    instance_request_id: String,
    created_at: Instant,
}

#[derive(Clone)]
pub struct TerminalService {
    metadata: Arc<MetadataStore>,
    instance: Arc<InstanceRegistry>,
    open_timeout: Duration,
    lifecycle_lock: Arc<Mutex<()>>,
    inner: Arc<Mutex<TerminalInner>>,
}

struct TerminalInner {
    active: HashMap<String, TerminalOwner>,
    pending: HashMap<String, PendingOpen>,
    principal_counts: HashMap<String, usize>,
    instance_counts: HashMap<String, usize>,
    completed_requests: HashSet<String>,
    completed_request_order: VecDeque<String>,
    shutting_down: bool,
}

impl TerminalService {
    pub fn new(
        metadata: Arc<MetadataStore>,
        instance: Arc<InstanceRegistry>,
        open_timeout: Duration,
    ) -> Self {
        Self {
            metadata,
            instance,
            open_timeout,
            lifecycle_lock: Arc::new(Mutex::new(())),
            inner: Arc::new(Mutex::new(TerminalInner {
                active: HashMap::new(),
                pending: HashMap::new(),
                principal_counts: HashMap::new(),
                instance_counts: HashMap::new(),
                completed_requests: HashSet::new(),
                completed_request_order: VecDeque::new(),
                shutting_down: false,
            })),
        }
    }

    /// 处理 browser 上行终端帧；响应经 `client_tx` 异步下发。
    pub async fn handle_client_frame(
        &self,
        conn_id: ConnId,
        principal: &str,
        can_mutate: bool,
        frame: Frame,
        client_tx: mpsc::Sender<OutboundMsg>,
    ) {
        match frame {
            Frame::TerminalOpen(open) => {
                self.handle_open(conn_id, principal, can_mutate, open, client_tx)
                    .await;
            }
            Frame::TerminalInput(input) => {
                self.handle_input(conn_id, principal, can_mutate, input)
                    .await;
            }
            Frame::TerminalResize(resize) => {
                self.handle_resize(conn_id, principal, can_mutate, resize)
                    .await;
            }
            Frame::TerminalClose(close) => {
                self.handle_close(conn_id, principal, can_mutate, close, client_tx)
                    .await;
            }
            _ => {}
        }
    }
}

fn dec_count(counts: &mut HashMap<String, usize>, key: &str) {
    if let Some(n) = counts.get_mut(key) {
        *n = n.saturating_sub(1);
        if *n == 0 {
            counts.remove(key);
        }
    }
}

fn remember_completed_request(inner: &mut TerminalInner, request_id: String) {
    if !inner.completed_requests.insert(request_id.clone()) {
        return;
    }
    inner.completed_request_order.push_back(request_id);
    while inner.completed_request_order.len() > COMPLETED_REQUEST_CAP {
        if let Some(expired) = inner.completed_request_order.pop_front() {
            inner.completed_requests.remove(&expired);
        }
    }
}

fn valid_opened_fields(opened: &InstanceTerminalOpened) -> bool {
    matches!(
        (opened.cwd.as_deref(), opened.cols, opened.rows),
        (Some(cwd), Some(cols), Some(rows))
            if !cwd.is_empty() && validate_terminal_dims(cols, rows).is_ok()
    )
}

fn validate_open_fields(open: &TerminalOpen) -> Result<(), String> {
    validate_terminal_id(&open.request_id, "requestId")?;
    validate_terminal_id(&open.project_id, "projectId")?;
    validate_terminal_dims(open.cols, open.rows).map_err(|e| e.to_string())
}

fn request_key(principal: &str, request_id: &str) -> String {
    format!("{principal}\0{request_id}")
}

async fn send_error(client_tx: &mpsc::Sender<OutboundMsg>, error: TerminalError) {
    let _ = client_tx.try_send(OutboundMsg::Frame(Frame::TerminalError(error)));
}

#[cfg(test)]
#[path = "terminal_service_test.rs"]
mod terminal_service_test;

#[cfg(test)]
#[path = "terminal_service_security_test.rs"]
mod terminal_service_security_test;
