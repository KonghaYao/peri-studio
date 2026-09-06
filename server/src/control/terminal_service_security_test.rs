use std::sync::Arc;
use std::time::Duration;

use peri_studio_proto::instance::InstanceHello;
use peri_studio_proto::terminal::{
    encode_terminal_chunk, InstanceTerminalExit, InstanceTerminalOpened, InstanceTerminalOutput,
    TerminalClose, TerminalErrorCode, TerminalOpen, TERMINAL_PROTOCOL_VERSION,
};
use peri_studio_proto::Frame;
use serde_json::json;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

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

async fn terminal_service(
    metadata: Arc<MetadataStore>,
) -> (TerminalService, Arc<InstanceRegistry>) {
    let (tx, _rx) = mpsc::channel(1);
    let registry = crate::state::registry::RegistryState::new(tx);
    let instance = Arc::new(InstanceRegistry::new(
        Duration::from_secs(30),
        Duration::from_secs(10),
        crate::control::ChatRegistry::new(registry),
    ));
    (
        TerminalService::new(metadata, instance.clone(), Duration::from_secs(10)),
        instance,
    )
}

#[tokio::test]
async fn invalid_open_request_id_is_not_reflected() {
    let dir = tempfile::tempdir().unwrap();
    let metadata = Arc::new(MetadataStore::open(dir.path()).await.unwrap());
    let (service, _instance) = terminal_service(metadata).await;
    let (client_tx, mut client_rx) = mpsc::channel(1);

    service
        .handle_client_frame(
            1,
            "principal",
            false,
            Frame::TerminalOpen(TerminalOpen {
                request_id: "r".repeat(129),
                project_id: "project".into(),
                cols: 80,
                rows: 24,
            }),
            client_tx,
        )
        .await;

    let Some(OutboundMsg::Frame(Frame::TerminalError(error))) = client_rx.recv().await else {
        panic!("expected terminal_error");
    };
    assert_eq!(error.code, TerminalErrorCode::Forbidden);
    assert_eq!(error.request_id, None);
}

#[tokio::test]
async fn invalid_close_ids_are_all_validated_and_not_reflected() {
    let dir = tempfile::tempdir().unwrap();
    let metadata = Arc::new(MetadataStore::open(dir.path()).await.unwrap());
    let (service, _instance) = terminal_service(metadata).await;

    for close in [
        TerminalClose {
            request_id: Some("r".repeat(129)),
            terminal_id: Some("terminal-valid".into()),
        },
        TerminalClose {
            request_id: Some("request-valid".into()),
            terminal_id: Some("t".repeat(129)),
        },
    ] {
        let (client_tx, mut client_rx) = mpsc::channel(1);
        service
            .handle_client_frame(1, "principal", true, Frame::TerminalClose(close), client_tx)
            .await;
        let Some(OutboundMsg::Frame(Frame::TerminalError(error))) = client_rx.recv().await else {
            panic!("expected terminal_error");
        };
        assert_eq!(error.code, TerminalErrorCode::InvalidRequest);
        assert_eq!(error.request_id, None);
        assert_eq!(error.terminal_id, None);
    }
}

