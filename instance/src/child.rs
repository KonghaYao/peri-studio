//! ACP 子进程管理（F6 改造，§4.1）：spawn（进程组）/ kill（进程组）/ stdin 写 /
//! stdout 读 / wait 监控。
//!
//! 进程面（不含会话逻辑，session_id 仅为标签）：
//! - **spawn**：`process_group(0)`（Unix，子进程自建进程组，pgid = 子进程 pid，
//!   macOS 支持）+ `kill_on_drop(true)`（§7.5 兜底语义）+ stderr 独立读任务
//!   （仅日志计数，防阻塞）；
//! - **env 白名单**（§9.6）：`env_clear()` 后仅注入基集（PATH/HOME/LANG/SHELL，
//!   取自 daemon 环境）+ 调用方白名单追加项——子进程不继承宿主其余环境
//!   （`PERI_STUDIO_TOKEN_FILE` 等敏感变量不可达）；
//! - **stdout 读取任务**：逐行读取（JSON-RPC 行协议，单行上限
//!   [`MAX_LINE_BYTES`]）→ sessionId 提取（§3.3 双格式，见
//!   [`crate::error::extract_session_id`]）→ [`ChildOutput::Frame`]；
//!   无 sessionId 的 JSON-RPC 形态帧（有 jsonrpc 键：response/request/
//!   notification）按进程归属兜底转发（#5）；原始形态帧丢弃并上报
//!   [`ChildOutput::DroppedNoSessionId`]（本地缺口计数，§3.3）；超长行丢弃
//!   并上报 [`ChildOutput::OversizeLine`]；不再做 pending/id 匹配（响应匹配归
//!   server 侧）；
//! - **kill**：组级 `SIGTERM(-pgid)` → 宽限 `grace` → 组级 `SIGKILL(-pgid)`；
//!   已退出 → 立即成功（幂等）；
//! - **wait**：stdout EOF 后 `wait()` → 状态迁移 `Exited(code)` → 经通道上报
//!   （hub 组装 `instance/process_exit`）；
//! - **stdin 写**：`write_line` 写原样 JSON 行 + flush（§4.4 L2 的 instance 侧
//!   语义；进程已退出 → 写失败上报）。

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use anyhow::Context;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, Mutex};

use crate::error::extract_session_id;

/// 进程组 leader 出生身份（§7.5/§8 启动清理所有权验证）。
pub mod fingerprint;

/// Unix 进程组信号原语（`libc::kill(-pgid, sig)`，§4.1；见 f6-instance.md
/// §12 的 FFI 背景：libc crate 未预填，本模块自声明同一符号）。
#[cfg(unix)]
pub mod sys;

pub use fingerprint::process_fingerprint;

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/// 子进程运行状态。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProcessState {
    /// 运行中（stdout 未 EOF）。
    Running,
    /// 已退出（stdout EOF 后 wait 完成）。
    Exited(Option<i32>),
}

/// stdout 读取任务产出的 ACP 帧事件（dumb 透传，§3.3）。
#[derive(Debug, Clone)]
pub struct ChildEvent {
    pub session_id: String,
    /// 原始 ACP 帧（不透明 JSON）。
    pub frame: serde_json::Value,
}

/// 子进程生命周期事件（stdout 帧 / 退出 / 缺口计数）。
#[derive(Debug)]
pub enum ChildOutput {
    /// 可提取 sessionId 的帧（hub 转发调度）。
    Frame(ChildEvent),
    /// stdout EOF 后 wait 完成（hub 组装 `instance/process_exit`）。
    Exit {
        session_id: String,
        code: i32,
        /// 异常退出（非 0）时附带 stderr 首部（截断，诊断用途，§9.3 脱敏）。
        stderr_tail: Option<String>,
        /// 信号终止时的信号号（正常退出为 None）。
        signal: Option<i32>,
    },
    /// 无法提取 sessionId 的帧（已丢弃，§3.3 本地缺口计数）。
    DroppedNoSessionId,
    /// stdout 单行超 [`MAX_LINE_BYTES`] 的行（已丢弃，hub 侧计数，§8.5 防御）。
    OversizeLine,
}

