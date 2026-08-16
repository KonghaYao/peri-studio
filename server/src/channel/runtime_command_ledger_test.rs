use std::sync::Arc;

use tempfile::tempdir;

use super::runtime_command_ledger::{
    RuntimeCommandClaim, RuntimeCommandIdentity, RuntimeCommandLedger, RuntimeCommandTerminal,
};
use crate::persist::metadata::MetadataStore;

fn identity(command_id: &str, fingerprint: &str) -> RuntimeCommandIdentity {
    RuntimeCommandIdentity {
        command_id: command_id.into(),
        command_type: "chat/config-set",
        chat_id: "chat-1".into(),
        payload_fingerprint: fingerprint.into(),
    }
}

#[tokio::test]
async fn runtime_command_has_one_executor_and_replays_committed_terminal() {
    let dir = tempdir().unwrap();
    let store = Arc::new(MetadataStore::open(dir.path()).await.unwrap());
    let ledger = RuntimeCommandLedger::default();
    ledger.install(store).await;
    let identity = identity("00000000-0000-4000-8000-000000000101", "one");
    ledger.reserve(&identity).await.unwrap();

    let first_ledger = ledger.clone();
    let first_identity = identity.clone();
    let first = tokio::spawn(async move {
        let RuntimeCommandClaim::Execute(mut permit) =
            first_ledger.claim(first_identity).await.unwrap()
        else {
            panic!("first claimant must execute");
        };
        permit.mark_dispatching().await.unwrap();
        tokio::task::yield_now().await;
        permit.commit().await.unwrap();
    });
    let second = tokio::spawn({
        let ledger = ledger.clone();
        async move { ledger.claim(identity).await.unwrap() }
    });

    first.await.unwrap();
    assert!(matches!(
        second.await.unwrap(),
        RuntimeCommandClaim::Terminal(RuntimeCommandTerminal::Committed)
    ));
}

#[tokio::test]
async fn abandoned_dispatching_runtime_command_is_never_executed_again() {
    let dir = tempdir().unwrap();
    let store = Arc::new(MetadataStore::open(dir.path()).await.unwrap());
    let ledger = RuntimeCommandLedger::default();
    ledger.install(store).await;
    let identity = identity("00000000-0000-4000-8000-000000000102", "one");
    ledger.reserve(&identity).await.unwrap();
    let RuntimeCommandClaim::Execute(mut permit) = ledger.claim(identity.clone()).await.unwrap()
    else {
        panic!("first claimant must execute");
    };
    permit.mark_dispatching().await.unwrap();
    drop(permit);

    assert!(matches!(
        ledger.claim(identity).await.unwrap(),
        RuntimeCommandClaim::Terminal(RuntimeCommandTerminal::DeliveryUnknown { .. })
    ));
}

#[tokio::test]
async fn confirmed_effect_requires_projection_commit_and_is_never_executed_again() {
    let dir = tempdir().unwrap();
    let store = Arc::new(MetadataStore::open(dir.path()).await.unwrap());
    let ledger = RuntimeCommandLedger::default();
    ledger.install(store).await;
    let identity = identity("00000000-0000-4000-8000-000000000105", "one");
    ledger.reserve(&identity).await.unwrap();
    let RuntimeCommandClaim::Execute(mut permit) = ledger.claim(identity.clone()).await.unwrap()
    else {
        panic!("first claimant must execute");
    };
    permit.mark_dispatching().await.unwrap();
    permit.mark_effect_confirmed().await.unwrap();
    drop(permit);

    assert!(matches!(
        ledger.claim(identity).await.unwrap(),
        RuntimeCommandClaim::Terminal(RuntimeCommandTerminal::DeliveryUnknown { .. })
    ));
}

#[tokio::test]
async fn confirmed_effect_commits_only_through_the_effect_barrier() {
    let dir = tempdir().unwrap();
    let store = Arc::new(MetadataStore::open(dir.path()).await.unwrap());
    let ledger = RuntimeCommandLedger::default();
    ledger.install(store).await;
    let identity = identity("00000000-0000-4000-8000-000000000106", "one");
    ledger.reserve(&identity).await.unwrap();
    let RuntimeCommandClaim::Execute(mut permit) = ledger.claim(identity.clone()).await.unwrap()
    else {
        panic!("first claimant must execute");
    };
    permit.mark_dispatching().await.unwrap();
    permit.mark_effect_confirmed().await.unwrap();
    permit.commit_after_effect().await.unwrap();

    assert!(matches!(
        ledger.claim(identity).await.unwrap(),
        RuntimeCommandClaim::Terminal(RuntimeCommandTerminal::Committed)
    ));
}

#[tokio::test]
async fn runtime_command_identity_conflict_fails_closed() {
    let dir = tempdir().unwrap();
    let store = Arc::new(MetadataStore::open(dir.path()).await.unwrap());
    let ledger = RuntimeCommandLedger::default();
    ledger.install(store).await;
    let first = identity("00000000-0000-4000-8000-000000000103", "one");
    ledger.reserve(&first).await.unwrap();
    let conflict = identity("00000000-0000-4000-8000-000000000103", "two");

    assert!(ledger.exists(&conflict).await.is_err());
    assert!(ledger.reserve(&conflict).await.is_err());
}

#[tokio::test]
async fn committed_runtime_command_survives_store_reopen() {
    let dir = tempdir().unwrap();
    let store = Arc::new(MetadataStore::open(dir.path()).await.unwrap());
    let ledger = RuntimeCommandLedger::default();
    ledger.install(store.clone()).await;
    let identity = identity("00000000-0000-4000-8000-000000000104", "one");
    ledger.reserve(&identity).await.unwrap();
    let RuntimeCommandClaim::Execute(mut permit) = ledger.claim(identity.clone()).await.unwrap()
    else {
        panic!("first claimant must execute");
    };
    permit.mark_dispatching().await.unwrap();
    permit.commit().await.unwrap();
    drop(ledger);
    drop(store);

    let reopened = Arc::new(MetadataStore::open(dir.path()).await.unwrap());
    reopened.recover_after_restart().await.unwrap();
    let restarted = RuntimeCommandLedger::default();
    restarted.install(reopened).await;
    assert!(matches!(
        restarted.claim(identity).await.unwrap(),
        RuntimeCommandClaim::Terminal(RuntimeCommandTerminal::Committed)
    ));
}
