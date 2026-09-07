//! schema 测试共享构造器：三 Doc 根对象（chat / control / registry）。

use std::collections::HashMap;

use crate::schema::{
    ActiveTurnProjection, AgentStatusProjection, BlockVisibility, ChatDocRoot, ChatEntry,
    ChatInfoProjection, ChatStatus, ChatSummary, ContentBlock, EntryKind, EntryRole, EntryStatus,
    GlobalStatus, InstanceStatus, InstanceView, PermissionOptions, PermissionProjection,
    PermissionStatus, RegistryDocRoot, RegistryGlobal, SessionDocRoot, SessionSummaryProjection,
    ToolCallProjection, ToolCallStatus, TurnStatus, WorkspaceSummary,
};

pub(crate) fn chat_root() -> ChatDocRoot {
    let mut blocks = HashMap::new();
    blocks.insert(
        "b1".into(),
        ContentBlock::Reasoning {
            block_id: "b1".into(),
            text: "think".into(),
            visibility: BlockVisibility::Summary,
        },
    );
    let mut entries = HashMap::new();
    entries.insert(
        "t1:assistant".into(),
        ChatEntry {
            entry_id: "t1:assistant".into(),
            turn_id: Some("t1".into()),
            kind: EntryKind::Message,
            role: EntryRole::Assistant,
            status: EntryStatus::Completed,
            author_user_id: None,
            source_command_id: None,
            origin: None,
            replay_verified: None,
            created_at: "2026-08-07T00:00:00Z".into(),
            completed_at: Some("2026-08-07T00:00:01Z".into()),
            block_order: vec!["b1".into()],
            blocks,
            error: None,
        },
    );
    let mut tool_calls = HashMap::new();
    tool_calls.insert(
        "tc1".into(),
        ToolCallProjection {
            tool_call_id: "tc1".into(),
            turn_id: "t1".into(),
            name: "bash".into(),
            kind: crate::schema::ToolCallKind::Execute,
            status: ToolCallStatus::Completed,
            arguments: Some(serde_json::json!({"cmd": "ls"})),
            arguments_omitted: Some(false),
            arguments_bytes: Some(12),
            content: None,
            content_omitted: None,
            content_bytes: None,
            locations: None,
            locations_omitted: None,
            locations_bytes: None,
            result: Some(serde_json::json!({"output": "x"})),
            result_omitted: Some(false),
            result_bytes: Some(14),
            public_error: None,
            permission_id: None,
            started_at: Some("2026-08-07T00:00:00Z".into()),
            completed_at: Some("2026-08-07T00:00:01Z".into()),
            mcp_server_id: None,
            mcp_tool_name: None,
            mcp_resource_uri: None,
            mcp_app_session_id: None,
        },
    );
    ChatDocRoot {
        schema_version: crate::version::CHAT_DOC_SCHEMA_VERSION,
        projection_version: 3,
        entry_order: vec!["t1:assistant".into()],
        entries,
        tool_calls,
    }
}

