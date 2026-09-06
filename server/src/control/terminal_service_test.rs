use std::sync::Arc;

use peri_studio_proto::instance::InstanceHello;
use peri_studio_proto::terminal::{
    InstanceTerminalOpened, TerminalErrorCode, TerminalOpen, TERMINAL_PROTOCOL_VERSION,
};
use peri_studio_proto::Frame;
use serde_json::json;
use tokio::sync::mpsc;

use crate::channel::OutboundMsg;
use crate::control::{InstanceConn, InstanceRegistry, TerminalService};
use crate::persist::metadata::MetadataStore;

fn terminal_hello(hostname: &str) -> InstanceHello {
    InstanceHello {
        protocol_version: peri_studio_proto::version::PROTOCOL_VERSION,
        token: "token".into(),
        hostname: hostname.into(),
        caps: json!({ "terminals": { "protocolVersion": TERMINAL_PROTOCOL_VERSION } }),
        buffered: None,
        buffer_lost: None,
        stream_epochs: None,
        nonce: "nonce".into(),
    }
}

#[tokio::test]
async fn read_only_open_gets_forbidden_without_metadata_lookup() {
    let dir = tempfile::tempdir().unwrap();
    let metadata = Arc::new(MetadataStore::open(dir.path()).await.unwrap());
    let (tx, _rx) = tokio::sync::mpsc::channel(1);
    let registry = crate::state::registry::RegistryState::new(tx);
    let instance = Arc::new(InstanceRegistry::new(
        std::time::Duration::from_secs(30),
        std::time::Duration::from_secs(10),
        crate::control::ChatRegistry::new(registry),
    ));
    let service = TerminalService::new(metadata, instance, std::time::Duration::from_secs(10));
    let (client_tx, mut client_rx) = mpsc::channel(4);
    service
        .handle_client_frame(
            1,
            "principal-a",
            false,
            Frame::TerminalOpen(TerminalOpen {
                request_id: "req-1".into(),
                project_id: "p1".into(),
                cols: 80,
                rows: 24,
            }),
            client_tx,
        )
        .await;
    let Some(OutboundMsg::Frame(Frame::TerminalError(err))) = client_rx.recv().await else {
        panic!("expected terminal_error");
    };
    assert_eq!(err.code, TerminalErrorCode::Forbidden);
}

#[tokio::test]
async fn metadata_routes_trusted_cwd_not_browser_payload() {
    let dir = tempfile::tempdir().unwrap();
    let metadata = Arc::new(MetadataStore::open(dir.path()).await.unwrap());
    let project = metadata
        .create_project("p1", "demo", "/trusted/path", "inst-1")
        .await
        .unwrap();
    let (tx, _rx) = tokio::sync::mpsc::channel(1);
    let registry = crate::state::registry::RegistryState::new(tx);
    let instance = Arc::new(InstanceRegistry::new(
        std::time::Duration::from_secs(30),
        std::time::Duration::from_millis(50),
        crate::control::ChatRegistry::new(registry),
    ));
    let (instance_tx, mut instance_rx) = tokio::sync::mpsc::channel(4);
    instance
        .on_hello(
            "inst-1",
            "token-1",
            InstanceConn { tx: instance_tx },
            &terminal_hello("instance"),
        )
        .await;
    let service = TerminalService::new(
        metadata,
        instance.clone(),
        std::time::Duration::from_secs(10),
    );
    let (client_tx, _client_rx) = mpsc::channel(4);
    service
        .handle_client_frame(
            9,
            "principal-b",
            true,
            Frame::TerminalOpen(TerminalOpen {
                request_id: "req-2".into(),
                project_id: project.id,
                cols: 80,
                rows: 24,
            }),
            client_tx,
        )
        .await;
    let Some(OutboundMsg::Frame(Frame::InstanceTerminalOpen(open))) = instance_rx.recv().await
    else {
        panic!("expected instance/terminal_open");
    };
    assert_eq!(open.cwd, "/trusted/path");
    assert_eq!(open.cols, 80);
    assert_eq!(open.rows, 24);
}

