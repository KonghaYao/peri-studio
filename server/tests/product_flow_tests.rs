//! Web 产品主旅程：cookie auth → project/session create → server restart →
//! catalog 恢复 → 精确 session/load 重新激活。

mod common;

use std::collections::BTreeMap;
use std::time::Duration;

use peri_studio_proto::ack::AckStatus;
use peri_studio_proto::action::{
    ActionEnvelope, CloseChatPayload, ElicitationAnswer, ElicitationResponseAction,
    PersistedSessionCreatePayload, PersistedSessionImportPayload, PersistedSessionOpenPayload,
    ProjectArchivePayload, ProjectCreatePayload, PromptChatPayload, RespondElicitationPayload,
};
use peri_studio_proto::Frame;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use yrs::{Map, ReadTxn, Transact};

use common::{
    chat_entry_provenance, doc_from_snapshots, project_field, project_session_field,
    project_session_ids, wait_terminal, InstanceProc, ServerProc, TestEnv, WsClient,
};

fn audited_load_ids(env: &TestEnv) -> Result<Vec<String>, String> {
    let body = std::fs::read_to_string(&env.acp_audit_file)
        .map_err(|error| format!("读取 ACP wire 审计失败: {error}"))?;
    body.lines()
        .map(|line| {
            let value: serde_json::Value = serde_json::from_str(line)
                .map_err(|error| format!("ACP wire 审计 JSON 非法: {error}"))?;
            if value["method"] != "session/load" {
                return Err(format!("ACP wire 审计出现未知方法: {value}"));
            }
            value["sessionId"]
                .as_str()
                .map(str::to_owned)
                .ok_or_else(|| format!("ACP wire 审计缺 sessionId: {value}"))
        })
        .collect()
}

fn audited_elicitation_responses(env: &TestEnv) -> Result<Vec<serde_json::Value>, String> {
    let body = std::fs::read_to_string(&env.acp_audit_file)
        .map_err(|error| format!("读取 ACP wire 审计失败: {error}"))?;
    body.lines()
        .filter_map(|line| {
            let value: serde_json::Value = match serde_json::from_str(line) {
                Ok(value) => value,
                Err(error) => return Some(Err(format!("ACP wire 审计 JSON 非法: {error}"))),
            };
            (value["method"] == "elicitation/response").then_some(Ok(value))
        })
        .collect()
}

fn elicitation_ids(doc: &yrs::Doc) -> Vec<String> {
    let txn = doc.transact();
    let Some(root) = txn.get_map("root") else {
        return Vec::new();
    };
    let Some(items) = root
        .get(&txn, "pending_elicitations")
        .and_then(|value| value.cast::<yrs::MapRef>().ok())
    else {
        return Vec::new();
    };
    let mut ids = items.keys(&txn).map(str::to_string).collect::<Vec<_>>();
    ids.sort();
    ids
}

fn elicitation_field(doc: &yrs::Doc, id: &str, field: &str) -> Option<String> {
    let txn = doc.transact();
    let root = txn.get_map("root")?;
    let items = root
        .get(&txn, "pending_elicitations")?
        .cast::<yrs::MapRef>()
        .ok()?;
    let item = items.get(&txn, id)?.cast::<yrs::MapRef>().ok()?;
    item.get(&txn, field)
        .and_then(|value| value.cast::<String>().ok())
}

struct HttpResponse {
    status: u16,
    headers: Vec<(String, String)>,
    body: String,
}

impl HttpResponse {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}

async fn auth_request(
    port: u16,
    method: &str,
    cookie: Option<&str>,
    body: Option<&str>,
) -> Result<HttpResponse, String> {
    let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
        .await
        .map_err(|e| format!("auth HTTP connect 失败: {e}"))?;
    let body = body.unwrap_or_default();
    let mut request = format!(
        "{method} /api/auth/session HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: http://127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n",
        body.len()
    );
    if let Some(cookie) = cookie {
        request.push_str(&format!("Cookie: {cookie}\r\n"));
    }
    request.push_str("\r\n");
    request.push_str(body);
    stream
        .write_all(request.as_bytes())
        .await
        .map_err(|e| format!("auth HTTP write 失败: {e}"))?;
    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .await
        .map_err(|e| format!("auth HTTP read 失败: {e}"))?;
    let response = String::from_utf8(response).map_err(|e| format!("auth HTTP 非 UTF-8: {e}"))?;
    let (head, body) = response
        .split_once("\r\n\r\n")
        .ok_or_else(|| "auth HTTP response 缺 header 边界".to_string())?;
    let mut lines = head.lines();
    let status = lines
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|value| value.parse().ok())
        .ok_or_else(|| "auth HTTP response 缺 status".to_string())?;
    let headers = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(key, value)| (key.to_string(), value.trim().to_string()))
        .collect();
    Ok(HttpResponse {
        status,
        headers,
        body: body.to_string(),
    })
}