pub(crate) fn control_root() -> SessionDocRoot {
    let mut pending = HashMap::new();
    pending.insert(
        "p1".into(),
        PermissionProjection {
            permission_id: "p1".into(),
            turn_id: "t1".into(),
            tool_call_id: Some("tc1".into()),
            title: "run bash".into(),
            description: None,
            options: vec![PermissionOptions::AllowOnce, PermissionOptions::Deny],
            status: PermissionStatus::Pending,
            expires_at: "2026-08-07T00:05:00Z".into(),
            decision: None,
        },
    );
    let mut chats = HashMap::new();
    chats.insert(
        "old1".into(),
        SessionSummaryProjection {
            session_id: "old1".into(),
            title: "old".into(),
            status: "ended".into(),
            updated_at: "2026-08-06T00:00:00Z".into(),
            cwd: String::new(),
            bound_chat_id: None,
        },
    );
    SessionDocRoot {
        schema_version: crate::version::SESSION_DOC_SCHEMA_VERSION,
        projection_version: 2,
        chat: ChatInfoProjection {
            chat_id: "s1".into(),
            title: "demo".into(),
            status: ChatStatus::Active,
            active_turn_id: Some("t1".into()),
            created_at: "2026-08-07T00:00:00Z".into(),
            updated_at: "2026-08-07T00:00:01Z".into(),
        },
        agent: AgentStatusProjection {
            instance_id: "i1".into(),
            session_id: "acp-1".into(),
            status: "running".into(),
            capabilities: vec!["bash".into()],
            available_commands: vec!["bash".into()],
            command_catalog: HashMap::from([(
                "bash".into(),
                crate::schema::AgentCommandProjection {
                    name: "bash".into(),
                    description: "Run a command".into(),
                    kind: "command".into(),
                },
            )]),
            extensions: vec!["peri.tokenStats".into(), "peri.skillNames".into()],
            latest_usage: Some(crate::schema::AgentUsageProjection {
                input_tokens: Some(1200),
                output_tokens: Some(345),
                cache_creation_tokens: None,
                cache_read_tokens: Some(900),
                request_id: Some("req-123".into()),
                model: Some("claude-opus-4-1".into()),
                stop_reason: Some("end_turn".into()),
            }),
            activities: HashMap::from([(
                "subagent:abc".into(),
                crate::schema::AgentActivityProjection {
                    id: "subagent:abc".into(),
                    kind: crate::schema::AgentActivityKind::Subagent,
                    status: crate::schema::AgentActivityStatus::Running,
                    label: Some("reviewer".into()),
                    is_background: Some(true),
                    metrics: std::collections::BTreeMap::new(),
                    attributes: std::collections::BTreeMap::new(),
                    created_at: "2026-08-07T00:00:00Z".into(),
                    updated_at: "2026-08-07T00:00:01Z".into(),
                },
            )]),
            activity_order: vec!["subagent:abc".into()],
            input_prediction: Some(crate::schema::AgentInputPredictionProjection {
                id: "prediction:1:9".into(),
                text: "检查失败测试".into(),
                created_at: "2026-08-07T00:00:01Z".into(),
            }),
            plan: vec![],
            last_activity_at: "2026-08-07T00:00:01Z".into(),
            public_error: None,
        },
        active_turn: Some(ActiveTurnProjection {
            turn_id: "t1".into(),
            turn_status: TurnStatus::Running,
            updated_at: "2026-08-07T00:00:01Z".into(),
        }),
        pending_permissions: pending,
        pending_elicitations: HashMap::new(),
        sessions: chats,
    }
}

pub(crate) fn registry_root() -> RegistryDocRoot {
    let mut instances = HashMap::new();
    instances.insert(
        "i1".into(),
        InstanceView {
            id: "i1".into(),
            hostname: "host1".into(),
            status: InstanceStatus::Online,
            token_id: "tok1".into(),
            registered_at: "2026-08-01T00:00:00Z".into(),
            last_heartbeat: "2026-08-07T00:00:01Z".into(),
            chat_count: 2,
            resource_protocol_version: Some(crate::resource::RESOURCE_PROTOCOL_VERSION),
            resource_write: true,
            resource_structural_mutations: true,
        },
    );
    let mut chats = HashMap::new();
    chats.insert(
        "s1".into(),
        ChatSummary {
            id: "s1".into(),
            instance_id: "i1".into(),
            title: "demo".into(),
            status: "active".into(),
            gap: None,
            updated_at: "2026-08-07T00:00:01Z".into(),
            cwd: "/".into(),
            workspace_id: None,
        },
    );
    let mut workspaces = HashMap::new();
    workspaces.insert(
        "ws1".into(),
        WorkspaceSummary {
            id: "ws1".into(),
            name: "demo-ws".into(),
            cwd: "/".into(),
            created_at: "2026-08-01T00:00:00Z".into(),
            updated_at: "2026-08-07T00:00:01Z".into(),
        },
    );
    RegistryDocRoot {
        schema_version: crate::version::REGISTRY_DOC_SCHEMA_VERSION,
        instances,
        chats,
        projects: HashMap::new(),
        machines: HashMap::new(),
        project_sessions: HashMap::new(),
        workspaces,
        global: RegistryGlobal {
            status: GlobalStatus::Healthy,
        },
    }
}