#[tokio::test]
async fn pending_open_timeout_closes_instance_terminal_and_releases_request() {
    let dir = tempfile::tempdir().unwrap();
    let metadata = Arc::new(MetadataStore::open(dir.path()).await.unwrap());
    let project = metadata
        .create_project("p-timeout", "demo", "/trusted/path", "inst-timeout")
        .await
        .unwrap();
    let (tx, _rx) = tokio::sync::mpsc::channel(1);
    let registry = crate::state::registry::RegistryState::new(tx);
    let instance = Arc::new(InstanceRegistry::new(
        std::time::Duration::from_secs(30),
        std::time::Duration::from_secs(10),
        crate::control::ChatRegistry::new(registry),
    ));
    let (instance_tx, mut instance_rx) = mpsc::channel(4);
    instance
        .on_hello(
            "inst-timeout",
            "token-1",
            InstanceConn { tx: instance_tx },
            &terminal_hello("instance"),
        )
        .await;
    let service = TerminalService::new(metadata, instance, std::time::Duration::ZERO);
    let (client_tx, mut client_rx) = mpsc::channel(4);
    service
        .handle_client_frame(
            1,
            "principal",
            true,
            Frame::TerminalOpen(TerminalOpen {
                request_id: "req-timeout".into(),
                project_id: project.id,
                cols: 80,
                rows: 24,
            }),
            client_tx,
        )
        .await;
    let Some(OutboundMsg::Frame(Frame::InstanceTerminalOpen(open))) = instance_rx.recv().await
    else {
        panic!("expected instance/terminal_open");
    };

    service
        .sweep_expired_pending(std::time::Instant::now())
        .await;

    let Some(OutboundMsg::Frame(Frame::InstanceTerminalClose(close))) = instance_rx.recv().await
    else {
        panic!("expected instance/terminal_close");
    };
    assert_eq!(close.terminal_id, open.terminal_id);
    let Some(OutboundMsg::Frame(Frame::TerminalError(error))) = client_rx.recv().await else {
        panic!("expected terminal_error");
    };
    assert_eq!(error.request_id.as_deref(), Some("req-timeout"));
    assert_eq!(error.code, TerminalErrorCode::DeliveryUnknown);
}

#[tokio::test]
async fn opened_from_wrong_instance_does_not_consume_pending_open() {
    let dir = tempfile::tempdir().unwrap();
    let metadata = Arc::new(MetadataStore::open(dir.path()).await.unwrap());
    let project = metadata
        .create_project("p-owner", "demo", "/trusted/path", "inst-owner")
        .await
        .unwrap();
    let (tx, _rx) = tokio::sync::mpsc::channel(1);
    let registry = crate::state::registry::RegistryState::new(tx);
    let instance = Arc::new(InstanceRegistry::new(
        std::time::Duration::from_secs(30),
        std::time::Duration::from_secs(10),
        crate::control::ChatRegistry::new(registry),
    ));
    let (owner_tx, mut owner_rx) = mpsc::channel(4);
    let owner_conn = InstanceConn {
        tx: owner_tx.clone(),
    };
    instance
        .on_hello(
            "inst-owner",
            "token-owner",
            owner_conn.clone(),
            &terminal_hello("owner"),
        )
        .await;
    let (other_tx, mut other_rx) = mpsc::channel(4);
    let other_conn = InstanceConn {
        tx: other_tx.clone(),
    };
    instance
        .on_hello(
            "inst-other",
            "token-other",
            other_conn.clone(),
            &terminal_hello("other"),
        )
        .await;
    let service = TerminalService::new(metadata, instance, std::time::Duration::from_secs(10));
    let (client_tx, mut client_rx) = mpsc::channel(4);
    service
        .handle_client_frame(
            7,
            "principal",
            true,
            Frame::TerminalOpen(TerminalOpen {
                request_id: "req-owner".into(),
                project_id: project.id,
                cols: 80,
                rows: 24,
            }),
            client_tx,
        )
        .await;
    let Some(OutboundMsg::Frame(Frame::InstanceTerminalOpen(open))) = owner_rx.recv().await else {
        panic!("expected instance/terminal_open");
    };
    let opened = InstanceTerminalOpened {
        request_id: open.request_id.clone(),
        terminal_id: open.terminal_id.clone(),
        ok: true,
        cwd: Some(open.cwd.clone()),
        cols: Some(open.cols),
        rows: Some(open.rows),
        error: None,
    };

    service
        .on_instance_opened("inst-other", &other_conn, opened.clone())
        .await;
    let Some(OutboundMsg::Frame(Frame::InstanceTerminalClose(close))) = other_rx.recv().await
    else {
        panic!("expected forged terminal to be closed");
    };
    assert_eq!(close.terminal_id, open.terminal_id);

    service
        .on_instance_opened("inst-owner", &owner_conn, opened)
        .await;
    let Some(OutboundMsg::Frame(Frame::TerminalOpened(client_opened))) = client_rx.recv().await
    else {
        panic!("expected terminal_opened");
    };
    assert_eq!(client_opened.terminal_id, open.terminal_id);
}