async fn login(env: &TestEnv) -> Result<String, String> {
    let body = serde_json::json!({"token": env.client_token}).to_string();
    let response = auth_request(env.port, "POST", None, Some(&body)).await?;
    if response.status != 200 {
        return Err(format!(
            "登录失败 status={} body={}",
            response.status, response.body
        ));
    }
    assert_eq!(response.header("cache-control"), Some("no-store"));
    assert_eq!(response.header("pragma"), Some("no-cache"));
    assert_eq!(response.header("x-content-type-options"), Some("nosniff"));
    assert!(
        !response.body.contains(&env.client_token),
        "响应不得反射 bearer token"
    );
    let set_cookie = response
        .header("set-cookie")
        .ok_or_else(|| "登录响应缺 Set-Cookie".to_string())?;
    assert!(set_cookie.starts_with("peri_studio_session="));
    assert!(set_cookie.contains("HttpOnly"));
    assert!(set_cookie.contains("SameSite=Strict"));
    assert!(set_cookie.contains("Path=/"));
    assert!(set_cookie.contains("Max-Age=28800"));
    Ok(set_cookie
        .split(';')
        .next()
        .expect("cookie pair")
        .to_string())
}

async fn wait_prompt_delivery(
    client: &mut WsClient,
    command_id: &str,
    chat_doc: &str,
    timeout: Duration,
) -> Result<(), String> {
    let deadline = std::time::Instant::now() + timeout;
    let mut saw_update = false;
    let mut saw_terminal = false;
    while std::time::Instant::now() < deadline && (!saw_update || !saw_terminal) {
        let remaining = deadline
            .checked_duration_since(std::time::Instant::now())
            .unwrap_or(Duration::from_millis(1));
        match client.recv(remaining).await? {
            Some(Frame::YsyncUpdate(update)) if update.doc.as_str() == chat_doc => {
                saw_update = true;
            }
            Some(Frame::ActionAck(ack))
                if ack.command_id == command_id
                    && matches!(ack.status, AckStatus::Committed | AckStatus::Duplicate) =>
            {
                saw_terminal = true;
            }
            Some(Frame::ActionError(error)) if error.command_id == command_id => {
                return Err(format!(
                    "restored chat/prompt 失败: {:?} {}",
                    error.code, error.message
                ));
            }
            Some(_) => {}
            None => return Err("恢复 prompt 等待期间 WS 关闭".to_string()),
        }
    }
    if !saw_terminal || !saw_update {
        return Err(format!(
            "恢复 prompt 证据不完整: committed={saw_terminal} chat_update={saw_update}"
        ));
    }
    Ok(())
}

fn committed(frame: Frame, operation: &str) -> Result<peri_studio_proto::ack::ActionAck, String> {
    match frame {
        Frame::ActionAck(ack)
            if matches!(ack.status, AckStatus::Committed | AckStatus::Duplicate) =>
        {
            Ok(ack)
        }
        Frame::ActionAck(ack) => Err(format!("{operation} 意外 ack: {:?}", ack.status)),
        Frame::ActionError(error) => Err(format!(
            "{operation} 失败: {:?} {}",
            error.code, error.message
        )),
        _ => unreachable!("wait_terminal only returns terminal frames"),
    }
}

