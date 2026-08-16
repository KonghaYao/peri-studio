//! metadata 命令/激活账本（§命令账本）：`begin_command` /
//! `begin_command_with_activation`（激活租约 UPSERT 覆盖终态）、
//! runtime/OAuth 命令 CAS 迁移与 `update_command`。
//!
//! 本文件是 [`MetadataStore`](super::MetadataStore) 的实现段（结构拆分，
//! 行为语义不变）。

use super::*;

impl MetadataStore {
    pub async fn begin_command(
        &self,
        command_id: &str,
        command_type: &str,
        payload_hash: &str,
        project_id: Option<&str>,
        session_id: Option<&str>,
    ) -> Result<BeginCommand> {
        self.begin_command_with_activation(
            command_id,
            command_type,
            payload_hash,
            project_id,
            session_id,
            None,
            None,
        )
        .await
    }

    /// Durably records the command intention and, when requested, the logical
    /// session plus its single-flight activation in one SQLite transaction.
    #[allow(clippy::too_many_arguments)] // One durable transaction carries the full command/activation identity tuple.
    pub async fn begin_command_with_activation(
        &self,
        command_id: &str,
        command_type: &str,
        payload_hash: &str,
        project_id: Option<&str>,
        session_id: Option<&str>,
        new_session: Option<NewSession<'_>>,
        activate_session: Option<&str>,
    ) -> Result<BeginCommand> {
        let mut tx = self.pool.begin().await?;
        let existing = sqlx::query("SELECT command_id,command_type,payload_hash,phase,project_id,session_id,chat_id,acp_session_id,error_code FROM metadata_commands WHERE command_id=?")
            .bind(command_id).fetch_optional(&mut *tx).await?
            .map(|r| MetadataCommand { command_id: r.get(0), command_type: r.get(1), payload_hash: r.get(2), phase: r.get(3), project_id: r.get(4), session_id: r.get(5), chat_id: r.get(6), acp_session_id: r.get(7), error_code: r.get(8) });
        if let Some(existing) = existing {
            if existing.command_type != command_type || existing.payload_hash != payload_hash {
                return Err(MetadataError::Conflict(format!(
                    "command {command_id} payload/type mismatch"
                )));
            }
            return Ok(BeginCommand::Existing);
        }
        let ts = now();
        sqlx::query("INSERT INTO metadata_commands(command_id,command_type,payload_hash,phase,project_id,session_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
            .bind(command_id).bind(command_type).bind(payload_hash).bind("intention_durable")
            .bind(project_id).bind(session_id).bind(&ts).bind(&ts).execute(&mut *tx).await?;
        let has_new_session = new_session.is_some();
        if let Some(new_session) = new_session {
            sqlx::query("INSERT INTO project_sessions(id,project_id,acp_title,lifecycle,created_at,updated_at,origin) VALUES(?,?,?,?,?,?,?)")
                .bind(new_session.id).bind(new_session.project_id).bind(new_session.title)
                .bind("pending").bind(&ts).bind(&ts).bind("hub").execute(&mut *tx).await?;
        }
        if let Some(session_id) = activate_session {
            let archivable: Option<i64> = sqlx::query_scalar(
                "SELECT 1 FROM project_sessions WHERE id=? AND archived_at IS NULL",
            )
            .bind(session_id)
            .fetch_optional(&mut *tx)
            .await?;
            if archivable.is_none() {
                return Err(MetadataError::InvalidState(format!(
                    "session {session_id} is archived or missing"
                )));
            }
            // 重新打开（reconciliation_required/failed 恢复路径）会带着残留的
            // 旧激活记录（终态）再来一轮激活：UPSERT 覆盖，仅当旧记录是终态
            // （reconciliation_required/failed）——进行中的激活必须保持冲突拒绝。
            let activation_result = sqlx::query("INSERT INTO session_activations(session_id,command_id,phase,started_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET command_id=excluded.command_id,phase=excluded.phase,chat_id=NULL,acp_session_id=NULL,updated_at=excluded.updated_at WHERE session_activations.phase IN ('reconciliation_required','failed')")
                .bind(session_id).bind(command_id).bind("intention_durable").bind(&ts).bind(&ts)
                .execute(&mut *tx).await?;
            if activation_result.rows_affected() == 0 {
                return Err(MetadataError::Conflict(format!(
                    "session {session_id} activation already in progress"
                )));
            }
            sqlx::query(
                "UPDATE project_sessions SET lifecycle='activating',updated_at=? WHERE id=?",
            )
            .bind(&ts)
            .bind(session_id)
            .execute(&mut *tx)
            .await?;
        }
        if has_new_session || activate_session.is_some() {
            bump_generation_tx(&mut tx).await?;
        }
        tx.commit().await?;
        Ok(BeginCommand::New)
    }

    pub async fn command(&self, id: &str) -> Result<Option<MetadataCommand>> {
        let row = sqlx::query("SELECT command_id,command_type,payload_hash,phase,project_id,session_id,chat_id,acp_session_id,error_code FROM metadata_commands WHERE command_id=?")
            .bind(id).fetch_optional(&self.pool).await?;
        Ok(row.map(|r| MetadataCommand {
            command_id: r.get(0),
            command_type: r.get(1),
            payload_hash: r.get(2),
            phase: r.get(3),
            project_id: r.get(4),
            session_id: r.get(5),
            chat_id: r.get(6),
            acp_session_id: r.get(7),
            error_code: r.get(8),
        }))
    }

    /// Reserves a body-free runtime mutation in the global command ledger.
    /// The exact payload is represented only by a one-way typed hash.
    pub async fn begin_runtime_command(
        &self,
        command_id: &str,
        command_type: &str,
        payload_hash: &str,
        chat_id: &str,
    ) -> Result<BeginCommand> {
        let mut tx = self.pool.begin().await?;
        let existing = sqlx::query("SELECT command_id,command_type,payload_hash,phase,project_id,session_id,chat_id,acp_session_id,error_code FROM metadata_commands WHERE command_id=?")
            .bind(command_id).fetch_optional(&mut *tx).await?
            .map(|r| MetadataCommand { command_id: r.get(0), command_type: r.get(1), payload_hash: r.get(2), phase: r.get(3), project_id: r.get(4), session_id: r.get(5), chat_id: r.get(6), acp_session_id: r.get(7), error_code: r.get(8) });
        if let Some(existing) = existing {
            if existing.command_type != command_type
                || existing.payload_hash != payload_hash
                || existing.chat_id.as_deref() != Some(chat_id)
            {
                return Err(MetadataError::Conflict(format!(
                    "runtime command {command_id} identity mismatch"
                )));
            }
            return Ok(BeginCommand::Existing);
        }
        let ts = now();
        sqlx::query("INSERT INTO metadata_commands(command_id,command_type,payload_hash,phase,chat_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
            .bind(command_id).bind(command_type).bind(payload_hash).bind("intention_durable")
            .bind(chat_id).bind(&ts).bind(&ts).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(BeginCommand::New)
    }

    /// Compare-and-set transition for body-free runtime commands.
    pub async fn transition_runtime_command(
        &self,
        command_id: &str,
        command_type: &str,
        expected_phase: &str,
        next_phase: &str,
        error_code: Option<&str>,
    ) -> Result<()> {
        let result = sqlx::query(
            "UPDATE metadata_commands SET phase=?,error_code=?,updated_at=? \
             WHERE command_id=? AND command_type=? AND phase=?",
        )
        .bind(next_phase)
        .bind(error_code)
        .bind(now())
        .bind(command_id)
        .bind(command_type)
        .bind(expected_phase)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() != 1 {
            return Err(MetadataError::Conflict(format!(
                "runtime command {command_id} is not in phase {expected_phase}"
            )));
        }
        Ok(())
    }

    pub async fn oauth_command(&self, id: &str) -> Result<Option<OAuthCommandRecord>> {
        let row = sqlx::query(
            "SELECT command_id,command_type,chat_id,payload_fingerprint,phase,error_code \
             FROM oauth_commands WHERE command_id=?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(oauth_command_from_row))
    }

    /// Atomically reserves an OAuth command identity. A command ID is forever
    /// bound to one action/chat/fingerprint tuple, including after terminal
    /// completion and server restart.
    pub async fn begin_oauth_command(
        &self,
        command_id: &str,
        command_type: &str,
        chat_id: &str,
        payload_fingerprint: &str,
    ) -> Result<BeginOAuthCommand> {
        let mut tx = self.pool.begin().await?;
        let existing = sqlx::query(
            "SELECT command_id,command_type,chat_id,payload_fingerprint,phase,error_code \
             FROM oauth_commands WHERE command_id=?",
        )
        .bind(command_id)
        .fetch_optional(&mut *tx)
        .await?
        .map(oauth_command_from_row);
        if let Some(existing) = existing {
            if existing.command_type != command_type
                || existing.chat_id != chat_id
                || existing.payload_fingerprint != payload_fingerprint
            {
                return Err(MetadataError::Conflict(format!(
                    "OAuth command {command_id} identity mismatch"
                )));
            }
            return Ok(BeginOAuthCommand::Existing);
        }
        let ts = now();
        sqlx::query(
            "INSERT INTO oauth_commands(\
             command_id,command_type,chat_id,payload_fingerprint,phase,error_code,created_at,updated_at\
             ) VALUES(?,?,?,?, 'intent_durable',NULL,?,?)",
        )
        .bind(command_id)
        .bind(command_type)
        .bind(chat_id)
        .bind(payload_fingerprint)
        .bind(&ts)
        .bind(&ts)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(BeginOAuthCommand::New)
    }

    /// Advances one command through an expected phase. This is intentionally a
    /// compare-and-set, so two owners can never both cross the dispatch barrier.
    pub async fn transition_oauth_command(
        &self,
        command_id: &str,
        expected_phase: &str,
        next_phase: &str,
        error_code: Option<&str>,
    ) -> Result<()> {
        let result = sqlx::query(
            "UPDATE oauth_commands SET phase=?,error_code=?,updated_at=? \
             WHERE command_id=? AND phase=?",
        )
        .bind(next_phase)
        .bind(error_code)
        .bind(now())
        .bind(command_id)
        .bind(expected_phase)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() != 1 {
            return Err(MetadataError::Conflict(format!(
                "OAuth command {command_id} is not in phase {expected_phase}"
            )));
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)] // Mirrors the persisted metadata command record without partial updates.
    pub async fn update_command(
        &self,
        id: &str,
        phase: &str,
        project: Option<&str>,
        session: Option<&str>,
        chat: Option<&str>,
        acp: Option<&str>,
        error: Option<&str>,
    ) -> Result<()> {
        let result = sqlx::query("UPDATE metadata_commands SET phase=?, project_id=COALESCE(?,project_id), session_id=COALESCE(?,session_id), chat_id=COALESCE(?,chat_id), acp_session_id=COALESCE(?,acp_session_id), error_code=?, updated_at=? WHERE command_id=?")
            .bind(phase).bind(project).bind(session).bind(chat).bind(acp).bind(error).bind(now()).bind(id).execute(&self.pool).await?;
        if result.rows_affected() == 0 {
            return Err(MetadataError::NotFound(format!("command {id}")));
        }
        Ok(())
    }
}

