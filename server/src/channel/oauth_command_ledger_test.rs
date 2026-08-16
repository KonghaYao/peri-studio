use std::sync::Arc;

use tempfile::tempdir;

use super::{OAuthClaim, OAuthCommandIdentity, OAuthCommandLedger, OAuthTerminal};
use crate::persist::metadata::MetadataStore;

fn identity(command_id: &str, fingerprint: &str) -> OAuthCommandIdentity {
    OAuthCommandIdentity {
        command_id: command_id.into(),
        command_type: "mcp/oauth-start",
        chat_id: "chat-1".into(),
        payload_fingerprint: fingerprint.into(),
    }
}

#[tokio::test]
async fn simultaneous_claimants_cross_the_barrier_once_and_replay_terminal() {
    let dir = tempdir().unwrap();
    let store = Arc::new(MetadataStore::open(dir.path()).await.unwrap());
    let ledger = OAuthCommandLedger::default();
    ledger.install(store).await;
    let identity = identity("00000000-0000-4000-8000-000000000001", "fingerprint");
    ledger.reserve(&identity).await.unwrap();

    let first_ledger = ledger.clone();
    let first_identity = identity.clone();
    let first = tokio::spawn(async move {
        let OAuthClaim::Execute(mut permit) = first_ledger.claim(first_identity).await.unwrap()
        else {
            panic!("first claimant must execute");
        };
        permit.mark_dispatching().await.unwrap();
        tokio::task::yield_now().await;
        permit.commit().await.unwrap();
    });

    let second_ledger = ledger.clone();
    let second = tokio::spawn(async move { second_ledger.claim(identity).await.unwrap() });
    first.await.unwrap();
    assert!(matches!(
        second.await.unwrap(),
        OAuthClaim::Terminal(OAuthTerminal::Committed)
    ));
}

#[tokio::test]
async fn a_dispatching_owner_that_disappears_becomes_delivery_unknown() {
    let dir = tempdir().unwrap();
    let store = Arc::new(MetadataStore::open(dir.path()).await.unwrap());
    let ledger = OAuthCommandLedger::default();
    ledger.install(store).await;
    let identity = identity("00000000-0000-4000-8000-000000000002", "fingerprint");
    ledger.reserve(&identity).await.unwrap();
    let OAuthClaim::Execute(mut permit) = ledger.claim(identity.clone()).await.unwrap() else {
        panic!("first claimant must execute");
    };
    permit.mark_dispatching().await.unwrap();
    drop(permit);

    assert!(matches!(
        ledger.claim(identity).await.unwrap(),
        OAuthClaim::Terminal(OAuthTerminal::DeliveryUnknown { .. })
    ));
}

#[tokio::test]
async fn command_identity_conflict_fails_closed() {
    let dir = tempdir().unwrap();
    let store = Arc::new(MetadataStore::open(dir.path()).await.unwrap());
    let ledger = OAuthCommandLedger::default();
    ledger.install(store).await;
    let first = identity("00000000-0000-4000-8000-000000000003", "one");
    ledger.reserve(&first).await.unwrap();
    let conflict = identity("00000000-0000-4000-8000-000000000003", "two");
    assert!(ledger.exists(&conflict).await.is_err());
    assert!(ledger.reserve(&conflict).await.is_err());
}

#[tokio::test]
async fn committed_ack_loss_replays_after_full_store_reopen_without_execution() {
    let dir = tempdir().unwrap();
    let store = Arc::new(MetadataStore::open(dir.path()).await.unwrap());
    let ledger = OAuthCommandLedger::default();
    ledger.install(store.clone()).await;
    let identity = identity("00000000-0000-4000-8000-000000000004", "fingerprint");
    ledger.reserve(&identity).await.unwrap();
    let OAuthClaim::Execute(mut permit) = ledger.claim(identity.clone()).await.unwrap() else {
        panic!("first claimant must execute");
    };
    permit.mark_dispatching().await.unwrap();
    permit.commit().await.unwrap();
    // Simulate a terminal Ack that never reached the browser, followed by a
    // complete Hub restart (all process-local gates are gone).
    drop(ledger);
    drop(store);

    let reopened = Arc::new(MetadataStore::open(dir.path()).await.unwrap());
    reopened.recover_after_restart().await.unwrap();
    let restarted = OAuthCommandLedger::default();
    restarted.install(reopened).await;
    assert!(restarted.exists(&identity).await.unwrap());
    restarted.reserve(&identity).await.unwrap();
    assert!(matches!(
        restarted.claim(identity).await.unwrap(),
        OAuthClaim::Terminal(OAuthTerminal::Committed)
    ));
}
