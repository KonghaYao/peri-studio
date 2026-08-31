//! metadata 重启恢复（§重启恢复）：`recover_after_restart` 收敛未决
//! 命令租约（安全重试 / delivery_unknown 分类），gateway 开门前调用。
//!
//! ADR-0003 起不再读写 `project_sessions` / `session_activations`。

use super::*;

impl MetadataStore {
    pub async fn recover_after_restart(&self) -> Result<(u64, u64)> {
        let mut tx = self.pool.begin().await?;
        let ts = now();
        // A command that never crossed the dispatch boundary has no ACP side
        // effect. Terminate it as safely retryable instead of leaving an
        // eternal in-progress dedup record.
        sqlx::query(
            "UPDATE metadata_commands SET phase='failed',\
             error_code='server_restart_before_dispatch_safe_retry',updated_at=? \
             WHERE phase='intention_durable'",
        )
        .bind(&ts)
        .execute(&mut *tx)
        .await?;
        let reconciled = sqlx::query(
            "UPDATE metadata_commands SET phase='reconciliation_required',\
             error_code='server_restart_after_dispatch',updated_at=? \
             WHERE phase IN ('dispatched','dispatch_pending','projection_pending')",
        )
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
        if reconciled.rows_affected() > 0 {
            bump_generation_tx(&mut tx).await?;
        }
        tx.commit().await?;
        // SSH 供应管道：进行中 phase 收敛为 failed/server_restarted（§6.2）。
        let _machines_failed = self.fail_in_progress_machines_on_restart().await?;
        Ok((0, reconciled.rows_affected()))
    }

    #[cfg(test)]
    pub async fn stale_activations_require_reconciliation(&self) -> Result<u64> {
        Ok(self.recover_after_restart().await?.1)
    }
}
