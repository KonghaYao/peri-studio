//! 帧测试共享构造器：覆盖 §3.2 全表 32 帧的 `all_frames()`（M1 + 保留类型 +
//! instance/forward 系），供 round-trip / 注册表一致性 / 序列化形态测试共用。

use std::collections::HashMap;

use crate::ack::{AckStatus, ActionAck, ActionError, ErrorCode};
use crate::action::{
    ActionEnvelope, CancelChatPayload, CloseChatPayload, ConfigSetPayload, CreateChatPayload,
    ElicitationAnswer, ElicitationResponseAction, LoadChatPayload, McpAppCallPayload,
    McpAppOpenPayload, McpAppResourcePayload, PermissionDecision,
    PersistedSessionCreatePayload, PersistedSessionImportPayload, PersistedSessionOpenPayload,
    PersistedSessionRenamePayload, ProjectArchivePayload, ProjectCreatePayload,
    ProjectRenamePayload, PromptChatPayload, ResolvePermissionPayload, RespondElicitationPayload,
    SubscribeEventsPayload, UnsubscribeEventsPayload,
};
use crate::conn::{Auth, AuthResponse, DocId, KeepAlive, Pong, Ready};
use crate::event::EventFrame;
use crate::frame::Frame;
use crate::instance::{
    BufferedFrame, InstanceBufferSync, InstanceEvent, InstanceHeartbeat, InstanceHello,
    InstanceKill, InstanceKillAck, InstanceProcessExit, InstanceSpawn, InstanceSpawnAck,
};
use crate::mcp_apps::{
    McpAppCallResultFrame, McpAppResourceFrame, McpAppSessionFrame,
};
use crate::oauth::{
    EphemeralAuthorizationUrl, McpConnectionStatus, McpOAuthAuthorizationFrame,
    McpOAuthEventStatus, McpOAuthFrame, McpOAuthStatus, McpServerInfo, McpServersFrame,
};
use crate::rewind::{
    RewindCandidate, RewindCandidatesFrame, RewindFileChange, RewindFileChangeKind,
    RewindPreviewFrame,
};
use crate::schema::SessionSummaryProjection;
use crate::session::{PromptDeliveryStatus, PromptStatusFrame, PromptStatusItem, SessionListFrame};
use crate::version::PROTOCOL_VERSION;
use crate::ysync::{YsyncAwareness, YsyncSubscribe, YsyncSync, YsyncUnsubscribe, YsyncUpdate};