#[tokio::test]
async fn web_project_session_survives_restart_and_rebinds_exact_acp_id() -> Result<(), String> {
    println!("T-web-project-session-restart: START");
    let env = TestEnv::new();
    let mut server = ServerProc::start(&env, None);
    server.wait_ready()?;
    let mut instance = InstanceProc::start(&env);
    if !instance.wait_authenticated(Duration::from_secs(15)) {
        return Err("instance 初次认证超时".to_string());
    }

    let cookie = login(&env).await?;
    let status = auth_request(env.port, "GET", Some(&cookie), None).await?;
    assert_eq!(status.status, 200);
    assert!(status.body.contains("\"role\":\"full\""));
    let (mut client, _snapshot) =
        WsClient::connect_cookie(env.port, &cookie, &["hub:registry"]).await?;

    let project_command = uuid::Uuid::new_v4().to_string();
    client
        .send(&Frame::Action(ActionEnvelope::ProjectCreate {
            command_id: project_command,
            payload: ProjectCreatePayload {
                name: "E2E Project".to_string(),
                cwd: env.tmp.path().display().to_string(),
                instance_id: None,
            },
        }))
        .await?;
    let project_ack = committed(
        wait_terminal(&mut client, Duration::from_secs(20)).await?,
        "project/create",
    )?;
    let project_id = project_ack
        .project_id
        .ok_or_else(|| "project/create committed 缺 projectId".to_string())?;

    let session_command = uuid::Uuid::new_v4().to_string();
    client
        .send(&Frame::Action(ActionEnvelope::PersistedSessionCreate {
            command_id: session_command,
            payload: PersistedSessionCreatePayload {
                project_id: project_id.clone(),
                title: Some("Restart contract".to_string()),
            },
        }))
        .await?;
    let session_ack = committed(
        wait_terminal(&mut client, Duration::from_secs(35)).await?,
        "session/create",
    )?;
    let logical_session_id = session_ack
        .session_id
        .ok_or_else(|| "session/create committed 缺 sessionId".to_string())?;
    let first_chat_id = session_ack
        .chat_id
        .ok_or_else(|| "session/create committed 缺 chatId".to_string())?;
    let acp_session_id = session_ack
        .acp_session_id
        .ok_or_else(|| "session/create committed 缺 acpSessionId".to_string())?;

    let prompt_command = uuid::Uuid::new_v4().to_string();
    client
        .send(&Frame::Action(ActionEnvelope::Prompt {
            command_id: prompt_command,
            payload: PromptChatPayload {
                chat_id: first_chat_id.clone(),
                message: "persist me".to_string(),
                effort: None,
            },
        }))
        .await?;
    committed(
        wait_terminal(&mut client, Duration::from_secs(20)).await?,
        "first chat/prompt",
    )?;

    let close_command = uuid::Uuid::new_v4().to_string();
    client
        .send(&Frame::Action(ActionEnvelope::Close {
            command_id: close_command,
            payload: CloseChatPayload {
                chat_id: first_chat_id.clone(),
            },
        }))
        .await?;
    committed(
        wait_terminal(&mut client, Duration::from_secs(20)).await?,
        "chat/close before archive",
    )?;

    let archive_command = uuid::Uuid::new_v4().to_string();
    client
        .send(&Frame::Action(ActionEnvelope::PersistedSessionArchive {
            command_id: archive_command,
            payload: PersistedSessionOpenPayload {
                session_id: logical_session_id.clone(),
            },
        }))
        .await?;
    let archive_ack = committed(
        wait_terminal(&mut client, Duration::from_secs(20)).await?,
        "session/archive",
    )?;
    assert_eq!(
        archive_ack.session_id.as_deref(),
        Some(logical_session_id.as_str())
    );

    let forbidden_open_command = uuid::Uuid::new_v4().to_string();
    client
        .send(&Frame::Action(ActionEnvelope::PersistedSessionOpen {
            command_id: forbidden_open_command,
            payload: PersistedSessionOpenPayload {
                session_id: logical_session_id.clone(),
            },
        }))
        .await?;
    match wait_terminal(&mut client, Duration::from_secs(10)).await? {
        Frame::ActionError(error) => assert_eq!(
            error.code,
            peri_studio_proto::ack::ErrorCode::InvalidState,
            "archived session must be fail-closed on the wire"
        ),
        other => return Err(format!("archived session unexpectedly opened: {other:?}")),
    }
    let _ = client.ws.close(None).await;

    instance.kill();
    server.kill();

    server = ServerProc::start(&env, None);
    server.wait_ready()?;
    let old_cookie = auth_request(env.port, "GET", Some(&cookie), None).await?;
    assert_eq!(
        old_cookie.status, 401,
        "browser session 必须是进程内生命周期"
    );
    instance = InstanceProc::start(&env);
    if !instance.wait_authenticated(Duration::from_secs(15)) {
        return Err("instance 重启认证超时".to_string());
    }

    let cookie = login(&env).await?;
    let (mut restored_client, snapshots) =
        WsClient::connect_cookie(env.port, &cookie, &["hub:registry"]).await?;
    let registry = doc_from_snapshots(&snapshots, "hub:registry")?;
    assert_eq!(
        project_field(&registry, &project_id, "name").as_deref(),
        Some("E2E Project")
    );
    assert_eq!(
        project_session_field(&registry, &logical_session_id, "acp_session_id").as_deref(),
        Some(acp_session_id.as_str())
    );
    assert_eq!(
        project_session_field(&registry, &logical_session_id, "lifecycle").as_deref(),
        Some("ready")
    );
    assert!(
        project_session_field(&registry, &logical_session_id, "archived_at").is_some(),
        "restart must preserve the independent session archive marker"
    );
    assert_eq!(
        project_session_field(&registry, &logical_session_id, "active_chat_id").as_deref(),
        Some(first_chat_id.as_str()),
        "重启后 last_chat_id 保留（活跃 chat 权威判定）；hint 存活性由 chats 段交叉校验（web retainLiveRuntimeHints）"
    );

    let restore_command = uuid::Uuid::new_v4().to_string();
    restored_client
        .send(&Frame::Action(ActionEnvelope::PersistedSessionRestore {
            command_id: restore_command,
            payload: PersistedSessionOpenPayload {
                session_id: logical_session_id.clone(),
            },
        }))
        .await?;
    let restore_ack = committed(
        wait_terminal(&mut restored_client, Duration::from_secs(20)).await?,
        "session/restore",
    )?;
    assert_eq!(
        restore_ack.session_id.as_deref(),
        Some(logical_session_id.as_str())
    );
    let _ = restored_client.ws.close(None).await;
    let (mut restored_client, restored_snapshots) =
        WsClient::connect_cookie(env.port, &cookie, &["hub:registry"]).await?;
    let restored_registry = doc_from_snapshots(&restored_snapshots, "hub:registry")?;
    assert_eq!(
        project_session_field(&restored_registry, &logical_session_id, "archived_at"),
        None,
        "a fresh Registry snapshot must prove the restore projection barrier"
    );
    assert_eq!(
        project_session_field(&restored_registry, &logical_session_id, "acp_session_id").as_deref(),
        Some(acp_session_id.as_str()),
        "restore must preserve the durable ACP identity"
    );
    assert_eq!(
        project_session_field(&restored_registry, &logical_session_id, "lifecycle").as_deref(),
        Some("ready"),
        "restore must not rewrite runtime lifecycle"
    );

    let open_command = uuid::Uuid::new_v4().to_string();
    restored_client
        .send(&Frame::Action(ActionEnvelope::PersistedSessionOpen {
            command_id: open_command,
            payload: PersistedSessionOpenPayload {
                session_id: logical_session_id.clone(),
            },
        }))
        .await?;
    let open_ack = committed(
        wait_terminal(&mut restored_client, Duration::from_secs(35)).await?,
        "session/open",
    )?;
    assert_eq!(
        open_ack.session_id.as_deref(),
        Some(logical_session_id.as_str())
    );
    assert_eq!(
        open_ack.acp_session_id.as_deref(),
        Some(acp_session_id.as_str())
    );
    let restored_chat_id = open_ack
        .chat_id
        .ok_or_else(|| "session/open committed 缺 chatId".to_string())?;
    assert_ne!(
        restored_chat_id, first_chat_id,
        "重启后必须创建新的 runtime chat"
    );
    assert_eq!(
        audited_load_ids(&env)?,
        vec![acp_session_id.clone()],
        "新的 ACP 进程必须在 stdin wire 上收到 SQLite 恢复出的精确 durable session id"
    );

    let restored_chat_doc = format!("chat:{restored_chat_id}");
    let (_history_client, history_snapshots) =
        WsClient::connect_cookie(env.port, &cookie, &[&restored_chat_doc]).await?;
    let history_doc = doc_from_snapshots(&history_snapshots, &restored_chat_doc)?;
    assert_eq!(
        chat_entry_provenance(&history_doc),
        vec![
            ("session_replay".to_string(), Some(true)),
            ("session_replay".to_string(), Some(true)),
        ],
        "session/load history must retain exact negotiated Peri replay provenance"
    );
    restored_client
        .send(&Frame::YsyncSubscribe(
            peri_studio_proto::ysync::YsyncSubscribe {
                docs: vec![restored_chat_doc.parse().expect("valid chat doc id")],
                client_capabilities: vec![
                    peri_studio_proto::ysync::CAP_PROMPT_DELIVERY_V2.to_string()
                ],
            },
        ))
        .await?;
    restored_client
        .recv_until(
            |frame| {
                matches!(frame, Frame::YsyncUpdate(update) if update.doc.as_str() == restored_chat_doc)
            },
            Duration::from_secs(10),
        )
        .await?;

    let restored_prompt = uuid::Uuid::new_v4().to_string();
    restored_client
        .send(&Frame::Action(ActionEnvelope::Prompt {
            command_id: restored_prompt.clone(),
            payload: PromptChatPayload {
                chat_id: restored_chat_id,
                message: "after exact load".to_string(),
                effort: None,
            },
        }))
        .await?;
    wait_prompt_delivery(
        &mut restored_client,
        &restored_prompt,
        &restored_chat_doc,
        Duration::from_secs(20),
    )
    .await?;

    let logout = auth_request(env.port, "DELETE", Some(&cookie), None).await?;
    assert_eq!(logout.status, 204);
    assert!(logout
        .header("set-cookie")
        .is_some_and(|value| value.contains("Max-Age=0")));
    let logged_out = auth_request(env.port, "GET", Some(&cookie), None).await?;
    assert_eq!(logged_out.status, 401);

    println!(
        "T-web-project-session-restart: PASS project={project_id} logical_session={logical_session_id} acp_session={acp_session_id}"
    );
    Ok(())
}