#[tokio::test]
async fn shutdown_drains_active_and_pending_terminals_once() {
    let dir = tempfile::tempdir().unwrap();
    let metadata = Arc::new(MetadataStore::open(dir.path()).await.unwrap());
    let project = metadata
        .create_project("p-shutdown", "demo", "/trusted/path", "inst-shutdown")
        .await
        .unwrap();
    let (tx, _rx) = mpsc::channel(1);
    let registry = crate::state::registry::RegistryState::new(tx);
    let instance = Arc::new(InstanceRegistry::new(
        std::time::Duration::from_secs(30),
        std::time::Duration::from_secs(10),
        crate::control::ChatRegistry::new(registry),
    ));
    let (instance_tx, mut instance_rx) = mpsc::channel(8);
    let instance_conn = InstanceConn {
        tx: instance_tx.clone(),
    };
    instance
        .on_hello(
            "inst-shutdown",
            "token-shutdown",
            instance_conn.clone(),
            &terminal_hello("instance"),
        )
        .await;
    let service = TerminalService::new(metadata, instance, std::time::Duration::from_secs(10));
    let (client_tx, mut client_rx) = mpsc::channel(8);

    service
        .handle_client_frame(
            10,
            "principal",
            true,
            Frame::TerminalOpen(TerminalOpen {
                request_id: "req-active".into(),
                project_id: project.id.clone(),
                cols: 80,
                rows: 24,
            }),
            client_tx.clone(),
        )
        .await;
    let Some(OutboundMsg::Frame(Frame::InstanceTerminalOpen(active_open))) =
        instance_rx.recv().await
    else {
        panic!("expected active instance/terminal_open");
    };
    service
        .on_instance_opened(
            "inst-shutdown",
            &instance_conn,
            InstanceTerminalOpened {
                request_id: active_open.request_id,
                terminal_id: active_open.terminal_id.clone(),
                ok: true,
                cwd: Some(active_open.cwd),
                cols: Some(active_open.cols),
                rows: Some(active_open.rows),
                error: None,
            },
        )
        .await;
    assert!(matches!(
        client_rx.recv().await,
        Some(OutboundMsg::Frame(Frame::TerminalOpened(_)))
    ));

    service
        .handle_client_frame(
            10,
            "principal",
            true,
            Frame::TerminalOpen(TerminalOpen {
                request_id: "req-pending".into(),
                project_id: project.id.clone(),
                cols: 100,
                rows: 30,
            }),
            client_tx.clone(),
        )
        .await;
    let Some(OutboundMsg::Frame(Frame::InstanceTerminalOpen(pending_open))) =
        instance_rx.recv().await
    else {
        panic!("expected pending instance/terminal_open");
    };

    service.shutdown().await;

    let mut closed = std::collections::HashSet::new();
    for _ in 0..2 {
        let Some(OutboundMsg::Frame(Frame::InstanceTerminalClose(close))) =
            instance_rx.recv().await
        else {
            panic!("expected instance/terminal_close");
        };
        assert!(closed.insert(close.terminal_id));
    }
    assert_eq!(
        closed,
        std::collections::HashSet::from([
            active_open.terminal_id.clone(),
            pending_open.terminal_id.clone(),
        ])
    );
    assert!(instance_rx.try_recv().is_err());

    service.shutdown().await;
    assert!(instance_rx.try_recv().is_err());

    let inner = service.inner.lock().await;
    assert!(inner.shutting_down);
    assert!(inner.active.is_empty());
    assert!(inner.pending.is_empty());
    assert!(inner.principal_counts.is_empty());
    assert!(inner.instance_counts.is_empty());
    assert!(inner.completed_requests.is_empty());
    assert!(inner.completed_request_order.is_empty());
    drop(inner);

    assert!(matches!(
        client_rx.recv().await,
        Some(OutboundMsg::Frame(Frame::TerminalExit(_)))
    ));
    assert!(matches!(
        client_rx.recv().await,
        Some(OutboundMsg::Frame(Frame::TerminalError(_)))
    ));

    service
        .handle_client_frame(
            10,
            "principal",
            true,
            Frame::TerminalOpen(TerminalOpen {
                request_id: "req-after-shutdown".into(),
                project_id: project.id,
                cols: 80,
                rows: 24,
            }),
            client_tx,
        )
        .await;
    let Some(OutboundMsg::Frame(Frame::TerminalError(error))) = client_rx.recv().await else {
        panic!("expected terminal_error");
    };
    assert_eq!(error.code, TerminalErrorCode::Unavailable);
    assert!(instance_rx.try_recv().is_err());
}