/// stderr 正文诊断缓冲上限（只保留首部，§9.3 脱敏）。
const STDERR_TAIL_LIMIT: usize = 512;

/// stdout 单行字节上限（问题 4 防御）。4MB 远大于单帧上限 1MB（§8.5）——
/// 任何合法帧都能通过；无换行的异常巨行在读取侧即被截断丢弃，不得吃满内存。
const MAX_LINE_BYTES: usize = 4 * 1024 * 1024;

/// 超长行丢弃日志限频间隔（异常巨行可能高频出现，5s 一条即可见且不风暴）。
const OVERSIZE_LINE_LOG_INTERVAL: Duration = Duration::from_secs(5);

/// 白名单基集（§9.6：默认空 = 仅继承白名单基集；hub 侧 `validate_env` 用
/// 同一常量做双端校验）。值在 spawn 时取自 daemon 环境。
pub(crate) const ENV_BASE_ALLOWLIST: [&str; 4] = ["PATH", "HOME", "LANG", "SHELL"];

/// 内部共享态（spawn 返回的 [`AcpProcess`] 为 Arc 封装）。
struct AcpInner {
    process: Mutex<Option<Child>>,
    stdin: Mutex<Option<BufWriter<tokio::process::ChildStdin>>>,
    session_id: String,
    /// 进程组 id（= 子进程 pid，`process_group(0)` 语义）。
    pgid: i32,
    state: StdMutex<ProcessState>,
    /// 异常退出时由 stderr 读任务写入的诊断首部（stdout 读任务 wait 后读取）。
    stderr_tail: StdMutex<Option<String>>,
}

/// ACP 子进程句柄（进程面；spawn 后经 `Arc` 共享，session 管理在 hub）。
pub struct AcpProcess {
    inner: Arc<AcpInner>,
}

// ---------------------------------------------------------------------------
// spawn
// ---------------------------------------------------------------------------

/// 启动 ACP 子进程（进程组 + kill_on_drop + 双读任务）。
///
/// - `cmd`：启动命令（第一个元素为可执行文件）；
/// - `cwd`：工作目录；
/// - `env`：附加环境变量（§9.6 白名单由 hub 校验，此处仅透传）；
/// - `tx`：stdout 帧 / 退出 / 缺口事件的汇聚通道（有界，背压反压到管道，
///   见问题 3——通道满时读任务挂起在 `send().await`，管道写阻塞传导给 ACP）。
///
/// 返回句柄；事件经 `tx` 送达调用方（hub 侧统一汇聚）。
pub async fn spawn(
    cmd: &[String],
    cwd: &str,
    env: Option<&HashMap<String, String>>,
    session_id: &str,
    tx: mpsc::Sender<ChildOutput>,
) -> anyhow::Result<Arc<AcpProcess>> {
    if cmd.is_empty() {
        anyhow::bail!("cmd is empty");
    }
    let mut command = Command::new(&cmd[0]);
    command
        .args(&cmd[1..])
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    // §9.6 白名单基集：env_clear() 后仅注入基集 + 白名单追加项（问题 1）。
    // 基集值取自 daemon 环境（spawn 发生在 daemon 进程内）。
    command.env_clear();
    for key in ENV_BASE_ALLOWLIST {
        if let Ok(value) = std::env::var(key) {
            command.env(key, value);
        }
    }
    #[cfg(unix)]
    {
        // 子进程自建进程组（pgid = 子进程 pid）；组级 kill 覆盖整棵进程树
        // （ACP + 孙进程），防 kill ACP 后孙进程成孤儿（§7.5/§8）。
        command.process_group(0);
    }
    if let Some(envs) = env {
        command.envs(envs.iter().map(|(k, v)| (k.as_str(), v.as_str())));
    }
    let mut child = command
        .spawn()
        .context("failed to spawn ACP child process")?;

    let stdin = Mutex::new(child.stdin.take().map(BufWriter::new));
    let pgid = child
        .id()
        .expect("a successfully spawned child always has a pid") as i32;
    let inner = Arc::new(AcpInner {
        process: Mutex::new(Some(child)),
        stdin,
        session_id: session_id.to_string(),
        pgid,
        state: StdMutex::new(ProcessState::Running),
        stderr_tail: StdMutex::new(None),
    });

    let inner_read = inner.clone();
    tokio::spawn(async move {
        run_stdout_reader(inner_read, tx).await;
    });

    let inner_err = inner.clone();
    tokio::spawn(async move {
        run_stderr_reader(inner_err).await;
    });

    tracing::info!(target: "peri_studio::instance", session_id, pgid, "ACP child process started (process group)");
    Ok(Arc::new(AcpProcess { inner }))
}

