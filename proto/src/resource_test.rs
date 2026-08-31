use std::str::FromStr;

use crate::conn::DocId;
use crate::frame::Frame;
use crate::resource::{
    GitDiffQuery, InstanceResourcePayload, InstanceResourceQuery, InstanceResourceQueryKind,
    InstanceResourceResult, OpenResourceView, ReadDirectoryQuery, ResourceErrorCode,
    ResourceFailure, ResourceGitAction,
    ResourceGitActionKind, ResourceQuery, ResourceQueryResult, ResourceResult, ResourceViewKind,
    ResourceViewOpened, RESOURCE_PROTOCOL_VERSION,
};

#[test]
fn resource_doc_id_is_opaque_and_roundtrips() {
    let id = uuid::Uuid::new_v4().to_string();
    let doc = DocId::resource(&id);
    assert_eq!(doc.as_str(), format!("resource:{id}"));
    assert_eq!(DocId::from_str(doc.as_str()).unwrap(), doc);
    assert!(DocId::from_str("resource:../../secret").is_err());
}

#[test]
fn browser_open_view_has_no_trusted_root_or_instance_fields() {
    let frame = Frame::ResourceQuery(ResourceQuery::OpenView {
        request_id: "request-1".into(),
        project_id: "project-1".into(),
        payload: OpenResourceView {
            kind: ResourceViewKind::FsDirectoryPage,
            path: Some("src".into()),
            repo_id: None,
            group_id: None,
            cursor: None,
            expected_generation: None,
            limit: 200,
        },
    });
    let value = serde_json::to_value(&frame).unwrap();
    assert_eq!(value["t"], "resource_query");
    assert_eq!(value["type"], "resource/open-view");
    assert_eq!(value["projectId"], "project-1");
    assert_eq!(value["payload"]["path"], "src");
    assert!(value.get("root").is_none());
    assert!(value.get("instanceId").is_none());
    assert_eq!(
        Frame::parse(&serde_json::to_string(&frame).unwrap()).unwrap(),
        frame
    );
}

#[test]
fn trusted_instance_query_carries_root_separately() {
    let frame = Frame::InstanceResourceQuery(InstanceResourceQuery {
        request_id: "request-1".into(),
        workspace_id: "workspace-1".into(),
        root: "/srv/workspaces/demo".into(),
        query: InstanceResourceQueryKind::ReadDirectory(ReadDirectoryQuery {
            path: "src".into(),
            cursor: None,
            limit: 200,
        }),
    });
    let value = serde_json::to_value(&frame).unwrap();
    assert_eq!(value["t"], "instance/resource_query");
    assert_eq!(value["root"], "/srv/workspaces/demo");
    assert_eq!(value["query"]["type"], "read_directory");
    assert_eq!(
        Frame::parse(&serde_json::to_string(&frame).unwrap()).unwrap(),
        frame
    );
}

#[test]
fn git_diff_query_uses_only_opaque_change_identity() {
    assert_eq!(RESOURCE_PROTOCOL_VERSION, 4);
    let frame = Frame::InstanceResourceQuery(InstanceResourceQuery {
        request_id: "request-1".into(),
        workspace_id: "workspace-1".into(),
        root: "/srv/workspaces/demo".into(),
        query: InstanceResourceQueryKind::GitDiff(GitDiffQuery {
            repo_id: "repo-1".into(),
            change_id: "change-1".into(),
            max_bytes: 8 * 1024 * 1024,
        }),
    });
    let value = serde_json::to_value(&frame).unwrap();
    assert_eq!(value["query"]["type"], "git_diff");
    assert_eq!(value["query"]["payload"]["changeId"], "change-1");
    assert!(value["query"]["payload"].get("path").is_none());
}

#[test]
fn git_mutation_is_generation_bound_and_never_accepts_browser_paths() {
    assert_eq!(RESOURCE_PROTOCOL_VERSION, 4);
    let frame = Frame::ResourceQuery(ResourceQuery::GitAction {
        request_id: "request-1".into(),
        project_id: "project-1".into(),
        payload: ResourceGitAction {
            repo_id: "repo-1".into(),
            action: ResourceGitActionKind::Stage,
            change_ids: vec!["change-1".into()],
            expected_generation: "generation-1".into(),
            message: None,
            target_oid: None,
            ref_name: None,
            new_ref_name: None,
            reset_mode: None,
        },
    });
    let value = serde_json::to_value(&frame).unwrap();
    assert_eq!(value["payload"]["changeIds"][0], "change-1");
    assert_eq!(value["payload"]["expectedGeneration"], "generation-1");
    assert!(value["payload"].get("paths").is_none());
}