/// 覆盖 §3.2 全表 32 帧的构造器（M1 + 保留类型 + instance/forward 系）。
///
/// 必须与 [`crate::frame::FRAME_TAGS`] 一一对应（`every_frame_tag_is_registered`
/// 断言）；新增帧变体时必须同步补构造条目，否则 round-trip 与注册表一致性
/// 测试双双失败（review 问题 4 的防复发面）。
pub(crate) fn all_frames() -> Vec<Frame> {
    let mut env = HashMap::new();
    env.insert("PATH".to_string(), "/usr/bin".to_string());
    let mut epochs = HashMap::new();
    epochs.insert("s1".to_string(), 2u64);

    vec![
        Frame::Action(ActionEnvelope::ProjectCreate {
            command_id: "pc1".into(),
            payload: ProjectCreatePayload {
                name: "demo".into(),
                cwd: "/tmp".into(),
                instance_id: None,
            },
        }),
        Frame::Action(ActionEnvelope::ProjectArchive {
            command_id: "pa1".into(),
            payload: ProjectArchivePayload {
                project_id: "p1".into(),
            },
        }),
        Frame::Action(ActionEnvelope::ProjectRestore {
            command_id: "project-restore".into(),
            payload: ProjectArchivePayload {
                project_id: "project-1".into(),
            },
        }),
        Frame::Action(ActionEnvelope::ProjectRename {
            command_id: "project-rename".into(),
            payload: ProjectRenamePayload {
                project_id: "project-1".into(),
                name: "New name".into(),
            },
        }),
        Frame::Action(ActionEnvelope::PersistedSessionCreate {
            command_id: "sc1".into(),
            payload: PersistedSessionCreatePayload {
                project_id: "p1".into(),
                title: Some("new".into()),
            },
        }),
        Frame::Action(ActionEnvelope::PersistedSessionOpen {
            command_id: "so1".into(),
            payload: PersistedSessionOpenPayload {
                session_id: "hs1".into(),
            },
        }),
        Frame::Action(ActionEnvelope::PersistedSessionRename {
            command_id: "sr1".into(),
            payload: PersistedSessionRenamePayload {
                session_id: "hs1".into(),
                name: "renamed".into(),
            },
        }),
        Frame::Action(ActionEnvelope::PersistedSessionArchive {
            command_id: "sa1".into(),
            payload: PersistedSessionOpenPayload {
                session_id: "hs1".into(),
            },
        }),
        Frame::Action(ActionEnvelope::PersistedSessionRestore {
            command_id: "srestore1".into(),
            payload: PersistedSessionOpenPayload {
                session_id: "hs1".into(),
            },
        }),
        Frame::Action(ActionEnvelope::PersistedSessionImport {
            command_id: "si1".into(),
            payload: PersistedSessionImportPayload {
                project_id: "p1".into(),
                acp_session_id: "acp-s1".into(),
            },
        }),
        Frame::Action(ActionEnvelope::PersistedSessionDiscover {
            command_id: "sd1".into(),
            payload: ProjectArchivePayload {
                project_id: "p1".into(),
            },
        }),
        Frame::Action(ActionEnvelope::PersistedSessionPromptStatus {
            command_id: "prompt-status-1".into(),
            payload: PersistedSessionOpenPayload {
                session_id: "hs1".into(),
            },
        }),
        // --- action 方法面（§4.3，含 M2/M3 保留类型） ---
        Frame::Action(ActionEnvelope::Create {
            command_id: "c1".into(),
            payload: CreateChatPayload {
                instance_id: None,
                cwd: Some("/tmp".into()),
                title: Some("t".into()),
                acp_session_id: None,
                workspace_id: None,
            },
        }),
        Frame::Action(ActionEnvelope::Load {
            command_id: "c2".into(),
            payload: LoadChatPayload {
                chat_id: "s1".into(),
                acp_session_id: "acp-s1".into(),
            },
        }),
        Frame::Action(ActionEnvelope::Close {
            command_id: "c3".into(),
            payload: CloseChatPayload {
                chat_id: "s1".into(),
            },
        }),
        Frame::Action(ActionEnvelope::Prompt {
            command_id: "c4".into(),
            payload: PromptChatPayload {
                chat_id: "s1".into(),
                message: "hi".into(),
                effort: None,
            },
        }),
        Frame::Action(ActionEnvelope::Cancel {
            command_id: "c5".into(),
            payload: CancelChatPayload {
                chat_id: "s1".into(),
            },
        }),
        Frame::Action(ActionEnvelope::ConfigSet {
            command_id: "config-1".into(),
            payload: ConfigSetPayload {
                chat_id: "s1".into(),
                config_id: "thinking_effort".into(),
                value: "max".into(),
            },
        }),
        Frame::Action(ActionEnvelope::ResolvePermission {
            command_id: "c6".into(),
            payload: ResolvePermissionPayload {
                chat_id: "s1".into(),
                permission_id: "p1".into(),
                decision: PermissionDecision::Allow,
                option_id: Some("allow-once".into()),
            },
        }),
        Frame::Action(ActionEnvelope::RespondElicitation {
            command_id: "c6e".into(),
            payload: RespondElicitationPayload {
                chat_id: "s1".into(),
                elicitation_id: "e1".into(),
                action: ElicitationResponseAction::Accept,
                answers: std::collections::BTreeMap::from([
                    ("target".into(), ElicitationAnswer::Text("tests".into())),
                    (
                        "checks".into(),
                        ElicitationAnswer::Multiple(vec!["lint".into(), "unit".into()]),
                    ),
                ]),
            },
        }),
        Frame::Action(ActionEnvelope::SubscribeEvents {
            command_id: "c7".into(),
            payload: SubscribeEventsPayload {
                chat_id: Some("s1".into()),
                from_seq: Some(3),
            },
        }),
        Frame::Action(ActionEnvelope::UnsubscribeEvents {
            command_id: "c8".into(),
            payload: UnsubscribeEventsPayload { chat_id: None },
        }),
        // --- Ack 与错误 ---
        Frame::ActionAck(ActionAck {
            command_id: "c1".into(),
            status: AckStatus::Committed,
            turn_id: Some("t1".into()),
            chat_id: Some("s1".into()),
            project_id: Some("p1".into()),
            session_id: Some("hs1".into()),
            acp_session_id: None,
            committed_projection_version: Some(7),
        }),
        Frame::ActionError(ActionError {
            command_id: "c1".into(),
            code: ErrorCode::AgentUnavailable,
            message: "redacted".into(),
            retryable: true,
            retry_after_ms: Some(1000),
        }),
        Frame::PromptStatus(PromptStatusFrame {
            command_id: "prompt-status-1".into(),
            session_id: "hs1".into(),
            runtime_restored: false,
            truncated: false,
            evidence_incomplete: false,
            prompts: vec![PromptStatusItem {
                command_id: "c4".into(),
                turn_id: Some("t1".into()),
                status: PromptDeliveryStatus::DeliveryUnknown,
                created_at: "2026-08-14T00:00:00Z".into(),
                updated_at: "2026-08-14T00:00:01Z".into(),
                error_code: None,
            }],
        }),
        // --- 按需查询结果帧（§6.3） ---
        Frame::SessionList(SessionListFrame {
            command_id: "session-list-1".into(),
            chat_id: "s1".into(),
            sessions: vec![SessionSummaryProjection {
                session_id: "acp-s1".into(),
                title: "demo".into(),
                status: "ended".into(),
                updated_at: "2026-08-15T00:00:00Z".into(),
                cwd: "/".into(),
                bound_chat_id: None,
            }],
        }),
        Frame::McpServers(McpServersFrame {
            command_id: "mcp-list-1".into(),
            chat_id: "s1".into(),
            servers: vec![McpServerInfo {
                name: "docs".into(),
                transport: "streamable_http".into(),
                connection_status: McpConnectionStatus::Disconnected,
                oauth_status: McpOAuthStatus::NeedsAuthorization,
                active_flow_id: Some("flow-1".into()),
                tools_count: 0,
                resources_count: 0,
            }],
        }),
        Frame::McpOAuth(McpOAuthFrame {
            chat_id: "s1".into(),
            flow_id: "flow-1".into(),
            server_name: "docs".into(),
            status: McpOAuthEventStatus::AuthorizationNeeded,
            failure_class: None,
            updated_at: "2026-08-15T00:00:00Z".into(),
        }),
        Frame::McpOAuthAuthorization(McpOAuthAuthorizationFrame {
            command_id: "oauth-url-1".into(),
            chat_id: "s1".into(),
            flow_id: "flow-1".into(),
            authorization_url: EphemeralAuthorizationUrl::new(
                "https://auth.example.test/authorize?state=opaque".into(),
            ),
            expires_at: "2026-08-15T00:00:30Z".into(),
        }),
        Frame::McpAppSession(McpAppSessionFrame {
            command_id: "mcp-app-open-1".into(),
            chat_id: "s1".into(),
            tool_call_id: "tool-1".into(),
            app_session_id: "app-1".into(),
            server_id: "fixture".into(),
            resource_uri: "ui://fixture/dashboard".into(),
        }),
        Frame::McpAppResource(McpAppResourceFrame {
            command_id: "mcp-app-resource-1".into(),
            chat_id: "s1".into(),
            app_session_id: "app-1".into(),
            html: "<html><body>app</body></html>".into(),
            mime_type: "text/html;profile=mcp-app".into(),
            csp: Some("default-src 'none'".into()),
            tool_result: Some(serde_json::json!({
                "content": [{"type": "text", "text": "ok"}],
                "structuredContent": {"source": "export default function App() { return null }"}
            })),
        }),
        Frame::McpAppCallResult(McpAppCallResultFrame {
            command_id: "mcp-app-call-1".into(),
            chat_id: "s1".into(),
            app_session_id: "app-1".into(),
            result: serde_json::json!({"content": [{"type": "text", "text": "ok"}]}),
        }),
        Frame::Action(ActionEnvelope::McpAppOpen {
            command_id: "mcp-app-open-action".into(),
            payload: McpAppOpenPayload {
                chat_id: "s1".into(),
                tool_call_id: "tool-1".into(),
            },
        }),
        Frame::Action(ActionEnvelope::McpAppResource {
            command_id: "mcp-app-resource-action".into(),
            payload: McpAppResourcePayload {
                chat_id: "s1".into(),
                app_session_id: "app-1".into(),
            },
        }),
        Frame::Action(ActionEnvelope::McpAppCall {
            command_id: "mcp-app-call-action".into(),
            payload: McpAppCallPayload {
                chat_id: "s1".into(),
                app_session_id: "app-1".into(),
                payload: serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": {"name": "refresh", "arguments": {}}
                }),
            },
        }),
        Frame::RewindCandidates(RewindCandidatesFrame {
            command_id: "rewind-candidates-1".into(),
            chat_id: "s1".into(),
            candidates: vec![RewindCandidate {
                message_id: "message-1".into(),
                preview: "Fix the parser".into(),
            }],
        }),
        Frame::RewindPreview(RewindPreviewFrame {
            command_id: "rewind-preview-1".into(),
            chat_id: "s1".into(),
            target_message_id: "message-1".into(),
            preview_fingerprint: "a".repeat(64),
            file_changes: vec![RewindFileChange {
                path: "src/parser.rs".into(),
                kind: RewindFileChangeKind::Edit,
            }],
        }),
        // --- 连接生命周期 ---
        Frame::Event(EventFrame {
            chat_id: "s1".into(),
            seq: 5,
            frame: serde_json::json!({"type": "agent_message_chunk", "text": "x"}),
        }),
        Frame::KeepAlive(KeepAlive {}),
        Frame::Pong(Pong {}),
        Frame::Ready(Ready {
            projection_versions: {
                let mut m = HashMap::new();
                m.insert(DocId::chat("s1"), 7u32);
                m.insert(DocId::REGISTRY, 2u32);
                m
            },
            negotiated_capabilities: vec!["prompt-status-v1".into()],
            max_prompt_bytes: Some(65_536),
        }),
        Frame::Auth(Auth {
            token: "tok".into(),
        }),
        Frame::AuthResponse(AuthResponse {
            connection_context: "AA==".into(),
            hmac: "BQ==".into(),
        }),
        // --- y-sync ---
        Frame::YsyncSubscribe(YsyncSubscribe {
            docs: vec![DocId::chat("s1"), DocId::session("s1")],
            client_capabilities: vec!["prompt-status-v1".into()],
        }),
        Frame::YsyncUnsubscribe(YsyncUnsubscribe {
            docs: vec![DocId::chat("s1")],
        }),
        Frame::YsyncUpdate(YsyncUpdate {
            doc: DocId::chat("s1"),
            update: "AAAA".into(),
            projection_version: Some(7),
        }),
        Frame::YsyncSync(YsyncSync { msg: "AAAA".into() }),
        Frame::YsyncAwareness(YsyncAwareness { msg: "AAAA".into() }),
        // --- instance 9 帧 ---
        Frame::InstanceHello(InstanceHello {
            protocol_version: PROTOCOL_VERSION,
            token: "mt".into(),
            hostname: "host1".into(),
            caps: serde_json::json!({"acp": "1.4"}),
            buffered: Some(true),
            buffer_lost: None,
            stream_epochs: Some(epochs.clone()),
            nonce: "AAAA".into(),
        }),
        Frame::InstanceHeartbeat(InstanceHeartbeat {
            load: 42,
            alive_sessions: vec!["s1".into()],
        }),
        Frame::InstanceEvent(InstanceEvent {
            chat_id: "s1".into(),
            epoch: 2,
            seq: 9,
            frame: serde_json::json!({"type": "agent_message_chunk"}),
        }),
        Frame::InstanceBufferSync(InstanceBufferSync {
            chat_id: "s1".into(),
            epoch: 2,
            from_seq: 7,
            frames: vec![BufferedFrame {
                seq: 7,
                frame: serde_json::json!({"type": "agent_message_chunk"}),
            }],
        }),
        Frame::InstanceSpawn(InstanceSpawn {
            command_id: "c9".into(),
            chat_id: "s1".into(),
            cmd: vec!["acp".into(), "--serve".into()],
            cwd: "/tmp".into(),
            env: Some(env),
        }),
        Frame::InstanceKill(InstanceKill {
            command_id: "c10".into(),
            chat_id: "s1".into(),
            grace: Some(500),
        }),
        Frame::InstanceSpawnAck(InstanceSpawnAck {
            command_id: "c9".into(),
            chat_id: "s1".into(),
            ok: true,
            error: None,
        }),
        Frame::InstanceKillAck(InstanceKillAck {
            command_id: "c10".into(),
            chat_id: "s1".into(),
            ok: true,
        }),
        Frame::InstanceProcessExit(InstanceProcessExit {
            chat_id: "s1".into(),
            code: 0,
        }),
    ]
}