/// 读取一行（至 `\n` 或 EOF），字节上限 `limit`。
///
/// 返回 `(got, oversize)`：`got=false` 表示 EOF 且无内容；`oversize=true`
/// 表示该行超过 `limit`（`buf` 截断保留前 `limit` 字节，行其余部分仍被完整
/// 消费——不分配超限内存，问题 4 防御）。`fill_buf`/`consume` 分段读取保证
/// `buf` 长度不超过 `limit`。
async fn read_line_bounded<R>(
    reader: &mut R,
    buf: &mut Vec<u8>,
    limit: usize,
) -> std::io::Result<(bool, bool)>
where
    R: tokio::io::AsyncBufRead + Unpin,
{
    buf.clear();
    let mut oversize = false;
    loop {
        let available = reader.fill_buf().await?;
        if available.is_empty() {
            // EOF：无内容 → got=false（调用方退出）；有内容（末行无 \n）→ 正常处理。
            return Ok((!buf.is_empty(), oversize));
        }
        let newline_at = available.iter().position(|&b| b == b'\n');
        let take = newline_at.map_or(available.len(), |p| p + 1);
        let headroom = limit.saturating_sub(buf.len());
        let keep = take.min(headroom);
        buf.extend_from_slice(&available[..keep]);
        if take > keep {
            oversize = true;
        }
        reader.consume(take);
        if newline_at.is_some() {
            return Ok((true, oversize));
        }
    }
}