#[tokio::test]
async fn fenced_connection_terminal_callbacks_cannot_touch_current_terminal() {
    let dir = tempfile::tempdir().unwrap();
    let metadata = Arc::new(MetadataStore::open(dir.path()).await.unwrap());
    let project = metadata
        .create_project("p-fenced", "demo", "/trusted/path", "inst-fenced")
        .await
        .unwrap();
    let (service, _instance) = terminal_service(metadata).await;

    let (old_tx, _old_rx) = mpsc::channel(4);
    let old_conn = InstanceConn { tx: old_tx };
    service
        .on_instance_connection_hello(
            "inst-fenced",
            "token-old",
            old_conn.clone(),
            &terminal_hello("old"),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    let (new_tx, mut new_rx) = mpsc::channel(4);
    let new_conn = InstanceConn { tx: new_tx };
    service
        .on_instance_connection_hello(
            "inst-fenced",
            "token-new",
            new_conn.clone(),
            &terminal_hello("new"),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    let (client_tx, mut client_rx) = mpsc::channel(8);
    service
        .handle_client_frame(
            7,
            "principal",
            true,
            Frame::TerminalOpen(TerminalOpen {
                request_id: "request-fenced".into(),
                project_id: project.id,
                cols: 80,
                rows: 24,
            }),
            client_tx,
        )
        .await;
    let Some(OutboundMsg::Frame(Frame::InstanceTerminalOpen(open))) = new_rx.recv().await else {
        panic!("expected instance/terminal_open");
    };
    let opened = InstanceTerminalOpened {
        request_id: open.request_id.clone(),
        terminal_id: open.terminal_id.clone(),
        ok: true,
        cwd: Some(open.cwd),
        cols: Some(open.cols),
        rows: Some(open.rows),
        error: None,
    };

    service
        .on_instance_opened("inst-fenced", &old_conn, opened.clone())
        .await;
    assert!(
        tokio::time::timeout(Duration::from_millis(20), client_rx.recv())
            .await
            .is_err()
    );
    assert!(service
        .inner
        .lock()
        .await
        .pending
        .contains_key(&open.request_id));

    service
        .on_instance_opened("inst-fenced", &new_conn, opened)
        .await;
    assert!(matches!(
        client_rx.recv().await,
        Some(OutboundMsg::Frame(Frame::TerminalOpened(_)))
    ));

    let output = InstanceTerminalOutput {
        terminal_id: open.terminal_id.clone(),
        seq: 1,
        data: encode_terminal_chunk(b"current"),
    };
    service
        .on_instance_output("inst-fenced", &old_conn, output.clone())
        .await;
    assert!(
        tokio::time::timeout(Duration::from_millis(20), client_rx.recv())
            .await
            .is_err()
    );
    service
        .on_instance_output("inst-fenced", &new_conn, output)
        .await;
    let Some(OutboundMsg::Frame(Frame::TerminalOutput(output))) = client_rx.recv().await else {
        panic!("expected terminal_output");
    };
    assert_eq!(output.seq, 1);

    let exit = InstanceTerminalExit {
        terminal_id: open.terminal_id.clone(),
        exit_code: Some(0),
        signal: None,
    };
    service
        .on_instance_exit("inst-fenced", &old_conn, exit.clone())
        .await;
    assert!(service
        .inner
        .lock()
        .await
        .active
        .contains_key(&open.terminal_id));
    service
        .on_instance_exit("inst-fenced", &new_conn, exit)
        .await;
    assert!(matches!(
        client_rx.recv().await,
        Some(OutboundMsg::Frame(Frame::TerminalExit(_)))
    ));
    assert!(!service
        .inner
        .lock()
        .await
        .active
        .contains_key(&open.terminal_id));
}

#[tokio::test]
async fn close_with_two_ids_requires_the_same_route() {
    let dir = tempfile::tempdir().unwrap();
    let metadata = Arc::new(MetadataStore::open(dir.path()).await.unwrap());
    let project = metadata
        .create_project("p-close", "demo", "/trusted/path", "inst-close")
        .await
        .unwrap();
    let (service, instance) = terminal_service(metadata).await;
    let (instance_tx, mut instance_rx) = mpsc::channel(4);
    let instance_conn = InstanceConn {
        tx: instance_tx.clone(),
    };
    instance
        .on_hello(
            "inst-close",
            "token-close",
            instance_conn.clone(),
            &terminal_hello("instance"),
        )
        .await;
    let (client_tx, mut client_rx) = mpsc::channel(4);
    service
        .handle_client_frame(
            8,
            "principal",
            true,
            Frame::TerminalOpen(TerminalOpen {
                request_id: "req-close".into(),
                project_id: project.id,
                cols: 80,
                rows: 24,
            }),
            client_tx.clone(),
        )
        .await;
    let Some(OutboundMsg::Frame(Frame::InstanceTerminalOpen(open))) = instance_rx.recv().await
    else {
        panic!("expected instance/terminal_open");
    };
    service
        .on_instance_opened(
            "inst-close",
            &instance_conn,
            InstanceTerminalOpened {
                request_id: open.request_id,
                terminal_id: open.terminal_id.clone(),
                ok: true,
                cwd: Some(open.cwd),
                cols: Some(open.cols),
                rows: Some(open.rows),
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
            8,
            "principal",
            true,
            Frame::TerminalClose(TerminalClose {
                request_id: Some("req-close".into()),
                terminal_id: Some("different-terminal".into()),
            }),
            client_tx.clone(),
        )
        .await;
    assert!(instance_rx.try_recv().is_err());
    assert!(service
        .inner
        .lock()
        .await
        .active
        .contains_key(&open.terminal_id));

    service
        .handle_client_frame(
            8,
            "principal",
            true,
            Frame::TerminalClose(TerminalClose {
                request_id: Some("req-close".into()),
                terminal_id: Some(open.terminal_id.clone()),
            }),
            client_tx,
        )
        .await;
    let Some(OutboundMsg::Frame(Frame::InstanceTerminalClose(close))) = instance_rx.recv().await
    else {
        panic!("expected instance/terminal_close");
    };
    assert_eq!(close.terminal_id, open.terminal_id);
    assert!(!service
        .inner
        .lock()
        .await
        .active
        .contains_key(&open.terminal_id));
}
