//! PTY 会话宿主：blocking 读写与有界输出事件。

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};

use peri_studio_proto::terminal::{
    decode_terminal_chunk, encode_terminal_chunk, validate_terminal_dims, validate_terminal_id,
    InstanceTerminalClose, InstanceTerminalInput, InstanceTerminalOpen, InstanceTerminalOpened,
    InstanceTerminalResize, MAX_TERMINALS_PER_INSTANCE_HOST, MAX_TERMINAL_CHUNK_BYTES,
};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tokio::sync::mpsc;

const INPUT_QUEUE_CAP: usize = 64;
#[path = "terminal_host_util.rs"]
mod terminal_host_util;

pub(crate) use terminal_host_util::controlled_shell;
use terminal_host_util::{
    apply_safe_env, fail_generation, input_loop, kill_process_tree, kill_session,
    process_group_id_from_pid, read_loop, rejected_open, remove_if_generation, validate_open,
    ReadLoopEnd,
};

/// 汇入 hub 主循环的终端事件（不进入 ACP ring/disk）。
#[derive(Debug, Clone)]
pub enum TerminalEvent {
    Output {
        terminal_id: String,
        seq: u64,
        data: String,
    },
    Exit {
        terminal_id: String,
        exit_code: Option<i32>,
        signal: Option<String>,
    },
}

struct Session {
    generation: u64,
    master: Arc<Mutex<Box<dyn portable_pty::MasterPty + Send>>>,
    input_tx: SyncSender<Vec<u8>>,
    next_input_seq: u64,
    child: Option<Box<dyn portable_pty::Child + Send + Sync>>,
    process_id: Option<u32>,
    process_group_id: Option<i32>,
    killer: Mutex<Box<dyn portable_pty::ChildKiller + Send + Sync>>,
    reader_started: bool,
}

#[derive(Clone)]
pub struct TerminalHost {
    inner: Arc<Mutex<HostInner>>,
    events: mpsc::Sender<TerminalEvent>,
    next_generation: Arc<AtomicU64>,
    open_lock: Arc<tokio::sync::Mutex<()>>,
}

struct HostInner {
    sessions: HashMap<String, Session>,
}

