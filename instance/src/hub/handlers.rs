//! 入站帧分发（§4.2 spawn/kill 幂等处理）+ 下行 ACP 指令接入 + 优雅关闭。

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use futures::future::join_all;
use peri_studio_proto::instance::{InstanceKillAck, InstanceSpawnAck};
use peri_studio_proto::Frame;

use crate::child::{self, AcpProcess};
use crate::transport::TransportHandle;

use super::config::InstanceConfig;
use super::startup::validate_env;
use super::{ChatEntry, HubState};

/// 入站帧分发（§4.2 spawn/kill 幂等处理）。
pub(super) async fn handle_inbound(
    state: &HubState,
    handle: &TransportHandle,
    config: &InstanceConfig,
    frame: Frame,
    authenticated: bool,
) {
    match frame {
        Frame::InstanceSpawn(spawn) => {
            if !authenticated {
                state
                    .pre_auth_dropped
                    .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                tracing::warn!(target: "peri_studio::instance", chat_id = %spawn.chat_id,
                    "instance/spawn received before authentication (dropped, not executed)");
                return;
            }
            handle_spawn(state, handle, spawn).await;
        }
        Frame::InstanceKill(kill) => {
            if !authenticated {
                state
                    .pre_auth_dropped
                    .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                tracing::warn!(target: "peri_studio::instance", chat_id = %kill.chat_id,
                    "instance/kill received before authentication (dropped, not executed)");
                return;
            }
            handle_kill(state, handle, config, kill).await;
        }
        // 下行 ACP JSON-RPC 透传（冲突 1 裁决后接入）：写 ACP stdin（§4.4 L2），
        // 成功/失败回 `instance/forward_ack`（L1+L2 合并确认）。
        Frame::InstanceForward(fwd) => {
            if !authenticated {
                state
                    .pre_auth_dropped
                    .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                tracing::warn!(target: "peri_studio::instance", chat_id = %fwd.chat_id,
                    "instance/forward received before authentication (dropped, not executed)");
                return;
            }
            let ok = handle_downlink(state, &fwd.chat_id, &fwd.frame).await;
            // 下行诊断（§9.3 脱敏：method + turnId 长度，不记正文/密钥）。
            tracing::debug!(target: "peri_studio::instance", chat_id = %fwd.chat_id,
                method = fwd.frame.get("method").and_then(|m| m.as_str()).unwrap_or("?"),
                turn_id_len = fwd.frame.pointer("/params/turnId").and_then(|v| v.as_str()).map(|s| s.len()).unwrap_or(0),
                "downlink forwarded to ACP stdin");
            let ack = Frame::InstanceForwardAck(peri_studio_proto::instance::InstanceForwardAck {
                command_id: fwd.command_id.clone(),
                chat_id: fwd.chat_id.clone(),
                ok,
                error: if ok {
                    None
                } else {
                    Some("stdin_write_failed".to_string())
                },
            });
            if let Err(e) = handle.send(ack).await {
                tracing::warn!(target: "peri_studio::instance", chat_id = %fwd.chat_id,
                    error = ?e, "forward_ack send failed (connection may be down)");
            }
        }
        Frame::InstanceResourceQuery(query) => {
            if !authenticated {
                state
                    .pre_auth_dropped
                    .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                tracing::warn!(target: "peri_studio::instance", request_id = %query.request_id,
                    "instance/resource_query received before authentication (dropped, not executed)");
                return;
            }
            // 文件系统与 Git 命令具有独立的超时和阻塞隔离；派生任务避免慢盘
            // 或大仓库阻塞 daemon 的 heartbeat / ACP 多路复用循环。
            let outbound = handle.clone();
            let resource_host = state.resource_host.clone();
            tokio::spawn(async move {
                let result = resource_host.query(query).await;
                if let Err(error) = outbound.send(Frame::InstanceResourceResult(result)).await {
                    tracing::warn!(target: "peri_studio::instance", error = ?error,
                        "resource result send failed (connection may be down)");
                }
            });
        }
        Frame::InstanceTerminalOpen(open) => {
            if !authenticated {
                state
                    .pre_auth_dropped
                    .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                tracing::warn!(target: "peri_studio::instance",
                    "instance/terminal_open received before authentication (dropped, not executed)");
                return;
            }
            let host = state.terminal_host.clone();
            let opened = host.open(open).await;
            let tid = opened.terminal_id.clone();
            let ok = opened.ok;
            if let Err(e) = handle.send(Frame::InstanceTerminalOpened(opened)).await {
                host.close(peri_studio_proto::terminal::InstanceTerminalClose { terminal_id: tid });
                tracing::warn!(target: "peri_studio::instance", error = ?e,
                    "terminal_opened send failed");
                return;
            }
            if ok {
                host.start_reader(&tid);
            }
        }
        Frame::InstanceTerminalInput(input) => {
            if !authenticated {
                state
                    .pre_auth_dropped
                    .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                tracing::warn!(target: "peri_studio::instance",
                    "instance/terminal_input received before authentication (dropped, not executed)");
                return;
            }
            let terminal_id = input.terminal_id.clone();
            if let Err(error) = state.terminal_host.input(input).await {
                tracing::warn!(target: "peri_studio::instance", terminal_id = %terminal_id,
                    error = %error, "terminal input failed; closing PTY");
                state.terminal_host.fail(&terminal_id, "input-error");
            }
        }
        Frame::InstanceTerminalResize(resize) => {
            if !authenticated {
                state
                    .pre_auth_dropped
                    .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                tracing::warn!(target: "peri_studio::instance",
                    "instance/terminal_resize received before authentication (dropped, not executed)");
                return;
            }
            let terminal_id = resize.terminal_id.clone();
            if let Err(error) = state.terminal_host.resize(resize).await {
                tracing::warn!(target: "peri_studio::instance", terminal_id = %terminal_id,
                    error = %error, "terminal resize failed; closing PTY");
                state.terminal_host.fail(&terminal_id, "resize-error");
            }
        }
        Frame::InstanceTerminalClose(close) => {
            if !authenticated {
                state
                    .pre_auth_dropped
                    .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                tracing::warn!(target: "peri_studio::instance",
                    "instance/terminal_close received before authentication (dropped, not executed)");
                return;
            }
            state.terminal_host.close(close);
        }
        other => {
            tracing::warn!(target: "peri_studio::instance", tag = %other.tag(),
                "inbound frame not handled by instance (dropped and counted)");
        }
    }
}

