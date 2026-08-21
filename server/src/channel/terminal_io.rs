//! CommandCoordinator 的终态输出面（review #3 结构拆分）：`send_error`/
//! `send_committed` 经 outcome_broker 发布终态（断链观察者/重连重放/进程内
//! fallback），供直通面与队列面各 exec 方法共用；`MetadataRuntimePort` 与
//! `RuntimeCreationTerminalPort` 两个外部 trait 的适配实现也收敛于此
//! （都只做 submit/send_error/send_committed 转发）。

use tokio::sync::mpsc;

use peri_studio_proto::action::ActionEnvelope;

use crate::auth::audit::audit;
use crate::auth::ConnectionCtx;
use crate::channel::broadcaster::OutboundMsg;
use crate::channel::command_coordinator::{ExecCmd, SubmitAck};
use crate::channel::command_outcome_broker::{TerminalOutcome, TerminalPublication};
use crate::channel::coordinator_helpers::{action_error, chat_uuid, extract_command_id};
use crate::channel::metadata_command_processor::MetadataRuntimePort;
use crate::channel::runtime_creation::{CreateTerminal, RuntimeCreationTerminalPort};

impl crate::channel::command_coordinator::CommandCoordinator {
    pub(super) async fn send_error(
        &self,
        cmd: &ExecCmd,
        code: peri_studio_proto::ack::ErrorCode,
        message: &str,
        retryable: bool,
    ) {
        let command_id = extract_command_id(&cmd.action).unwrap_or_default();
        audit(
            "command.error",
            Some(&command_id),
            Some(&cmd.ctx.token_id),
            "error",
            std::time::Duration::ZERO,
            None,
        );
        let error = action_error(command_id.clone(), code, message, retryable);
        self.inner
            .outcome_broker
            .publish_terminal(TerminalPublication {
                command_id_text: &command_id,
                chat_id: chat_uuid(&cmd.chat_id),
                original: &cmd.tx,
                outcome: TerminalOutcome::Error(error),
            })
            .await;
    }

    pub(super) async fn send_committed(
        &self,
        cmd: &ExecCmd,
        turn_id: Option<&str>,
        chat_id: Option<&str>,
    ) {
        let command_id = extract_command_id(&cmd.action).unwrap_or_default();
        self.inner
            .outcome_broker
            .publish_terminal(TerminalPublication {
                command_id_text: &command_id,
                chat_id: chat_uuid(&cmd.chat_id),
                original: &cmd.tx,
                outcome: TerminalOutcome::Committed {
                    turn_id: turn_id.map(str::to_string),
                    chat_id: chat_id.map(str::to_string),
                },
            })
            .await;
    }
}

impl MetadataRuntimePort for crate::channel::command_coordinator::CommandCoordinator {
    fn submit_runtime<'a>(
        &'a self,
        ctx: &'a ConnectionCtx,
        action: ActionEnvelope,
        tx: mpsc::Sender<OutboundMsg>,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = SubmitAck> + Send + 'a>> {
        Box::pin(self.submit(ctx, action, tx))
    }
}

#[async_trait::async_trait]
impl RuntimeCreationTerminalPort for crate::channel::command_coordinator::CommandCoordinator {
    async fn error(&self, command: &ExecCmd, terminal: CreateTerminal) {
        self.send_error(
            command,
            terminal.code,
            &terminal.message,
            terminal.retryable,
        )
        .await;
    }

    async fn committed(&self, command: &ExecCmd, chat_id: &str) {
        self.send_committed(command, None, Some(chat_id)).await;
    }
}
