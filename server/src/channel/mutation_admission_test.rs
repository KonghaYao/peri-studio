use peri_studio_proto::frame::Frame;
use peri_studio_proto::resource::{
    OpenResourceView, ResourceErrorCode, ResourceGitAction, ResourceGitActionKind, ResourceQuery,
    ResourceViewKind,
};

use super::mutation_admission::{Commitment, MutationAdmission};

#[test]
fn git_mutation_requires_a_healthy_server_but_resource_reads_do_not() {
    let mutation = Frame::ResourceQuery(ResourceQuery::GitAction {
        request_id: "mutate-1".into(),
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
    let read = Frame::ResourceQuery(ResourceQuery::OpenView {
        request_id: "read-1".into(),
        project_id: "project-1".into(),
        payload: OpenResourceView {
            kind: ResourceViewKind::WorkspaceSummary,
            path: None,
            repo_id: None,
            group_id: None,
            cursor: None,
            expected_generation: None,
            limit: 100,
        },
    });

    assert_eq!(
        MutationAdmission::classify(&mutation),
        Commitment::Committed
    );
    assert_eq!(MutationAdmission::classify(&read), Commitment::ReadOnly);
}

#[test]
fn action_queries_share_the_same_commitment_classifier() {
    let read = Frame::parse(
        r#"{"t":"action","commandId":"q1","type":"chat/rewind-candidates","payload":{"chatId":"chat-1"}}"#,
    )
    .expect("read-only action");
    let mutation = Frame::parse(
        r#"{"t":"action","commandId":"p1","type":"chat/prompt","payload":{"chatId":"chat-1","message":"hello"}}"#,
    )
    .expect("committed action");

    assert_eq!(MutationAdmission::classify(&read), Commitment::ReadOnly);
    assert_eq!(
        MutationAdmission::classify(&mutation),
        Commitment::Committed
    );
}

#[test]
fn rejected_git_mutation_preserves_request_correlation_and_retry_semantics() {
    let mutation = Frame::ResourceQuery(ResourceQuery::GitAction {
        request_id: "mutate-42".into(),
        project_id: "project-1".into(),
        payload: ResourceGitAction {
            repo_id: "repo-1".into(),
            action: ResourceGitActionKind::Unstage,
            change_ids: vec!["change-1".into()],
            expected_generation: "generation-1".into(),
            message: None,
            target_oid: None,
            ref_name: None,
            new_ref_name: None,
            reset_mode: None,
        },
    });

    let Some(Frame::ResourceResult(result)) = MutationAdmission::rejection(&mutation, false) else {
        panic!("degraded server must reject Git mutation");
    };
    assert_eq!(result.request_id, "mutate-42");
    let error = result.error.expect("typed failure");
    assert_eq!(error.code, ResourceErrorCode::Unavailable);
    assert!(error.retryable);
    assert!(MutationAdmission::rejection(&mutation, true).is_none());
}