/// 下行 ACP 指令接入（冲突 1 裁决后）：写 ACP stdin（§4.4 L2）。
///
/// 写失败（进程已退出/管道关闭）→ 返回 `false`，调用方回
/// `instance/forward_ack { ok: false }`（server 侧映射 retryable 失败）。
async fn handle_downlink(state: &HubState, chat_id: &str, frame: &serde_json::Value) -> bool {
    let acp = {
        let chats = state.chats.lock().expect("chats mutex poisoned");
        chats.get(chat_id).and_then(|e| e.acp.clone())
    };
    match acp {
        Some(acp) => acp.write_line(frame).await.is_ok(),
        None => {
            tracing::warn!(target: "peri_studio::instance", chat_id,
                "downlink write failed: session missing or process exited");
            false
        }
    }
}

/// `instance/spawn`（§4.5/§7）：按 chat_id 幂等；env 白名单 + cwd 校验；
/// 不二次起进程；epoch = 水位 + 1（新 session 为 1）。
async fn handle_spawn(
    state: &HubState,
    handle: &TransportHandle,
    spawn: peri_studio_proto::instance::InstanceSpawn,
) {
    let sid = spawn.chat_id.clone();
    let command_id = spawn.command_id.clone();

    // 前置校验（§7：env 双端白名单、cwd 存在性【决策】；失败 → 脱敏类别 ack）。
    if let Some(env) = &spawn.env {
        let extra = state.env_allowlist.clone();
        if let Err(cat) = validate_env(env, &extra) {
            tracing::warn!(target: "peri_studio::instance", chat_id = %sid, reason = cat,
                "spawn env validation failed");
            send_spawn_ack(handle, &command_id, &sid, false, Some(cat)).await;
            return;
        }
    }
    if !Path::new(&spawn.cwd).is_dir() {
        tracing::warn!(target: "peri_studio::instance", chat_id = %sid, "spawn cwd does not exist");
        send_spawn_ack(handle, &command_id, &sid, false, Some("cwd_not_found")).await;
        return;
    }

    // 幂等：会话已存在且进程存活 → 直接 ok（不二次起进程，§4.5）。
    let idempotent_hit = {
        let chats = state.chats.lock().expect("chats mutex poisoned");
        chats.get(&sid).is_some_and(|e| e.acp.is_some())
    };
    if idempotent_hit {
        tracing::info!(target: "peri_studio::instance", chat_id = %sid,
            "spawn idempotent hit: session exists, acking directly");
        send_spawn_ack(handle, &command_id, &sid, true, None).await;
        return;
    }

    // epoch：水位记录 + 1（新 session 无记录 → 1，§4.5.1/§5）。
    let epoch = {
        let wm = state.watermark.lock().expect("watermark mutex poisoned");
        wm.epoch_of(&sid).map_or(1, |e| e + 1)
    };

    // 诊断：实际下发命令、cwd 与 PATH（§9.3 脱敏：cmd/cwd 为运维配置，
    // 不含 secret；PATH 定位 spawn 即崩类问题必需）。
    tracing::info!(target: "peri_studio::instance", chat_id = %sid,
        cmd = ?spawn.cmd, cwd = %spawn.cwd,
        path = %std::env::var("PATH").unwrap_or_default(),
        "spawn command (diagnostic)");

    // spawn（进程组 + kill_on_drop；stdout 事件经有界汇聚通道到主循环，
    // 通道满时读任务反压到管道，见问题 3）。
    match child::spawn(
        &spawn.cmd,
        &spawn.cwd,
        spawn.env.as_ref(),
        &sid,
        state.child_tx.clone(),
    )
    .await
    {
        Ok(acp) => {
            {
                let mut chats = state.chats.lock().expect("chats mutex poisoned");
                chats.insert(
                    sid.clone(),
                    ChatEntry {
                        acp: Some(acp.clone()),
                        epoch,
                        next_seq: 1,
                        last_sent_seq: 0,
                        buffered: false,
                    },
                );
            }
            // 水位：epoch 变更写盘（§4.4.3 更新时机）。
            let pgid = acp.pgid();
            let process_fingerprint = child::process_fingerprint(pgid);
            {
                let mut wm = state.watermark.lock().expect("watermark mutex poisoned");
                if let Err(e) = wm.record(&sid, epoch, 0, pgid, process_fingerprint) {
                    tracing::error!(target: "peri_studio::instance", chat_id = %sid, error = %e,
                        "watermark write failed");
                }
            }
            tracing::info!(target: "peri_studio::instance", chat_id = %sid, epoch, pgid,
                "ACP process started");
            send_spawn_ack(handle, &command_id, &sid, true, None).await;
        }
        Err(e) => {
            // §9.3 脱敏：日志/ack 不含 cmd/cwd/env 值。
            tracing::error!(target: "peri_studio::instance", chat_id = %sid, error = %e,
                "spawn failed (process not started)");
            send_spawn_ack(handle, &command_id, &sid, false, Some("spawn_failed")).await;
        }
    }
}

