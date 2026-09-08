//! AskUserQuestion relay 登记与独立 60s 过期（O-001 X2；不共用 permission 调度）。

use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use peri_studio_proto::schema::QuestionAnswer;

use crate::channel::relay_event_handler::{ConsumeResult, RelayEventHandler};
use crate::control::InstanceError;
use crate::state::doc_manager::{DocCommand, SubmitResult};
use crate::state::normalized::{EventBody, NormalizedEvent};
use crate::state::question::QuestionCasOutcome;

#[derive(Debug, Clone)]
pub(super) struct PendingQuestionReq {
    pub chat_id: String,
    #[allow(dead_code)]
    pub expires_at: String,
}

impl RelayEventHandler {
    pub(super) async fn register_pending_question(
        &self,
        chat_id: &str,
        question_id: &str,
        expires_at: &str,
    ) {
        let mut pending = self.inner.pending_questions.write().await;
        pending.insert(
            question_id.to_string(),
            PendingQuestionReq {
                chat_id: chat_id.to_string(),
                expires_at: expires_at.to_string(),
            },
        );
        drop(pending);
        self.arm_question_expiry(chat_id.to_string(), question_id.to_string(), expires_at.to_string());
    }

    pub async fn pending_question_chat(&self, question_id: &str) -> Option<String> {
        self.inner
            .pending_questions
            .read()
            .await
            .get(question_id)
            .map(|entry| entry.chat_id.clone())
    }

    pub(super) async fn after_event_submitted(
        &self,
        chat_id: &str,
        nev: &NormalizedEvent,
        result: &ConsumeResult,
    ) {
        let applied = matches!(result, ConsumeResult::Delivered { applied: true, .. });
        if !applied {
            return;
        }
        if let EventBody::QuestionRequested {
            question_id,
            expires_at,
            ..
        } = &nev.body
        {
            self.register_pending_question(chat_id, question_id, expires_at)
                .await;
        }
    }

    fn arm_question_expiry(&self, chat_id: String, question_id: String, expires_at: String) {
        let relay = Arc::downgrade(&self.inner);
        tokio::spawn(async move {
            let Some(inner) = relay.upgrade() else {
                return;
            };
            let handler = RelayEventHandler { inner };
            if let Ok(deadline) = DateTime::parse_from_rfc3339(&expires_at) {
                let now = Utc::now();
                let deadline = deadline.with_timezone(&Utc);
                if deadline > now {
                    let wait = (deadline - now)
                        .to_std()
                        .unwrap_or(Duration::from_secs(60));
                    tokio::time::sleep(wait).await;
                }
            } else {
                tokio::time::sleep(Duration::from_secs(60)).await;
            }
            handler.run_question_expiry(chat_id, question_id).await;
        });
    }

    async fn run_question_expiry(&self, chat_id: String, question_id: String) {
        let still_pending = self
            .inner
            .pending_questions
            .read()
            .await
            .get(&question_id)
            .is_some_and(|entry| entry.chat_id == chat_id);
        if !still_pending {
            return;
        }
        let outcome = match self
            .inner
            .doc
            .submit_command(
                &chat_id,
                DocCommand::ExpireQuestion {
                    question_id: question_id.clone(),
                },
            )
            .await
        {
            SubmitResult::Applied(result) if result.applied => QuestionCasOutcome::Migrated,
            SubmitResult::Applied(_) => QuestionCasOutcome::Duplicate,
            _ => return,
        };
        if outcome != QuestionCasOutcome::Migrated {
            return;
        }
        self.inner
            .pending_questions
            .write()
            .await
            .remove(&question_id);
        let _ = self
            .forward_question_control_response(
                &chat_id,
                &question_id,
                false,
                &[],
                &format!("expire-{question_id}"),
            )
            .await;
    }

    pub(super) async fn forward_question_control_response(
        &self,
        chat_id: &str,
        question_id: &str,
        approved: bool,
        answers: &[QuestionAnswer],
        command_id: &str,
    ) -> Result<(), InstanceError> {
        let answers_json = serde_json::to_value(answers).unwrap_or(serde_json::json!([]));
        let frame = serde_json::json!({
            "type": "control_response",
            "request_id": question_id,
            "approved": approved,
            "extra": { "answers": answers_json },
        });
        let Some(entry) = self.inner.chats.entry(chat_id).await else {
            return Err(InstanceError::Offline);
        };
        self.inner
            .instance
            .forward_notification(&entry.instance_id, chat_id, command_id, &frame)
            .await
    }

    pub async fn clear_pending_question(&self, question_id: &str) {
        self.inner
            .pending_questions
            .write()
            .await
            .remove(question_id);
    }
}
