//! 模拟 ACP 子进程，用于集成测试
//!
//! 从 stdin 读取 JSON-RPC 行，按简单协议响应：
//! - initialize → 返回 capabilities
//! - session/new → 返回 {session_id: "test-sid-001"}
//! - session/load → 恢复请求中的 sessionId，后续 update 继续归属该会话
//! - session/list → 从 `--sessions-file` 读取隔离测试提供的 ACP 历史列表
//! - prompt → 逐行返回 session/update 通知（模拟流式输出）
//! - session/close → 返回 {closed: true} 后退出
//!
//! 支持 --crash-after=N：处理 N 条消息后 exit(1) 模拟崩溃

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let crash_after: Option<usize> = args
        .iter()
        .position(|a| a == "--crash-after")
        .and_then(|i| args.get(i + 1))
        .and_then(|s| s.parse().ok());
    let audit_file = args
        .iter()
        .position(|a| a == "--audit-file")
        .and_then(|i| args.get(i + 1))
        .map(PathBuf::from);
    let sessions_file = args
        .iter()
        .position(|a| a == "--sessions-file")
        .and_then(|i| args.get(i + 1))
        .map(PathBuf::from);

    let stdin = std::io::stdin();
    let reader = BufReader::new(stdin.lock());
    let mut message_count: usize = 0;
    let mut session_counter: usize = 0;
    // session/new 返回的真实 ACP session id（prompt 通知复用，保证归属一致）。
    let mut current_session_id: String = String::new();
    let mut agent_activity_enabled = false;
    let mut prediction_enabled = false;
    let mut replay_enabled = None;
    let mut form_elicitation_enabled = false;
    let mut pending_elicitation_id: Option<serde_json::Value> = None;

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        if line.trim().is_empty() {
            continue;
        }

        message_count += 1;

        let msg: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("[test-child] JSON 解析失败: {}", e);
                continue;
            }
        };

        let method = msg.get("method").and_then(|v| v.as_str());
        let id = msg.get("id").cloned();

        if method.is_none()
            && pending_elicitation_id.as_ref() == id.as_ref()
            && (msg.get("result").is_some() || msg.get("error").is_some())
        {
            write_audit_value(
                &audit_file,
                &serde_json::json!({
                    "method": "elicitation/response",
                    "requestId": id,
                    "result": msg.get("result"),
                    "error": msg.get("error"),
                }),
            );
            pending_elicitation_id = None;
            continue;
        }

        match method {
            Some("initialize") => {
                let token_stats = msg
                    .pointer("/params/clientCapabilities/_meta/peri.tokenStats")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false);
                let skill_names = msg
                    .pointer("/params/clientCapabilities/_meta/peri.skillNames")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false);
                agent_activity_enabled = msg
                    .pointer("/params/clientCapabilities/_meta/peri.agentActivity")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false);
                prediction_enabled = msg
                    .pointer("/params/clientCapabilities/_meta/peri.prediction")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false);
                replay_enabled = Some(
                    msg.pointer("/params/clientCapabilities/_meta/peri.replay")
                        .and_then(serde_json::Value::as_bool)
                        .unwrap_or(false),
                );
                form_elicitation_enabled = msg
                    .pointer("/params/clientCapabilities/elicitation/form")
                    .is_some_and(serde_json::Value::is_object);
                send_response(
                    &id,
                    &serde_json::json!({
                        "protocolVersion": 1,
                        "capabilities": {
                            "prompt": {"stream": true}
                        },
                        "agentCapabilities": {
                            "_meta": {
                                "peri.tokenStats": token_stats,
                                "peri.skillNames": skill_names,
                                "peri.agentActivity": agent_activity_enabled,
                                "peri.prediction": prediction_enabled,
                                "peri.replay": replay_enabled.unwrap_or(false)
                            }
                        },
                        "serverInfo": {
                            "name": "test-child",
                            "version": "0.1.0"
                        }
                    }),
                );
            }

            Some("session/new") => {
                session_counter += 1;
                // 使用 PID + 计数器确保不同进程返回唯一 ID
                current_session_id = format!("test-sid-{}-{}", std::process::id(), session_counter);
                send_response(
                    &id,
                    &serde_json::json!({
                        "sessionId": current_session_id
                    }),
                );
            }

            Some("session/load") => {
                let requested = msg
                    .get("params")
                    .and_then(|params| params.get("sessionId").or_else(|| params.get("session_id")))
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default();
                if requested.is_empty() {
                    send_error(&id, -32602, "session/load requires sessionId");
                } else {
                    write_audit(&audit_file, "session/load", requested);
                    current_session_id = requested.to_string();
                    if replay_enabled.unwrap_or(false) {
                        for (session_update, text) in [
                            ("user_message_chunk", "restored prompt"),
                            ("agent_message_chunk", "restored answer"),
                        ] {
                            send_notification(
                                "session/update",
                                &serde_json::json!({
                                    "sessionId": current_session_id,
                                    "update": {
                                        "sessionUpdate": session_update,
                                        "content": {
                                            "type": "text",
                                            "text": text,
                                            "_meta": {"periReplay": true}
                                        }
                                    }
                                }),
                            );
                        }
                    }
                    send_response(&id, &serde_json::json!({"loaded": true}));
                }
            }

            Some("session/list") => match read_sessions(&sessions_file) {
                Ok(sessions) => {
                    send_response(&id, &serde_json::json!({ "sessions": sessions }));
                }
                Err(message) => send_error(&id, -32603, &message),
            },

            Some("session/prompt") | Some("prompt") => {
                // 惰性生成：真实链路 server 必先 session/new；直接 prompt
                // （单测/异常链路）也保证通知携带非空 sessionId。
                if current_session_id.is_empty() {
                    current_session_id = format!("test-sid-{}-{}", std::process::id(), 0);
                }
                if form_elicitation_enabled
                    && value_contains_string(msg.get("params"), "[[ask-user]]")
                {
                    let request_id = serde_json::Value::String(format!(
                        "elicitation-test-{}",
                        current_session_id
                    ));
                    send(&serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": request_id,
                        "method": "elicitation/create",
                        "params": {
                            "sessionId": current_session_id,
                            "mode": "form",
                            "message": "Choose how Peri should continue",
                            "requestedSchema": {
                                "type": "object",
                                "properties": {
                                    "detail": {
                                        "type": "string",
                                        "title": "Detail",
                                        "description": "Add the context Peri needs"
                                    },
                                    "mode": {
                                        "type": "string",
                                        "title": "Mode",
                                        "enum": ["safe", "fast"]
                                    },
                                    "checks": {
                                        "type": "array",
                                        "title": "Checks",
                                        "items": {
                                            "type": "string",
                                            "enum": ["tests", "lint"]
                                        }
                                    }
                                },
                                "required": ["detail", "mode"]
                            }
                        }
                    }));
                    pending_elicitation_id = Some(request_id);
                }
                if agent_activity_enabled {
                    send_notification(
                        "peri/agent_activity",
                        &serde_json::json!({
                            "sessionId": current_session_id,
                            "activity": {
                                "schemaVersion": 1,
                                "kind": "subagent",
                                "status": "running",
                                "correlationId": "0123456789abcdef01234567",
                                "label": "test reviewer",
                                "isBackground": true,
                                "metrics": {},
                                "attributes": {}
                            }
                        }),
                    );
                }
                // 事件格式遵循 agent-client-protocol（真实 peri 实测）：
                // session/update 通知的 params.update 为
                // `{sessionUpdate, content:{type,text}}`——**无 turnId**，
                // 聚合器按 active_turn 归位（§7.2 宿主驱动 turn 模型）。
                let chunk = |i: u8| {
                    send_notification(
                        "session/update",
                        &serde_json::json!({
                            "sessionId": current_session_id,
                            "update": {
                                "sessionUpdate": "agent_message_chunk",
                                "content": {
                                    "type": "text",
                                    "text": format!("chunk_{i}")
                                }
                            }
                        }),
                    );
                };
                // chunk_1 同步输出（脚本收到首个 delta 后即可发 cancel）；
                // 其余 chunk 延迟输出（模拟真实 ACP 的异步流式）——主循环
                // 随即读 stdin，可响应运行中的 cancel。
                chunk(1);
                let sid = current_session_id.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(1200));
                    for i in 2..=3 {
                        send_notification(
                            "session/update",
                            &serde_json::json!({
                                "sessionId": sid,
                                "update": {
                                    "sessionUpdate": "agent_message_chunk",
                                    "content": {
                                        "type": "text",
                                        "text": format!("chunk_{i}")
                                    }
                                }
                            }),
                        );
                    }
                });
                // 最后返回 prompt 完成响应（真实 peri：终态唯一信号
                // stopReason；`end_turn` → turn 完成，§7.2）。
                send_response(
                    &id,
                    &serde_json::json!({
                        "stopReason": "end_turn"
                    }),
                );
                if prediction_enabled {
                    send_notification(
                        "peri/prediction_ready",
                        &serde_json::json!({
                            "sessionId": current_session_id,
                            "text": "检查下一项任务",
                            "actions": [{
                                "kind": "placeholder",
                                "text": "检查下一项任务"
                            }]
                        }),
                    );
                }
            }

            Some("session/close") => {
                send_response(
                    &id,
                    &serde_json::json!({
                        "closed": true
                    }),
                );
                std::process::exit(0);
            }

            Some("session/cancel") => {
                // 真实 peri：session/cancel 是 **notification**（无 id、无响应
                // 帧）——server 发送成功即确认并注入 turn 终态（§7.2）；
                // 本进程不回复、不另发终态通知（L3/cancel 确认已驱动）。
                eprintln!("[test-child] session/cancel (notification) 收到");
            }

            _ => {
                // 未知方法 → 返回 OK（兼容性）
                send_response(&id, &serde_json::json!({"ok": true}));
            }
        }

        // 检查 crash-after
        if let Some(limit) = crash_after {
            if message_count >= limit {
                eprintln!("[test-child] 模拟崩溃 (消息数: {})", message_count);
                std::process::exit(1);
            }
        }
    }
}