/// `instance/kill`（§4.5/§7）：组级 kill（grace 可被 server 覆盖）；目标不存在
/// /已退出 → 视为已达成（幂等，`kill_ack{ok:true}`）。
async fn handle_kill(
    state: &HubState,
    handle: &TransportHandle,
    config: &InstanceConfig,
    kill: peri_studio_proto::instance::InstanceKill,
) {
    let sid = kill.chat_id.clone();
    let command_id = kill.command_id.clone();
    let acp = {
        let chats = state.chats.lock().expect("chats mutex poisoned");
        chats.get(&sid).and_then(|e| e.acp.clone())
    };
    let grace = kill
        .grace
        .map(Duration::from_millis)
        .unwrap_or(config.kill_grace);
    match acp {
        Some(acp) => {
            let _ = acp.kill(grace).await;
            tracing::info!(target: "peri_studio::instance", chat_id = %sid, grace_ms = grace.as_millis(),
                "kill complete (process group)");
        }
        None => {
            tracing::info!(target: "peri_studio::instance", chat_id = %sid,
                "kill idempotent: target missing/exited, treated as done");
        }
    }
    let ack = Frame::InstanceKillAck(InstanceKillAck {
        command_id,
        chat_id: sid,
        ok: true,
    });
    let _ = handle.send(ack).await;
}

async fn send_spawn_ack(
    handle: &TransportHandle,
    command_id: &str,
    chat_id: &str,
    ok: bool,
    error: Option<&'static str>,
) {
    let ack = Frame::InstanceSpawnAck(InstanceSpawnAck {
        command_id: command_id.to_string(),
        chat_id: chat_id.to_string(),
        ok,
        error: error.map(ToOwned::to_owned),
    });
    let _ = handle.send(ack).await;
}

/// 优雅关闭：组级 kill 全部存活 session（并行，§8 三层语义第一/二层）。
///
/// 返回是否 kill 了任何进程组；`false` 表示无存活 ACP 会话（调用方可据此
/// 跳过等待 Exit 事件的收尾阶段，避免空等）。
pub(super) async fn shutdown_all(state: &HubState, config: &InstanceConfig) -> bool {
    let acps: Vec<Arc<AcpProcess>> = {
        let chats = state.chats.lock().expect("chats mutex poisoned");
        chats.values().filter_map(|e| e.acp.clone()).collect()
    };
    if acps.is_empty() {
        return false;
    }
    let grace = config.kill_grace;
    let tasks = acps.into_iter().map(|acp| {
        tokio::spawn(async move {
            let _ = acp.kill(grace).await;
        })
    });
    join_all(tasks).await;
    true
}

/// 断线：所有存活 session 置缓冲模式（重连补推判定依据）。
pub(super) fn mark_all_buffered(state: &HubState) {
    let mut chats = state.chats.lock().expect("chats mutex poisoned");
    for entry in chats.values_mut() {
        if entry.acp.is_some() {
            entry.buffered = true;
        }
    }
}