/// stdout 读任务：逐行解析 → sessionId 提取 → 帧事件；EOF → wait → 退出上报。
async fn run_stdout_reader(inner: Arc<AcpInner>, tx: mpsc::Sender<ChildOutput>) {
    let mut stdout = {
        let mut process = inner.process.lock().await;
        match process.as_mut().and_then(|c| c.stdout.take()) {
            Some(o) => BufReader::new(o),
            None => return,
        }
    };

    let mut line: Vec<u8> = Vec::with_capacity(4096);
    let mut oversize_lines: u64 = 0;
    let mut last_oversize_log = std::time::Instant::now();
    loop {
        let (got, oversize) = match read_line_bounded(&mut stdout, &mut line, MAX_LINE_BYTES).await
        {
            Ok(v) => v,
            Err(e) => {
                tracing::error!(target: "peri_studio::instance", session_id = %inner.session_id,
                    "ACP stdout read error: {e}");
                break;
            }
        };
        if !got {
            break; // stdout 关闭 → 子进程（可能）退出
        }
        if oversize {
            oversize_lines += 1;
            // 限频日志（问题 4）：巨行可能高频出现，5s 一条即可见不风暴。
            let now = std::time::Instant::now();
            if now.duration_since(last_oversize_log) >= OVERSIZE_LINE_LOG_INTERVAL {
                tracing::warn!(target: "peri_studio::instance", session_id = %inner.session_id,
                    line_bytes = line.len(), count = oversize_lines,
                    max = MAX_LINE_BYTES,
                    "oversized stdout line dropped (no newline within limit)");
                last_oversize_log = now;
            }
            if tx.send(ChildOutput::OversizeLine).await.is_err() {
                return;
            }
            continue;
        }
        let trimmed = String::from_utf8_lossy(&line);
        let trimmed = trimmed.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parsed: serde_json::Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(target: "peri_studio::instance", session_id = %inner.session_id,
                    "ACP output is not a JSON line (dropped, counted only): {e}");
                if tx.send(ChildOutput::DroppedNoSessionId).await.is_err() {
                    return;
                }
                continue;
            }
        };
        match extract_session_id(&parsed) {
            Some(_) => {
                // 信封 session_id 一律为进程归属（hub session id，§4.5.1）；
                // 帧内 ACP sessionId 原样保留在 frame 里（可信 binding 校验键，
                // §6.2——server 凭帧内 sid 查 binding，信封仅用于路由归属）。
                if tx
                    .send(ChildOutput::Frame(ChildEvent {
                        session_id: inner.session_id.clone(),
                        frame: parsed,
                    }))
                    .await
                    .is_err()
                {
                    return;
                }
            }
            None => {
                // 无帧内 sessionId：JSON-RPC 形态（response/request/
                // notification，有 jsonrpc 键）一律按进程归属兜底转发
                // （#5 双端点统一，与 relay C2 同判据）：
                // - response：L3 确认经 rpcId 匹配（§4.4；create 序列
                //   initialize/session/new 的响应在 binding 建立前到达，
                //   server 侧经 pending_rpc 匹配，§6.2）；
                // - request：官方 session/request_permission（params.
                //   sessionId 必填，防御性统一，#1 OQ6）；
                // - notification：agent/status 为 instance 级事件，
                //   §5.4 投影无 chat 归属。
                // 本进程归属唯一 hub session（§4.5：spawn 时确立），
                // 以 inner.session_id 兜底——否则 server 永远收不到
                // response（t03 initialize timeout 根因）。
                // 原始 {type,payload} 形态无 sessionId → 仍
                // DroppedNoSessionId（本地缺口计数，§3.3）。
                if parsed.get("jsonrpc").is_some() {
                    if tx
                        .send(ChildOutput::Frame(ChildEvent {
                            session_id: inner.session_id.clone(),
                            frame: parsed,
                        }))
                        .await
                        .is_err()
                    {
                        return;
                    }
                } else {
                    tracing::debug!(target: "peri_studio::instance", session_id = %inner.session_id,
                        "frame without sessionId dropped (gap count)");
                    if tx.send(ChildOutput::DroppedNoSessionId).await.is_err() {
                        return;
                    }
                }
            }
        }
    }

    // stdout EOF → wait（消费 &mut Child；kill 路径互斥于同一锁）
    let (code, signal) = {
        let mut process = inner.process.lock().await;
        match process.as_mut() {
            Some(c) => {
                let status = c.wait().await.ok();
                (
                    status.and_then(|s| s.code()),
                    status.and_then(|s| {
                        use std::os::unix::process::ExitStatusExt;
                        s.signal()
                    }),
                )
            }
            None => (None, None),
        }
    };
    {
        let mut state = inner.state.lock().expect("state mutex poisoned");
        *state = ProcessState::Exited(code);
    }
    // 异常退出时附带 stderr 首部（stdout EOF 后 wait 完成；stderr 读任务可能
    // 尚未写回，短暂让步后读取。§9.3 脱敏：仅前 512 字节，标记诊断截断）。
    let stderr_tail = {
        if code != Some(0) {
            for _ in 0..50 {
                if inner
                    .stderr_tail
                    .lock()
                    .expect("stderr_tail mutex poisoned")
                    .is_some()
                {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(2)).await;
            }
            inner
                .stderr_tail
                .lock()
                .expect("stderr_tail mutex poisoned")
                .take()
        } else {
            None
        }
    };
    let _ = tx
        .send(ChildOutput::Exit {
            session_id: inner.session_id.clone(),
            code: code.unwrap_or(-1),
            signal,
            stderr_tail,
        })
        .await;
    eprintln!("DBG child: Exit sent for {}", inner.session_id);
}

