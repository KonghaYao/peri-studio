//! PTY 会话内部辅助函数。

use super::*;

pub(super) fn kill_session(session: &mut Session) {
    kill_process_tree(session.process_group_id.or(session.process_id.and_then(|id| i32::try_from(id).ok())));
    if let Ok(mut killer) = session.killer.lock() {
        let _ = killer.kill();
    }
    if let Some(mut child) = session.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[cfg(unix)]
pub(super) fn kill_process_tree(process_group_id: Option<i32>) {
    let Some(process_group_id) = process_group_id.filter(|pgid| *pgid > 0) else {
        return;
    };
    // portable-pty makes the shell a session leader; signal its process group
    // so background descendants cannot survive browser/transport cleanup.
    unsafe {
        libc::kill(-process_group_id, libc::SIGHUP);
        libc::kill(-process_group_id, libc::SIGKILL);
    }
}

#[cfg(not(unix))]
pub(super) fn kill_process_tree(_process_group_id: Option<i32>) {}

pub(super) fn process_group_id_from_pid(process_id: Option<u32>) -> Option<i32> {
    process_id.and_then(|id| i32::try_from(id).ok())
}

pub(super) fn rejected_open(
    request_id: String,
    terminal_id: String,
    message: impl Into<String>,
) -> InstanceTerminalOpened {
    InstanceTerminalOpened {
        request_id,
        terminal_id,
        ok: false,
        cwd: None,
        cols: None,
        rows: None,
        error: Some(message.into()),
    }
}

pub(super) fn remove_if_generation(
    inner: &Arc<Mutex<HostInner>>,
    terminal_id: &str,
    generation: u64,
) -> bool {
    let mut inner = inner.lock().expect("terminal host mutex");
    if inner
        .sessions
        .get(terminal_id)
        .is_some_and(|session| session.generation == generation)
    {
        inner.sessions.remove(terminal_id);
        true
    } else {
        false
    }
}

pub(super) fn fail_generation(
    inner: &Arc<Mutex<HostInner>>,
    events: &mpsc::Sender<TerminalEvent>,
    terminal_id: &str,
    generation: u64,
    signal: &str,
) {
    let session = {
        let mut inner = inner.lock().expect("terminal host mutex");
        if inner
            .sessions
            .get(terminal_id)
            .is_some_and(|session| session.generation == generation)
        {
            inner.sessions.remove(terminal_id)
        } else {
            None
        }
    };
    if let Some(mut session) = session {
        kill_session(&mut session);
        let _ = events.blocking_send(TerminalEvent::Exit {
            terminal_id: terminal_id.to_string(),
            exit_code: None,
            signal: Some(signal.to_string()),
        });
    }
}

pub(super) fn input_loop(
    mut writer: Box<dyn Write + Send>,
    input_rx: std::sync::mpsc::Receiver<Vec<u8>>,
) -> std::io::Result<()> {
    while let Ok(bytes) = input_rx.recv() {
        writer.write_all(&bytes)?;
        writer.flush()?;
    }
    Ok(())
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum ReadLoopEnd {
    Eof,
    ReaderError,
    OutputBackpressure,
}

pub(super) fn read_loop(
    mut reader: Box<dyn Read + Send>,
    terminal_id: String,
    seq: &AtomicU64,
    events: &mpsc::Sender<TerminalEvent>,
) -> ReadLoopEnd {
    let mut buf = [0u8; MAX_TERMINAL_CHUNK_BYTES];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => return ReadLoopEnd::Eof,
            Ok(n) => {
                let current = seq.fetch_add(1, Ordering::Relaxed);
                let data = encode_terminal_chunk(&buf[..n]);
                match events.try_send(TerminalEvent::Output {
                    terminal_id: terminal_id.clone(),
                    seq: current,
                    data,
                }) {
                    Ok(()) => {}
                    Err(mpsc::error::TrySendError::Full(_))
                    | Err(mpsc::error::TrySendError::Closed(_)) => {
                        return ReadLoopEnd::OutputBackpressure;
                    }
                }
            }
            Err(_) => return ReadLoopEnd::ReaderError,
        }
    }
}

pub(super) fn validate_open(open: &InstanceTerminalOpen) -> Result<std::path::PathBuf, String> {
    validate_terminal_id(&open.request_id, "requestId")?;
    validate_terminal_id(&open.terminal_id, "terminalId")?;
    validate_terminal_dims(open.cols, open.rows)?;
    let cwd = Path::new(&open.cwd);
    if !cwd.is_absolute() {
        return Err("cwd must be absolute".into());
    }
    let canonical = std::fs::canonicalize(cwd).map_err(|_| "cwd must be an existing directory")?;
    if !canonical.is_dir() {
        return Err("cwd must be an existing directory".into());
    }
    Ok(canonical)
}

/// 受控交互 shell：Unix 使用存在的绝对路径 SHELL，否则 `/bin/sh`；Windows `cmd.exe`。
pub(crate) fn controlled_shell() -> String {
    #[cfg(windows)]
    {
        return "cmd.exe".to_string();
    }
    #[cfg(not(windows))]
    {
        if let Ok(shell) = std::env::var("SHELL") {
            let path = Path::new(&shell);
            if path.is_absolute() && path.exists() {
                return shell;
            }
        }
        "/bin/sh".to_string()
    }
}

pub(super) fn apply_safe_env(cmd: &mut CommandBuilder) {
    for key in ["PATH", "HOME", "LANG", "SHELL"] {
        if let Ok(value) = std::env::var(key) {
            cmd.env(key, value);
        }
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
}