fn read_sessions(path: &Option<PathBuf>) -> Result<Vec<serde_json::Value>, String> {
    let path = path
        .as_ref()
        .ok_or_else(|| "session/list fixture is not configured".to_string())?;
    let body = std::fs::read_to_string(path)
        .map_err(|error| format!("session/list fixture read failed: {error}"))?;
    serde_json::from_str(&body)
        .map_err(|error| format!("session/list fixture JSON invalid: {error}"))
}

/// Test-only wire observation. Production instance logging intentionally never
/// records ACP stderr bodies; integration fixtures opt into this private temp file
/// so the restart product journey can prove the exact session/load identity.
fn write_audit(path: &Option<PathBuf>, method: &str, session_id: &str) {
    let record = serde_json::json!({"method": method, "sessionId": session_id});
    write_audit_value(path, &record);
}

fn write_audit_value(path: &Option<PathBuf>, record: &serde_json::Value) {
    let Some(path) = path else { return };
    let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    else {
        return;
    };
    let _ = writeln!(file, "{record}");
    let _ = file.flush();
}

fn value_contains_string(value: Option<&serde_json::Value>, needle: &str) -> bool {
    match value {
        Some(serde_json::Value::String(value)) => value.contains(needle),
        Some(serde_json::Value::Array(values)) => values
            .iter()
            .any(|value| value_contains_string(Some(value), needle)),
        Some(serde_json::Value::Object(values)) => values
            .values()
            .any(|value| value_contains_string(Some(value), needle)),
        _ => false,
    }
}

fn send_response(id: &Option<serde_json::Value>, result: &serde_json::Value) {
    let resp = serde_json::json!({
        "jsonrpc": "2.0",
        "id": id.clone().unwrap_or(serde_json::Value::Null),
        "result": result,
    });
    send(&resp);
}

fn send_error(id: &Option<serde_json::Value>, code: i64, message: &str) {
    let resp = serde_json::json!({
        "jsonrpc": "2.0",
        "id": id.clone().unwrap_or(serde_json::Value::Null),
        "error": {"code": code, "message": message},
    });
    send(&resp);
}

fn send_notification(method: &str, params: &serde_json::Value) {
    let notif = serde_json::json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
    });
    send(&notif);
}

fn send(value: &serde_json::Value) {
    let line = serde_json::to_string(value).unwrap();
    let mut stdout = std::io::stdout().lock();
    writeln!(stdout, "{}", line).unwrap();
    stdout.flush().unwrap();
}
