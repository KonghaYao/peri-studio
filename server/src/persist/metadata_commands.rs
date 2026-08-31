//! metadata 命令账本（§命令账本）：`begin_command`、runtime/OAuth 命令
//! CAS 迁移与 `update_command`。会话激活租约已随 ADR-0003 移除。
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
        instance_id: Option<&str>,
    ) -> Result<BeginCommand> {
        let mut tx = self.pool.begin().await?;
        let existing = sqlx::query(
            "SELECT command_id,command_type,payload_hash,phase,project_id,session_id,chat_id,\
             acp_session_id,instance_id,error_code FROM metadata_commands WHERE command_id=?",
        )
        .bind(command_id)
        .fetch_optional(&mut *tx)
        .await?
        .map(metadata_command_from_row);
        if let Some(existing) = existing {
            if existing.command_type != command_type
                || existing.payload_hash != payload_hash
                || existing.instance_id.as_deref() != instance_id
            {
                return Err(MetadataError::Conflict(format!(
                    "command {command_id} payload/type mismatch"
                )));
            }
            return Ok(BeginCommand::Existing);
        }
        let ts = now();
        sqlx::query(
            "INSERT INTO metadata_commands(\
             command_id,command_type,payload_hash,phase,project_id,session_id,instance_id,\
             created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .bind(command_id)
        .bind(command_type)
        .bind(payload_hash)
        .bind("intention_durable")
        .bind(project_id)
        .bind(session_id)
        .bind(instance_id)
        .bind(&ts)
        .bind(&ts)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(BeginCommand::New)
    }

    /// 与 [`begin_command`] 相同，但显式命名 `instance_id`（`machine/*` 域）。
    pub async fn begin_command_with_instance(
        &self,
        command_id: &str,
        command_type: &str,
        payload_hash: &str,
        instance_id: Option<&str>,
    ) -> Result<BeginCommand> {
        self.begin_command(
            command_id,
            command_type,
            payload_hash,
            None,
            None,
            instance_id,
        )
        .await
    }

    /// Durably records the command intention. Session activation and SQLite
    /// session rows were removed by ADR-0003; `new_session` / `activate_session`
    /// are accepted for API compatibility but ignored.
    #[allow(clippy::too_many_arguments)] // One durable transaction carries the full command identity tuple.
    pub async fn begin_command_with_activation(
        &self,
        command_id: &str,
        command_type: &str,
        payload_hash: &str,
        project_id: Option<&str>,
        session_id: Option<&str>,
        _new_session: Option<NewSession<'_>>,
        _activate_session: Option<&str>,
    ) -> Result<BeginCommand> {
        self.begin_command(
            command_id,
            command_type,
            payload_hash,
            project_id,
            session_id,
            None,
        )
        .await
    }

    pub async fn command(&self, id: &str) -> Result<Option<MetadataCommand>> {
        let row = sqlx::query(
            "SELECT command_id,command_type,payload_hash,phase,project_id,session_id,chat_id,\
             acp_session_id,instance_id,error_code FROM metadata_commands WHERE command_id=?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(metadata_command_from_row))
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
        let existing = sqlx::query(
            "SELECT command_id,command_type,payload_hash,phase,project_id,session_id,chat_id,\
             acp_session_id,instance_id,error_code FROM metadata_commands WHERE command_id=?",
        )
        .bind(command_id)
        .fetch_optional(&mut *tx)
        .await?
        .map(metadata_command_from_row);
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

    /// `machine/add` admit 后回填 instance_id（begin_command 时 id 尚未生成）。
    pub async fn set_command_instance_id(&self, command_id: &str, instance_id: &str) -> Result<()> {
        let result = sqlx::query(
            "UPDATE metadata_commands SET instance_id=?, updated_at=? WHERE command_id=?",
        )
        .bind(instance_id)
        .bind(now())
        .bind(command_id)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() == 0 {
            return Err(MetadataError::NotFound(format!("command {command_id}")));
        }
        Ok(())
    }
}

fn metadata_command_from_row(r: sqlx::sqlite::SqliteRow) -> MetadataCommand {
    MetadataCommand {
        command_id: r.get("command_id"),
        command_type: r.get("command_type"),
        payload_hash: r.get("payload_hash"),
        phase: r.get("phase"),
        project_id: r.get("project_id"),
        session_id: r.get("session_id"),
        chat_id: r.get("chat_id"),
        acp_session_id: r.get("acp_session_id"),
        instance_id: r.get("instance_id"),
        error_code: r.get("error_code"),
    }
}