/// stderr 读任务：仅计数（行数/字节），正文只保留首部（§9.3 脱敏），防管道
/// 阻塞。异常退出（非 0 码）时首部供 [`ChildOutput::Exit`] 诊断上报。
async fn run_stderr_reader(inner: Arc<AcpInner>) {
    let mut stderr = {
        let mut process = inner.process.lock().await;
        match process.as_mut().and_then(|c| c.stderr.take()) {
            Some(e) => BufReader::new(e),
            None => return,
        }
    };
    let mut bytes: u64 = 0;
    let mut lines: u64 = 0;
    let mut tail: Vec<u8> = Vec::with_capacity(STDERR_TAIL_LIMIT);
    let mut buf = [0u8; 4096];
    loop {
        match stderr.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => {
                bytes += n as u64;
                lines += buf[..n].iter().filter(|b| **b == b'\n').count() as u64;
                if tail.len() < STDERR_TAIL_LIMIT {
                    let take = (STDERR_TAIL_LIMIT - tail.len()).min(n);
                    tail.extend_from_slice(&buf[..take]);
                }
            }
            Err(_) => break,
        }
    }
    if !tail.is_empty() {
        let s = String::from_utf8_lossy(&tail).into_owned();
        let mut guard = inner
            .stderr_tail
            .lock()
            .expect("stderr_tail mutex poisoned");
        *guard = Some(s);
    }
    tracing::debug!(target: "peri_studio::instance", session_id = %inner.session_id, bytes, lines,
        "ACP stderr closed (only diagnostic head retained)");
}

// ---------------------------------------------------------------------------
// AcpProcess 方法
// ---------------------------------------------------------------------------

impl AcpProcess {
    /// 关联 session_id（标签用途）。
    pub fn session_id(&self) -> &str {
        &self.inner.session_id
    }

    /// 进程组 id（= 子进程 pid）。
    pub fn pgid(&self) -> i32 {
        self.inner.pgid
    }

    /// 当前运行状态（拷贝）。
    pub fn state(&self) -> ProcessState {
        *self.inner.state.lock().expect("state mutex poisoned")
    }

    /// 向 ACP 子进程写入一条 JSON-RPC 行（原样 + flush，§4.4 L2）。
    ///
    /// 进程已退出或管道已关闭 → `Err`（hub 据此上报失败语义）。
    pub async fn write_line(&self, value: &serde_json::Value) -> anyhow::Result<()> {
        {
            let state = self.inner.state.lock().expect("state mutex poisoned");
            if matches!(*state, ProcessState::Exited(_)) {
                anyhow::bail!("ACP process has exited");
            }
        }
        let line = serde_json::to_string(value)?;
        let mut stdin = self.inner.stdin.lock().await;
        let Some(w) = stdin.as_mut() else {
            anyhow::bail!("ACP stdin unavailable");
        };
        w.write_all(line.as_bytes()).await?;
        w.write_all(b"\n").await?;
        w.flush().await?;
        Ok(())
    }

    /// 组级 kill：`SIGTERM(-pgid)` → 宽限 `grace` → `SIGKILL(-pgid)`（§4.1）。
    ///
    /// 幂等：已退出（或进程组不存在，ESRCH）→ 立即成功。stdout 读任务随后
    /// wait 完成并上报退出。
    pub async fn kill(&self, grace: Duration) -> anyhow::Result<()> {
        {
            let state = self.inner.state.lock().expect("state mutex poisoned");
            if matches!(*state, ProcessState::Exited(_)) {
                return Ok(());
            }
        }
        let pgid = self.inner.pgid;
        if !sys::kill_group(pgid, sys::SIGTERM) {
            // ESRCH 等：进程组已不存在，视为已达成（幂等）。
            return Ok(());
        }
        tokio::time::sleep(grace).await;
        sys::kill_group(pgid, sys::SIGKILL);
        tracing::info!(target: "peri_studio::instance", session_id = %self.inner.session_id, pgid,
            grace_ms = grace.as_millis(), "ACP process group kill complete");
        Ok(())
    }
}

#[cfg(test)]
#[path = "child_identity_test.rs"]
mod child_identity_test;