#[tokio::test]
async fn web_explicit_import_survives_restart_and_loads_exact_acp_id() -> Result<(), String> {
    println!("T-web-explicit-import-restart: START");
    let env = TestEnv::new();
    let imported_acp_id = "fixture-external-session-001";
    env.set_discoverable_sessions(&[serde_json::json!({
        "sessionId": imported_acp_id,
        "title": "External ACP thread",
        "status": "ready",
        "updatedAt": "2026-08-14T00:00:00Z"
    })]);
    let mut server = ServerProc::start(&env, None);
    server.wait_ready()?;
    let mut instance = InstanceProc::start(&env);
    if !instance.wait_authenticated(Duration::from_secs(15)) {
        return Err("instance 初次认证超时".to_string());
    }

    let cookie = login(&env).await?;
    let (mut client, _) = WsClient::connect_cookie(env.port, &cookie, &["hub:registry"]).await?;
    let project_command = uuid::Uuid::new_v4().to_string();
    client
        .send(&Frame::Action(ActionEnvelope::ProjectCreate {
            command_id: project_command,
            payload: ProjectCreatePayload {
                name: "Import Project".to_string(),
                cwd: env.tmp.path().display().to_string(),
                instance_id: None,
            },
        }))
        .await?;
    let project_ack = committed(
        wait_terminal(&mut client, Duration::from_secs(20)).await?,
        "project/create for import",
    )?;
    let project_id = project_ack
        .project_id
        .ok_or_else(|| "project/create committed 缺 projectId".to_string())?;

    let discover_command = uuid::Uuid::new_v4().to_string();
    client
        .send(&Frame::Action(ActionEnvelope::PersistedSessionDiscover {
            command_id: discover_command,
            payload: ProjectArchivePayload {
                project_id: project_id.clone(),
            },
        }))
        .await?;
    committed(
        wait_terminal(&mut client, Duration::from_secs(35)).await?,
        "session/discover",
    )?;

    let import_command = uuid::Uuid::new_v4().to_string();
    client
        .send(&Frame::Action(ActionEnvelope::PersistedSessionImport {
            command_id: import_command,
            payload: PersistedSessionImportPayload {
                project_id: project_id.clone(),
                acp_session_id: imported_acp_id.to_string(),
            },
        }))
        .await?;
    let import_ack = committed(
        wait_terminal(&mut client, Duration::from_secs(20)).await?,
        "session/import",
    )?;
    let logical_session_id = import_ack
        .session_id
        .ok_or_else(|| "session/import committed 缺 sessionId".to_string())?;
    assert_eq!(import_ack.acp_session_id.as_deref(), Some(imported_acp_id));
    assert_eq!(
        import_ack.chat_id, None,
        "导入只建立侧边栏身份，不得偷偷启动 runtime"
    );

    let _ = client.ws.close(None).await;
    let (mut client, snapshots) =
        WsClient::connect_cookie(env.port, &cookie, &["hub:registry"]).await?;
    let registry = doc_from_snapshots(&snapshots, "hub:registry")?;
    assert_eq!(
        project_session_ids(&registry),
        vec![logical_session_id.clone()],
        "未导入的 ACP 候选不得自动进入 project_sessions/侧边栏"
    );
    assert_eq!(
        project_session_field(&registry, &logical_session_id, "acp_session_id").as_deref(),
        Some(imported_acp_id)
    );
    assert_eq!(
        project_session_field(&registry, &logical_session_id, "title").as_deref(),
        Some("External ACP thread")
    );
    assert_eq!(
        project_session_field(&registry, &logical_session_id, "active_chat_id"),
        None
    );
    let _ = client.ws.close(None).await;

    instance.kill();
    server.kill();
    server = ServerProc::start(&env, None);
    server.wait_ready()?;
    let old_cookie = auth_request(env.port, "GET", Some(&cookie), None).await?;
    assert_eq!(old_cookie.status, 401);
    instance = InstanceProc::start(&env);
    if !instance.wait_authenticated(Duration::from_secs(15)) {
        return Err("instance 重启认证超时".to_string());
    }

    let cookie = login(&env).await?;
    let (mut restored_client, restored_snapshots) =
        WsClient::connect_cookie(env.port, &cookie, &["hub:registry"]).await?;
    let restored_registry = doc_from_snapshots(&restored_snapshots, "hub:registry")?;
    assert_eq!(
        project_session_ids(&restored_registry),
        vec![logical_session_id.clone()]
    );
    assert_eq!(
        project_session_field(&restored_registry, &logical_session_id, "acp_session_id").as_deref(),
        Some(imported_acp_id)
    );
    assert_eq!(
        project_session_field(&restored_registry, &logical_session_id, "active_chat_id"),
        None,
        "重启后不得把导入候选冒充成存活 runtime"
    );

    let open_command = uuid::Uuid::new_v4().to_string();
    restored_client
        .send(&Frame::Action(ActionEnvelope::PersistedSessionOpen {
            command_id: open_command,
            payload: PersistedSessionOpenPayload {
                session_id: logical_session_id.clone(),
            },
        }))
        .await?;
    let open_ack = committed(
        wait_terminal(&mut restored_client, Duration::from_secs(35)).await?,
        "session/open imported",
    )?;
    assert_eq!(
        open_ack.session_id.as_deref(),
        Some(logical_session_id.as_str())
    );
    assert_eq!(open_ack.acp_session_id.as_deref(), Some(imported_acp_id));
    assert!(
        open_ack.chat_id.is_some(),
        "打开导入会话必须创建 runtime chat"
    );
    assert_eq!(
        audited_load_ids(&env)?,
        vec![imported_acp_id.to_string()],
        "导入会话必须以原始精确 ACP id 进入 session/load"
    );

    println!(
        "T-web-explicit-import-restart: PASS project={project_id} logical_session={logical_session_id} acp_session={imported_acp_id}"
    );
    Ok(())
}

