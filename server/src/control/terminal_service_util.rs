//! TerminalService 辅助函数（保持主文件低于 500 行）。

use peri_studio_proto::frame::Frame;
use peri_studio_proto::terminal::{TerminalError, TerminalErrorCode};

use crate::channel::{ConnId, OutboundMsg};
use crate::control::InstanceError;

use super::{dec_count, TerminalOwner, TerminalService};

pub(super) fn terminal_error(
    request_id: Option<String>,
    terminal_id: Option<String>,
    code: TerminalErrorCode,
    message: impl Into<String>,
    retryable: bool,
) -> TerminalError {
    TerminalError {
        request_id,
        terminal_id,
        code,
        message: message.into(),
        retryable,
    }
}

pub(super) fn map_instance_error(
    request_id: &str,
    terminal_id: &str,
    err: InstanceError,
) -> TerminalError {
    let (code, retryable, message) = match err {
        InstanceError::TerminalUnsupported => (
            TerminalErrorCode::Unavailable,
            false,
            "instance does not support terminals".to_string(),
        ),
        InstanceError::Timeout => (
            TerminalErrorCode::DeliveryUnknown,
            false,
            "terminal open timed out".to_string(),
        ),
        InstanceError::Offline
        | InstanceError::ConnectionGone
        | InstanceError::UnknownInstance(_) => (
            TerminalErrorCode::Unavailable,
            true,
            "instance unavailable".to_string(),
        ),
        _ => (
            TerminalErrorCode::Unavailable,
            true,
            "terminal open failed".to_string(),
        ),
    };
    terminal_error(
        Some(request_id.to_string()),
        Some(terminal_id.to_string()),
        code,
        message,
        retryable,
    )
}

impl TerminalService {
    pub(super) async fn fail_active_terminal(
        &self,
        terminal_id: &str,
        owner: &TerminalOwner,
        message: &str,
        retryable: bool,
    ) {
        let removed = self.remove_terminal(terminal_id).await;
        if removed.is_none() {
            return;
        }
        let _ = self
            .instance
            .send_terminal_close(
                &owner.instance_id,
                &owner.instance_conn,
                terminal_id.to_string(),
            )
            .await;
        let _ = owner
            .client_tx
            .try_send(OutboundMsg::Frame(Frame::TerminalError(terminal_error(
                None,
                Some(terminal_id.to_string()),
                TerminalErrorCode::Unavailable,
                message,
                retryable,
            ))));
    }

    pub(super) async fn lookup_owner(
        &self,
        conn_id: ConnId,
        principal: &str,
        terminal_id: &str,
    ) -> Option<TerminalOwner> {
        let inner = self.inner.lock().await;
        let owner = inner.active.get(terminal_id)?;
        if owner.conn_id != conn_id || owner.principal != principal {
            return None;
        }
        Some(owner.clone())
    }

    pub(super) async fn remove_terminal(&self, terminal_id: &str) -> Option<TerminalOwner> {
        let mut inner = self.inner.lock().await;
        let owner = inner.active.remove(terminal_id)?;
        dec_count(&mut inner.principal_counts, &owner.principal);
        dec_count(&mut inner.instance_counts, &owner.instance_id);
        Some(owner)
    }
}
