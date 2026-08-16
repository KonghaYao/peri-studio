//! metadata 重启恢复（§重启恢复）：`recover_after_restart` 收敛未决
//! 命令/激活租约（安全重试 / delivery_unknown 分类），gateway 开门前调用。
//!
//! 本文件是 [`MetadataStore`](super::MetadataStore) 的实现段（结构拆分，
//! 行为语义不变）。

use super::*;

impl MetadataStore {
    pub async fn recover_after_restart(&self) -> Result<(u64, u64)> {
        let mut tx = self.pool.begin().await?;
        let ts = now();
        // A command that never crossed the dispatch boundary has no ACP side
        // effect. Terminate it as safely retryable instead of leaving an
        // eternal in-progress dedup record.
        sqlx::query("UPDATE metadata_commands SET phase='failed',error_code='server_restart_before_dispatch_safe_retry',updated_at=? WHERE phase='intention_durable' AND command_id NOT IN (SELECT command_id FROM session_activations)")
            .bind(&ts).execute(&mut *tx).await?;
        sqlx::query("UPDATE metadata_commands SET phase='failed',error_code='server_restart_before_dispatch_safe_retry',updated_at=? WHERE command_id IN (SELECT command_id FROM session_activations WHERE phase IN ('intention_durable','dispatch_pending'))")
            .bind(&ts).execute(&mut *tx).await?;
        sqlx::query("UPDATE project_sessions SET lifecycle='failed',failure_code='server_restart_before_dispatch_safe_retry',updated_at=? WHERE id IN (SELECT session_id FROM session_activations WHERE phase IN ('intention_durable','dispatch_pending'))")
            .bind(&ts).execute(&mut *tx).await?;
        sqlx::query("DELETE FROM session_activations WHERE phase IN ('intention_durable','dispatch_pending')")
            .execute(&mut *tx).await?;
        // 无状态投影：`project_sessions.last_chat_id` 是活跃 chat 的权威判定
        // （`list_runtime_chats` 据此重建 chat 视图），跨重启保留，不清空。
        // Once the ACP id is durable, opening can safely resume by issuing
        // session/load in a fresh chat. Earlier phases have an unknown outcome.
        let recovered = sqlx::query("UPDATE project_sessions SET acp_session_id=(SELECT acp_session_id FROM session_activations a WHERE a.session_id=project_sessions.id),lifecycle='ready',failure_code=NULL,updated_at=? WHERE id IN (SELECT session_id FROM session_activations WHERE acp_session_id IS NOT NULL)")
            .bind(&ts).execute(&mut *tx).await?;
        sqlx::query("UPDATE metadata_commands SET phase='reconciliation_required',chat_id=NULL,error_code='server_restart_after_acp_id',acp_session_id=COALESCE(acp_session_id,(SELECT acp_session_id FROM session_activations a WHERE a.command_id=metadata_commands.command_id)),updated_at=? WHERE command_id IN (SELECT command_id FROM session_activations WHERE acp_session_id IS NOT NULL)")
            .bind(&ts).execute(&mut *tx).await?;
        sqlx::query("DELETE FROM session_activations WHERE acp_session_id IS NOT NULL")
            .execute(&mut *tx)
            .await?;
        let result = sqlx::query("UPDATE project_sessions SET lifecycle='reconciliation_required',failure_code='server_restart_before_acp_id',updated_at=? WHERE id IN (SELECT session_id FROM session_activations)")
            .bind(&ts).execute(&mut *tx).await?;
        sqlx::query("UPDATE metadata_commands SET phase='reconciliation_required',error_code='server_restart_after_dispatch',updated_at=? WHERE command_id IN (SELECT command_id FROM session_activations)")
            .bind(&ts).execute(&mut *tx).await?;
        sqlx::query("UPDATE session_activations SET phase='reconciliation_required',updated_at=?")
            .bind(&ts)
            .execute(&mut *tx)
            .await?;
        // OAuth mutations use a separate no-redelivery state machine. An
        // intention that never crossed `dispatching` is definitely safe, while
        // anything at the barrier is conservatively unknown. Both become
        // terminal before Gateway readiness; startup never resumes an old RPC.
        sqlx::query(
            "UPDATE oauth_commands SET phase='failed_not_delivered',\
             error_code='server_restart_before_dispatch',updated_at=? \
             WHERE phase='intent_durable'",
        )
        .bind(&ts)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE oauth_commands SET phase='delivery_unknown',\
             error_code='server_restart_after_dispatch',updated_at=? \
             WHERE phase='dispatching'",
        )
        .bind(&ts)
        .execute(&mut *tx)
        .await?;
        // Standard ACP config mutations share metadata_commands but have their
        // own no-redelivery barrier. Generic intention recovery above already
        // terminalized pre-dispatch rows; barrier rows must become unknown.
        sqlx::query(
            "UPDATE metadata_commands SET phase='delivery_unknown',\
             error_code='server_restart_after_config_dispatch',updated_at=? \
             WHERE command_type='chat/config-set' AND phase='dispatching'",
        )
        .bind(&ts)
        .execute(&mut *tx)
        .await?;
        // Rewind is destructive. Both a dispatch-barrier crash and a crash
        // after the Agent confirmed the effect are no-redelivery outcomes;
        // the latter may need a later session/load projection repair, but must
        // never invoke session/rewind again.
        sqlx::query(
            "UPDATE metadata_commands SET phase='delivery_unknown',\
             error_code=CASE WHEN phase='effect_confirmed' \
               THEN 'server_restart_after_rewind_confirmed' \
               ELSE 'server_restart_after_rewind_dispatch' END,updated_at=? \
             WHERE command_type='chat/rewind' AND phase IN ('dispatching','effect_confirmed')",
        )
        .bind(&ts)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() > 0 {
            bump_generation_tx(&mut tx).await?;
        }
        tx.commit().await?;
        Ok((recovered.rows_affected(), result.rows_affected()))
    }

    #[cfg(test)]
    pub async fn stale_activations_require_reconciliation(&self) -> Result<u64> {
        Ok(self.recover_after_restart().await?.1)
    }
}