#[tokio::test]
async fn peri_form_elicitation_projects_answers_and_deduplicates() -> Result<(), String> {
    println!("T-peri-form-elicitation: START");
    let env = TestEnv::new();
    let mut server = ServerProc::start(&env, None);
    server.wait_ready()?;
    let mut instance = InstanceProc::start(&env);
    if !instance.wait_authenticated(Duration::from_secs(15)) {
        return Err("instance 认证超时".to_string());
    }
    let cookie = login(&env).await?;
    let (mut client, _) = WsClient::connect_cookie(env.port, &cookie, &["hub:registry"]).await?;

    let project_command = uuid::Uuid::new_v4().to_string();
    client
        .send(&Frame::Action(ActionEnvelope::ProjectCreate {
            command_id: project_command,
            payload: ProjectCreatePayload {
                name: "Peri capabilities".to_string(),
                cwd: env.tmp.path().display().to_string(),
                instance_id: None,
            },
        }))
        .await?;
    let project_id = committed(
        wait_terminal(&mut client, Duration::from_secs(20)).await?,
        "project/create",
    )?
    .project_id
    .ok_or_else(|| "project/create committed 缺 projectId".to_string())?;

    let create_command = uuid::Uuid::new_v4().to_string();
    client
        .send(&Frame::Action(ActionEnvelope::PersistedSessionCreate {
            command_id: create_command,
            payload: PersistedSessionCreatePayload {
                project_id,
                title: Some("Ask user capability".to_string()),
            },
        }))
        .await?;
    let create_ack = committed(
        wait_terminal(&mut client, Duration::from_secs(35)).await?,
        "session/create",
    )?;
    let chat_id = create_ack
        .chat_id
        .ok_or_else(|| "session/create committed 缺 chatId".to_string())?;

    let prompt_command = uuid::Uuid::new_v4().to_string();
    client
        .send(&Frame::Action(ActionEnvelope::Prompt {
            command_id: prompt_command,
            payload: PromptChatPayload {
                chat_id: chat_id.clone(),
                message: "[[ask-user]] choose a safe plan".to_string(),
                effort: None,
            },
        }))
        .await?;
    committed(
        wait_terminal(&mut client, Duration::from_secs(20)).await?,
        "elicitation trigger prompt",
    )?;

    let session_doc = format!("session:{chat_id}");
    let (mut responder, snapshots) =
        WsClient::connect_cookie(env.port, &cookie, &[&session_doc]).await?;
    let control = doc_from_snapshots(&snapshots, &session_doc)?;
    let ids = elicitation_ids(&control);
    assert_eq!(ids.len(), 1, "negotiated Peri form must be projected once");
    let elicitation_id = ids[0].clone();
    assert_eq!(
        elicitation_field(&control, &elicitation_id, "status").as_deref(),
        Some("pending")
    );
    assert_eq!(
        elicitation_field(&control, &elicitation_id, "message").as_deref(),
        Some("Choose how Peri should continue")
    );

    let response_command = uuid::Uuid::new_v4().to_string();
    let response = ActionEnvelope::RespondElicitation {
        command_id: response_command.clone(),
        payload: RespondElicitationPayload {
            chat_id: chat_id.clone(),
            elicitation_id: elicitation_id.clone(),
            action: ElicitationResponseAction::Accept,
            answers: BTreeMap::from([
                (
                    "detail".to_string(),
                    ElicitationAnswer::Text("Preserve user data".to_string()),
                ),
                (
                    "mode".to_string(),
                    ElicitationAnswer::Text("safe".to_string()),
                ),
                (
                    "checks".to_string(),
                    ElicitationAnswer::Multiple(vec!["tests".to_string(), "lint".to_string()]),
                ),
            ]),
        },
    };
    responder.send(&Frame::Action(response.clone())).await?;
    let first = committed(
        wait_terminal(&mut responder, Duration::from_secs(20)).await?,
        "elicitation/respond",
    )?;
    assert_eq!(first.status, AckStatus::Committed);

    responder.send(&Frame::Action(response)).await?;
    let duplicate = committed(
        wait_terminal(&mut responder, Duration::from_secs(20)).await?,
        "elicitation/respond duplicate",
    )?;
    assert_eq!(duplicate.status, AckStatus::Duplicate);

    let (_verify, resolved_snapshots) =
        WsClient::connect_cookie(env.port, &cookie, &[&session_doc]).await?;
    let resolved = doc_from_snapshots(&resolved_snapshots, &session_doc)?;
    assert_eq!(
        elicitation_field(&resolved, &elicitation_id, "status").as_deref(),
        Some("resolved")
    );
    assert_eq!(
        elicitation_field(&resolved, &elicitation_id, "response_action").as_deref(),
        Some("accept")
    );

    let audit = audited_elicitation_responses(&env)?;
    assert_eq!(
        audit.len(),
        1,
        "same commandId must never answer Peri twice"
    );
    assert_eq!(audit[0]["result"]["action"], "accept");
    assert_eq!(
        audit[0]["result"]["content"]["detail"],
        "Preserve user data"
    );
    assert_eq!(audit[0]["result"]["content"]["mode"], "safe");
    assert_eq!(
        audit[0]["result"]["content"]["checks"],
        serde_json::json!(["tests", "lint"])
    );

    instance.kill();
    server.kill();
    println!("T-peri-form-elicitation: PASS chat={chat_id} elicitation={elicitation_id}");
    Ok(())
}
