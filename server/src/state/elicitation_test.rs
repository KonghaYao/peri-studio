use peri_studio_proto::action::ElicitationResponseAction;
use peri_studio_proto::schema::{
    ElicitationFieldKind, ElicitationFieldProjection, ElicitationProjection, ElicitationStatus,
};

use crate::state::elicitation::{
    begin_response, complete, context, expire_all_pending, register, ElicitationCasOutcome,
};
use crate::state::factory::Factory;

fn projection(id: &str) -> ElicitationProjection {
    ElicitationProjection {
        elicitation_id: id.to_string(),
        message: "Choose a path".to_string(),
        fields: vec![ElicitationFieldProjection {
            id: "path".to_string(),
            title: "Path".to_string(),
            description: None,
            kind: ElicitationFieldKind::Text,
            required: true,
            options: vec![],
        }],
        status: ElicitationStatus::Pending,
        response_action: None,
        created_at: "2026-08-15T00:00:00Z".to_string(),
        updated_at: "2026-08-15T00:00:00Z".to_string(),
    }
}

#[test]
fn response_action_is_single_assignment_and_completes() {
    let mut pair = Factory::new().create_chat_doc();
    assert!(register(&mut pair, &projection("e1")));
    assert!(!register(&mut pair, &projection("e1")));
    assert_eq!(
        begin_response(
            &mut pair,
            "e1",
            ElicitationResponseAction::Accept,
            "2026-08-15T00:00:01Z"
        ),
        ElicitationCasOutcome::Migrated
    );
    assert_eq!(
        begin_response(
            &mut pair,
            "e1",
            ElicitationResponseAction::Accept,
            "2026-08-15T00:00:02Z"
        ),
        ElicitationCasOutcome::ReplaySame
    );
    assert_eq!(
        begin_response(
            &mut pair,
            "e1",
            ElicitationResponseAction::Cancel,
            "2026-08-15T00:00:02Z"
        ),
        ElicitationCasOutcome::Conflict
    );
    assert!(complete(&mut pair, "e1", "2026-08-15T00:00:03Z"));
    assert_eq!(
        context(&pair, "e1"),
        Some((
            "resolved".to_string(),
            Some(ElicitationResponseAction::Accept)
        ))
    );
}

#[test]
fn disconnect_expiration_blocks_response() {
    let mut pair = Factory::new().create_chat_doc();
    assert!(register(&mut pair, &projection("e1")));
    assert_eq!(expire_all_pending(&mut pair, "2026-08-15T00:00:04Z"), 1);
    assert_eq!(
        begin_response(
            &mut pair,
            "e1",
            ElicitationResponseAction::Accept,
            "2026-08-15T00:00:05Z"
        ),
        ElicitationCasOutcome::Expired
    );
}
