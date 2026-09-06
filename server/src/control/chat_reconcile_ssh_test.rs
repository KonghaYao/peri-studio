//! SSH 空 registry 对账回归（ssh-machine-mount §5.5–5.6）。

use super::*;
use crate::state::doc_manager::DocManager;

async fn test_registry() -> (RegistryState, DocManager) {
    let sink = std::sync::Arc::new(crate::control::StoreSink::new());
    let doc = crate::state::doc_manager::DocManager::new(
        crate::state::doc_manager::BatchConfig::default(),
        sink,
    );
    (doc.registry(), doc)
}

#[tokio::test]
async fn ssh_empty_registry_registers_unknown_alive_without_kill() {
    let (reg, _doc) = test_registry().await;
    let reg = ChatRegistry::new(reg);
    let ssh_id = "ssh_01j8k2m3n4p5q6r7s8t9v0wxyz";

    let report = reg
        .reconcile_alive(ssh_id, &["chat-remote".to_string()])
        .await
        .unwrap();

    assert_eq!(report.alive, vec!["chat-remote".to_string()]);
    assert!(report.unexpected_alive.is_empty());
    assert!(report.to_kill.is_empty());
    let entry = reg.entry("chat-remote").await.unwrap();
    assert_eq!(entry.instance_id, ssh_id);
    assert!(entry.runtime_confirmed);
}

#[tokio::test]
async fn ssh_nonempty_registry_still_kills_unknown_alive() {
    let (reg, _doc) = test_registry().await;
    let reg = ChatRegistry::new(reg);
    let ssh_id = "ssh_01j8k2m3n4p5q6r7s8t9v0wxyz";
    reg.register("known", ssh_id, None, "/", None)
        .await
        .unwrap();

    let report = reg
        .reconcile_alive(ssh_id, &["orphan".to_string()])
        .await
        .unwrap();

    assert!(report.unexpected_alive.contains(&"orphan".to_string()));
    assert!(report.to_kill.contains(&"orphan".to_string()));
    assert!(reg.entry("orphan").await.is_none());
}

#[tokio::test]
async fn local_unknown_alive_still_kills() {
    let (reg, _doc) = test_registry().await;
    let reg = ChatRegistry::new(reg);

    let report = reg
        .reconcile_alive("local", &["orphan".to_string()])
        .await
        .unwrap();

    assert!(report.unexpected_alive.contains(&"orphan".to_string()));
    assert!(report.to_kill.contains(&"orphan".to_string()));
}