impl TerminalHost {
    pub fn new(events: mpsc::Sender<TerminalEvent>) -> Self {
        Self {
            inner: Arc::new(Mutex::new(HostInner {
                sessions: HashMap::new(),
            })),
            events,
            next_generation: Arc::new(AtomicU64::new(1)),
            open_lock: Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    pub async fn open(&self, mut open: InstanceTerminalOpen) -> InstanceTerminalOpened {
        let request_id = open.request_id.clone();
        let terminal_id = open.terminal_id.clone();
        let canonical_cwd = match validate_open(&open) {
            Ok(cwd) => cwd,
            Err(message) => {
                return rejected_open(request_id, terminal_id, message);
            }
        };
        open.cwd = canonical_cwd.to_string_lossy().into_owned();
        let _open_guard = self.open_lock.lock().await;
        let host = self.clone();
        match tokio::task::spawn_blocking(move || host.open_blocking(open)).await {
            Ok(result) => result,
            Err(_) => rejected_open(request_id, terminal_id, "pty spawn task failed"),
        }
    }

    pub async fn input(&self, input: InstanceTerminalInput) -> Result<(), String> {
        validate_terminal_id(&input.terminal_id, "terminalId")?;
        let bytes = decode_terminal_chunk(&input.data)?;
        let mut inner = self.inner.lock().expect("terminal host mutex");
        let Some(session) = inner.sessions.get_mut(&input.terminal_id) else {
            return Err("unknown terminal".into());
        };
        if input.seq != session.next_input_seq {
            return Err("terminal input sequence out of order".into());
        }
        match session.input_tx.try_send(bytes) {
            Ok(()) => {
                session.next_input_seq = session
                    .next_input_seq
                    .checked_add(1)
                    .ok_or_else(|| "terminal input sequence exhausted".to_string())?;
                Ok(())
            }
            Err(TrySendError::Full(_)) => Err("terminal input queue full".into()),
            Err(TrySendError::Disconnected(_)) => Err("terminal input closed".into()),
        }
    }

    pub async fn resize(&self, resize: InstanceTerminalResize) -> Result<(), String> {
        validate_terminal_id(&resize.terminal_id, "terminalId")?;
        validate_terminal_dims(resize.cols, resize.rows).map_err(|e| e.to_string())?;
        let master = {
            let inner = self.inner.lock().expect("terminal host mutex");
            inner
                .sessions
                .get(&resize.terminal_id)
                .map(|s| s.master.clone())
        };
        let Some(master) = master else {
            return Err("unknown terminal".into());
        };
        let cols = resize.cols;
        let rows = resize.rows;
        tokio::task::spawn_blocking(move || {
            let guard = master.lock().expect("pty master mutex");
            guard.resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
        })
        .await
        .map_err(|_| "resize task failed".to_string())?
        .map_err(|e| e.to_string())
    }

    pub fn start_reader(&self, terminal_id: &str) {
        let (master, mut child, events, inner, generation) = {
            let mut inner = self.inner.lock().expect("terminal host mutex");
            let Some(session) = inner.sessions.get_mut(terminal_id) else {
                return;
            };
            if session.reader_started {
                return;
            }
            let Some(child) = session.child.take() else {
                return;
            };
            session.reader_started = true;
            (
                session.master.clone(),
                child,
                self.events.clone(),
                self.inner.clone(),
                session.generation,
            )
        };
        let tid = terminal_id.to_string();
        std::thread::spawn(move || {
            let process_id = child.process_id();
            let reader = match master.lock().expect("pty master mutex").try_clone_reader() {
                Ok(reader) => reader,
                Err(_) => {
                    kill_process_tree(process_group_id_from_pid(process_id));
                    let _ = child.kill();
                    let _ = child.wait();
                    let removed = remove_if_generation(&inner, &tid, generation);
                    if removed {
                        let _ = events.blocking_send(TerminalEvent::Exit {
                            terminal_id: tid,
                            exit_code: None,
                            signal: Some("reader-error".into()),
                        });
                    }
                    return;
                }
            };
            let seq_counter = AtomicU64::new(1);
            let read_end = read_loop(reader, tid.clone(), &seq_counter, &events);
            if read_end != ReadLoopEnd::Eof {
                kill_process_tree(process_group_id_from_pid(process_id));
                let _ = child.kill();
            }
            let (exit_code, mut signal) = match child.wait() {
                Ok(status) => (
                    Some(status.exit_code() as i32),
                    status.signal().map(str::to_string),
                ),
                Err(_) => (None, Some("wait-error".into())),
            };
            signal = match read_end {
                ReadLoopEnd::Eof => signal,
                ReadLoopEnd::OutputBackpressure => Some("output-backpressure".into()),
                ReadLoopEnd::ReaderError => Some("reader-error".into()),
            };
            let removed = remove_if_generation(&inner, &tid, generation);
            if removed {
                let _ = events.blocking_send(TerminalEvent::Exit {
                    terminal_id: tid,
                    exit_code,
                    signal,
                });
            }
        });
    }

    pub fn close(&self, close: InstanceTerminalClose) {
        if validate_terminal_id(&close.terminal_id, "terminalId").is_err() {
            return;
        }
        self.remove_session(&close.terminal_id);
    }

    pub fn fail(&self, terminal_id: &str, signal: &str) {
        let session = {
            let mut inner = self.inner.lock().expect("terminal host mutex");
            inner.sessions.remove(terminal_id)
        };
        if let Some(mut session) = session {
            kill_session(&mut session);
            let events = self.events.clone();
            let terminal_id = terminal_id.to_string();
            let signal = signal.to_string();
            tokio::spawn(async move {
                let _ = events
                    .send(TerminalEvent::Exit {
                        terminal_id,
                        exit_code: None,
                        signal: Some(signal),
                    })
                    .await;
            });
        }
    }

    pub fn close_all(&self) {
        let sessions: Vec<Session> = {
            let mut inner = self.inner.lock().expect("terminal host mutex");
            inner.sessions.drain().map(|(_, session)| session).collect()
        };
        for mut session in sessions {
            kill_session(&mut session);
        }
    }

    fn open_blocking(&self, open: InstanceTerminalOpen) -> InstanceTerminalOpened {
        let request_id = open.request_id.clone();
        let terminal_id = open.terminal_id.clone();
        {
            let inner = self.inner.lock().expect("terminal host mutex");
            if inner.sessions.len() >= MAX_TERMINALS_PER_INSTANCE_HOST {
                return rejected_open(request_id, terminal_id, "too many terminals on host");
            }
            if inner.sessions.contains_key(&terminal_id) {
                return rejected_open(request_id, terminal_id, "terminal id already exists");
            }
        }

        let pty_system = native_pty_system();
        let pair = match pty_system.openpty(PtySize {
            rows: open.rows,
            cols: open.cols,
            pixel_width: 0,
            pixel_height: 0,
        }) {
            Ok(pair) => pair,
            Err(e) => {
                return rejected_open(request_id, terminal_id, format!("openpty failed: {e}"));
            }
        };

        let mut cmd = CommandBuilder::new(controlled_shell());
        cmd.cwd(&open.cwd);
        cmd.env_clear();
        apply_safe_env(&mut cmd);

        let mut child = match pair.slave.spawn_command(cmd) {
            Ok(child) => child,
            Err(e) => {
                return rejected_open(request_id, terminal_id, format!("spawn failed: {e}"));
            }
        };

        let process_id = child.process_id();
        #[cfg(unix)]
        {
            // portable-pty 已在子进程 setsid；此处再尽力把 shell 放入独立 pgid（对齐 ACP child 的 process_group(0)）。
            if let Some(pid) = process_id
                .and_then(|id| i32::try_from(id).ok())
                .filter(|pid| *pid > 0)
            {
                unsafe {
                    let _ = libc::setpgid(pid, pid);
                }
            }
        }

        let writer = match pair.master.take_writer() {
            Ok(writer) => writer,
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return rejected_open(request_id, terminal_id, format!("pty writer failed: {e}"));
            }
        };
        let (input_tx, input_rx) = sync_channel::<Vec<u8>>(INPUT_QUEUE_CAP);

        let killer = child.clone_killer();
        let master: Box<dyn portable_pty::MasterPty + Send> = pair.master;
        let master = Arc::new(Mutex::new(master));
        #[cfg(unix)]
        let process_group_id = master
            .lock()
            .ok()
            .and_then(|guard| guard.process_group_leader());
        #[cfg(not(unix))]
        let process_group_id = None;
        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed);

        {
            let mut inner = self.inner.lock().expect("terminal host mutex");
            inner.sessions.insert(
                terminal_id.clone(),
                Session {
                    generation,
                    master,
                    input_tx,
                    next_input_seq: 1,
                    child: Some(child),
                    process_id,
                    process_group_id,
                    killer: Mutex::new(killer),
                    reader_started: false,
                },
            );
        }

        let writer_inner = self.inner.clone();
        let writer_events = self.events.clone();
        let writer_terminal_id = terminal_id.clone();
        std::thread::spawn(move || {
            if input_loop(writer, input_rx).is_err() {
                fail_generation(
                    &writer_inner,
                    &writer_events,
                    &writer_terminal_id,
                    generation,
                    "input-write-error",
                );
            }
        });

        InstanceTerminalOpened {
            request_id,
            terminal_id,
            ok: true,
            cwd: Some(open.cwd),
            cols: Some(open.cols),
            rows: Some(open.rows),
            error: None,
        }
    }

    fn remove_session(&self, terminal_id: &str) {
        let session = {
            let mut inner = self.inner.lock().expect("terminal host mutex");
            inner.sessions.remove(terminal_id)
        };
        if let Some(mut session) = session {
            kill_session(&mut session);
        }
    }
}

#[cfg(test)]
#[path = "terminal_host_test.rs"]
mod terminal_host_test;