#[test]
fn repository_git_action_carries_only_a_bounded_command_payload() {
    let frame = Frame::ResourceQuery(ResourceQuery::GitAction {
        request_id: "request-commit".into(),
        project_id: "project-1".into(),
        payload: ResourceGitAction {
            repo_id: "repo-1".into(),
            action: ResourceGitActionKind::Commit,
            change_ids: vec![],
            expected_generation: "generation-1".into(),
            message: Some("Ship SCM".into()),
            target_oid: None,
            ref_name: None,
            new_ref_name: None,
            reset_mode: None,
        },
    });
    let value = serde_json::to_value(frame).unwrap();
    assert_eq!(value["payload"]["action"], "commit");
    assert_eq!(value["payload"]["message"], "Ship SCM");
    assert_eq!(value["payload"]["changeIds"], serde_json::json!([]));
    assert!(value["payload"].get("argv").is_none());
}

#[test]
fn git_log_query_roundtrips_on_instance_wire() {
    use crate::frame::Frame;
    use crate::resource::{
        GitLogCommit, GitLogPage, GitLogQuery, GitRefKind, GitRefLabel, InstanceResourcePayload,
        InstanceResourceQuery, InstanceResourceQueryKind, InstanceResourceResult, OpenResourceView,
        ResourceViewKind, DEFAULT_GIT_LOG_PAGE_SIZE,
    };

    assert_eq!(DEFAULT_GIT_LOG_PAGE_SIZE, 50);

    let frame = Frame::InstanceResourceQuery(InstanceResourceQuery {
        request_id: "request-1".into(),
        workspace_id: "workspace-1".into(),
        root: "/srv/workspaces/demo".into(),
        query: InstanceResourceQueryKind::GitLog(GitLogQuery {
            repo_id: "repo-1".into(),
            expected_generation: "generation-1".into(),
            cursor: Some("generation-1.50".into()),
            limit: 50,
        }),
    });
    let value = serde_json::to_value(&frame).unwrap();
    assert_eq!(value["query"]["type"], "git_log");
    assert_eq!(value["query"]["payload"]["expectedGeneration"], "generation-1");
    assert_eq!(
        Frame::parse(&serde_json::to_string(&frame).unwrap()).unwrap(),
        frame
    );

    let open = Frame::ResourceQuery(crate::resource::ResourceQuery::OpenView {
        request_id: "request-1".into(),
        project_id: "project-1".into(),
        payload: OpenResourceView {
            kind: ResourceViewKind::GitLogPage,
            path: None,
            repo_id: Some("repo-1".into()),
            group_id: None,
            cursor: None,
            expected_generation: Some("gen-1".into()),
            limit: 50,
        },
    });
    let open_value = serde_json::to_value(&open).unwrap();
    assert_eq!(open_value["payload"]["kind"], "git-log-page");

    let result = Frame::InstanceResourceResult(InstanceResourceResult {
        request_id: "request-1".into(),
        result: Some(InstanceResourcePayload::GitLogPage(GitLogPage {
            repo_id: "repo-1".into(),
            source_generation: "generation-1".into(),
            commits: vec![GitLogCommit {
                commit_id: "a".repeat(40),
                oid: "a".repeat(40),
                short_oid: "aaaaaaaa".into(),
                message: "Ship graph".into(),
                message_truncated: None,
                author_name: "Peri".into(),
                author_date: "2026-08-31T00:00:00+00:00".into(),
                parents: vec!["b".repeat(40)],
                parents_complete: true,
                refs: vec![GitRefLabel {
                    name: "main".into(),
                    kind: GitRefKind::Branch,
                }],
                refs_complete: true,
            }],
            next_cursor: Some("generation-1.1".into()),
            head_oid: "a".repeat(40),
            scope: Some(crate::resource::GitLogScope::Full),
        })),
        error: None,
    });
    assert_eq!(
        Frame::parse(&serde_json::to_string(&result).unwrap()).unwrap(),
        result
    );
}

#[test]
fn resource_results_roundtrip_for_web_and_instance() {
    let view = Frame::ResourceResult(ResourceResult {
        request_id: "request-1".into(),
        result: Some(ResourceQueryResult::View(ResourceViewOpened {
            view_id: "view-1".into(),
            doc_id: DocId::resource("view-1"),
            lease_expires_at: "2026-08-23T12:00:00Z".into(),
        })),
        error: None,
    });
    assert_eq!(
        Frame::parse(&serde_json::to_string(&view).unwrap()).unwrap(),
        view
    );

    let result = Frame::InstanceResourceResult(InstanceResourceResult {
        request_id: "request-1".into(),
        result: Some(InstanceResourcePayload::DirectoryPage(
            crate::resource::DirectoryPage {
                path: "src".into(),
                source_generation: "generation-1".into(),
                entries: vec![],
                next_cursor: None,
            },
        )),
        error: None,
    });
    assert_eq!(
        Frame::parse(&serde_json::to_string(&result).unwrap()).unwrap(),
        result
    );
}

#[test]
fn resource_failure_roundtrips_suggested_limit() {
    let failure = ResourceFailure {
        code: ResourceErrorCode::ViewTooLarge,
        message: "page too large".into(),
        retryable: false,
        suggested_limit: Some(25),
    };
    let value = serde_json::to_value(&failure).unwrap();
    assert_eq!(value["suggestedLimit"], 25);
    let parsed: ResourceFailure = serde_json::from_value(value).unwrap();
    assert_eq!(parsed.suggested_limit, Some(25));
}
