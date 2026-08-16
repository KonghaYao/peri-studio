//! metadata 会话生命周期与投影面（§目录）：pending/finalize/fail 生命周期、
//! 激活对账、runtime 历史（session_runtime_history）、标题维护、
//! snapshot 与 generation 判定（`mark_projected` 的 MAX 语义）。
//!
//! 本文件是 [`MetadataStore`](super::MetadataStore) 的实现段（结构拆分，
//! 行为语义不变）。

use super::*;

impl MetadataStore {
    pub async fn create_pending_session(
        &self,
        id: &str,
        project_id: &str,
        title: Option<&str>,
    ) -> Result<ProjectSessionRecord> {
        let ts = now();
        // 写 + generation 递增同事务（§5 原子性）。
        let mut tx = self.pool.begin().await?;
        sqlx::query("INSERT INTO project_sessions(id,project_id,acp_title,lifecycle,created_at,updated_at,origin) VALUES(?,?,?,?,?,?,?)")
            .bind(id).bind(project_id).bind(title).bind("pending").bind(&ts).bind(&ts).bind("hub").execute(&mut *tx).await?;
        bump_generation_tx(&mut tx).await?;
        tx.commit().await?;
        self.session(id)
            .await?
            .ok_or_else(|| MetadataError::NotFound(id.into()))
    }

    pub async fn activation_phase(
        &self,
        session_id: &str,
        phase: &str,
        chat: Option<&str>,
        acp: Option<&str>,
    ) -> Result<()> {
        let result = sqlx::query("UPDATE session_activations SET phase=?,chat_id=COALESCE(?,chat_id),acp_session_id=COALESCE(?,acp_session_id),updated_at=? WHERE session_id=?")
            .bind(phase).bind(chat).bind(acp).bind(now()).bind(session_id).execute(&self.pool).await?;
        if result.rows_affected() == 0 {
            return Err(MetadataError::NotFound(format!("activation {session_id}")));
        }
        Ok(())
    }

    pub async fn finalize_session(
        &self,
        id: &str,
        acp: &str,
        title: Option<&str>,
        chat: &str,
    ) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        let ts = now();
        // rows_affected 校验（与 finalize_session_and_command 一致）：目标
        // session 不存在时显式 NotFound，而不是静默成功后靠 FK 兜底（§9
        // 故障可定位）。
        let session = sqlx::query("UPDATE project_sessions SET acp_session_id=?,acp_title=COALESCE(?,acp_title),lifecycle='ready',last_chat_id=?,last_opened_at=?,updated_at=?,failure_code=NULL WHERE id=?")
            .bind(acp).bind(title).bind(chat).bind(&ts).bind(&ts).bind(id).execute(&mut *tx).await?;
        if session.rows_affected() != 1 {
            return Err(MetadataError::NotFound(format!("session {id}")));
        }
        sqlx::query("INSERT INTO session_runtime_history(session_id,chat_id,activated_at,retired_at) VALUES(?,?,?,NULL) ON CONFLICT(session_id,chat_id) DO NOTHING")
            .bind(id).bind(chat).bind(&ts).execute(&mut *tx).await?;
        sqlx::query("DELETE FROM session_activations WHERE session_id=?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        bump_generation_tx(&mut tx).await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn finalize_session_and_command(
        &self,
        command_id: &str,
        session_id: &str,
        project_id: &str,
        acp: &str,
        title: Option<&str>,
        chat: &str,
    ) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        let ts = now();
        let session = sqlx::query("UPDATE project_sessions SET acp_session_id=?,acp_title=COALESCE(?,acp_title),lifecycle='ready',last_chat_id=?,last_opened_at=?,updated_at=?,failure_code=NULL WHERE id=?")
            .bind(acp).bind(title).bind(chat).bind(&ts).bind(&ts).bind(session_id).execute(&mut *tx).await?;
        if session.rows_affected() != 1 {
            return Err(MetadataError::NotFound(format!("session {session_id}")));
        }
        sqlx::query("INSERT INTO session_runtime_history(session_id,chat_id,activated_at,retired_at) VALUES(?,?,?,NULL) ON CONFLICT(session_id,chat_id) DO NOTHING")
            .bind(session_id).bind(chat).bind(&ts).execute(&mut *tx).await?;
        let command = sqlx::query("UPDATE metadata_commands SET phase='projection_pending',project_id=?,session_id=?,chat_id=?,acp_session_id=?,error_code=NULL,updated_at=? WHERE command_id=?")
            .bind(project_id).bind(session_id).bind(chat).bind(acp).bind(&ts).bind(command_id).execute(&mut *tx).await?;
        if command.rows_affected() != 1 {
            return Err(MetadataError::NotFound(format!("command {command_id}")));
        }
        sqlx::query("DELETE FROM session_activations WHERE session_id=?")
            .bind(session_id)
            .execute(&mut *tx)
            .await?;
        bump_generation_tx(&mut tx).await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn mark_reconciliation_required(&self, id: &str, code: &str) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("UPDATE project_sessions SET lifecycle='reconciliation_required',failure_code=?,updated_at=? WHERE id=?")
            .bind(code).bind(now()).bind(id).execute(&mut *tx).await?;
        sqlx::query("UPDATE session_activations SET phase='reconciliation_required',updated_at=? WHERE session_id=?")
            .bind(now()).bind(id).execute(&mut *tx).await?;
        bump_generation_tx(&mut tx).await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn reconcile_activation_and_command(
        &self,
        session_id: &str,
        command_id: &str,
        code: &str,
    ) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        let ts = now();
        let session = sqlx::query("UPDATE project_sessions SET lifecycle='reconciliation_required',failure_code=?,updated_at=? WHERE id=?")
            .bind(code).bind(&ts).bind(session_id).execute(&mut *tx).await?;
        let command = sqlx::query("UPDATE metadata_commands SET phase='reconciliation_required',error_code=?,updated_at=? WHERE command_id=?")
            .bind(code).bind(&ts).bind(command_id).execute(&mut *tx).await?;
        sqlx::query("UPDATE session_activations SET phase='reconciliation_required',updated_at=? WHERE session_id=?")
            .bind(&ts).bind(session_id).execute(&mut *tx).await?;
        if session.rows_affected() != 1 {
            return Err(MetadataError::NotFound(format!("session {session_id}")));
        }
        if command.rows_affected() != 1 {
            return Err(MetadataError::NotFound(format!("command {command_id}")));
        }
        bump_generation_tx(&mut tx).await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn fail_session(&self, id: &str, code: &str) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "UPDATE project_sessions SET lifecycle='failed',failure_code=?,updated_at=? WHERE id=?",
        )
        .bind(code)
        .bind(now())
        .bind(id)
        .execute(&mut *tx)
        .await?;
        sqlx::query("DELETE FROM session_activations WHERE session_id=?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        bump_generation_tx(&mut tx).await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn touch_session_open(&self, id: &str, chat: &str) -> Result<()> {
        let ts = now();
        // 写 + generation 递增同事务；UPDATE 0 行 → 显式 NotFound（§9
        // 故障可定位，不静默）。
        let mut tx = self.pool.begin().await?;
        let result = sqlx::query(
            "UPDATE project_sessions SET last_chat_id=?,last_opened_at=?,updated_at=? WHERE id=?",
        )
        .bind(chat)
        .bind(&ts)
        .bind(&ts)
        .bind(id)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() == 0 {
            return Err(MetadataError::NotFound(format!("session {id}")));
        }
        bump_generation_tx(&mut tx).await?;
        tx.commit().await?;
        Ok(())
    }

    /// Persist logical-session → runtime provenance. This relation carries no
    /// delivery status and never asserts that the runtime remains alive.
    pub async fn record_session_runtime(&self, session_id: &str, chat_id: &str) -> Result<()> {
        let ts = now();
        let result = sqlx::query(
            "INSERT INTO session_runtime_history(session_id,chat_id,activated_at,retired_at) VALUES(?,?,?,NULL) ON CONFLICT(session_id,chat_id) DO NOTHING",
        )
        .bind(session_id)
        .bind(chat_id)
        .bind(ts)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() == 0 {
            let exists: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM session_runtime_history WHERE session_id=? AND chat_id=?",
            )
            .bind(session_id)
            .bind(chat_id)
            .fetch_one(&self.pool)
            .await?;
            if exists != 1 {
                return Err(MetadataError::InvalidState(format!(
                    "runtime provenance missing for session {session_id}"
                )));
            }
        }
        Ok(())
    }

    pub async fn session_runtimes(&self, session_id: &str) -> Result<Vec<SessionRuntimeRecord>> {
        let rows = sqlx::query(
            "SELECT session_id,chat_id,activated_at,retired_at FROM session_runtime_history WHERE session_id=? ORDER BY activated_at DESC,chat_id DESC",
        )
        .bind(session_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|row| SessionRuntimeRecord {
                session_id: row.get(0),
                chat_id: row.get(1),
                activated_at: row.get(2),
                retired_at: row.get(3),
            })
            .collect())
    }

    /// 活跃 runtime chat 全量清单：server 启动时从 SQLite 重建 chat 视图
    /// （进程内 ChatRegistry + Registry Doc `chats` 段）。
    ///
    /// 活跃判定 = `project_sessions.last_chat_id`（每次 open/activation 更新，
    /// 权威「当前 chat」）；`session_runtime_history` 是 append-only 身份追踪
    /// （同一 session 的历史 chat 行恒 `retired_at IS NULL`，不构成活跃证据，
    /// 以 `h.chat_id = ps.last_chat_id` 过滤）。归档 project/session 不重建
    /// （面板不显示）；标题取 custom_name → acp_title → hub_title 的展示
    /// 优先级。
    pub async fn list_runtime_chats(&self) -> Result<Vec<RuntimeChatView>> {
        let rows = sqlx::query(
            "SELECT h.chat_id, p.instance_id, ps.acp_session_id, p.cwd, p.id,
                    COALESCE(NULLIF(ps.custom_name, ''), NULLIF(ps.acp_title, ''),
                             NULLIF(ps.hub_title, ''), '')
             FROM session_runtime_history h
             JOIN project_sessions ps ON ps.id = h.session_id
             JOIN projects p ON p.id = ps.project_id
             WHERE h.retired_at IS NULL AND ps.archived_at IS NULL AND p.archived_at IS NULL
               AND h.chat_id = ps.last_chat_id
             ORDER BY h.activated_at ASC, h.chat_id ASC",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|row| RuntimeChatView {
                chat_id: row.get(0),
                instance_id: row.get(1),
                acp_session_id: row.get(2),
                cwd: row.get(3),
                workspace_id: row.get(4),
                title: row.get(5),
            })
            .collect())
    }

    pub async fn rename_session(&self, id: &str, name: &str) -> Result<()> {
        // 写 + generation 递增同事务（§5 原子性）。
        let mut tx = self.pool.begin().await?;
        let result =
            sqlx::query("UPDATE project_sessions SET custom_name=?,updated_at=? WHERE id=?")
                .bind(name)
                .bind(now())
                .bind(id)
                .execute(&mut *tx)
                .await?;
        if result.rows_affected() == 0 {
            return Err(MetadataError::NotFound(format!("session {id}")));
        }
        bump_generation_tx(&mut tx).await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn archive_session(&self, id: &str) -> Result<()> {
        let ts = now();
        let mut tx = self.pool.begin().await?;
        let result = sqlx::query(
            "UPDATE project_sessions SET archived_at=?,updated_at=? \
             WHERE id=? AND archived_at IS NULL \
             AND NOT EXISTS (SELECT 1 FROM session_activations WHERE session_id=?)",
        )
        .bind(&ts)
        .bind(&ts)
        .bind(id)
        .bind(id)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() == 0 {
            return Err(MetadataError::InvalidState(format!(
                "session {id} not archivable"
            )));
        }
        bump_generation_tx(&mut tx).await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn restore_session(&self, id: &str) -> Result<()> {
        let ts = now();
        let mut tx = self.pool.begin().await?;
        let result = sqlx::query(
            "UPDATE project_sessions SET archived_at=NULL,updated_at=? \
             WHERE id=? AND archived_at IS NOT NULL \
             AND project_id IN (SELECT id FROM projects WHERE archived_at IS NULL)",
        )
        .bind(&ts)
        .bind(id)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() == 0 {
            return Err(MetadataError::InvalidState(format!(
                "session {id} not restorable"
            )));
        }
        bump_generation_tx(&mut tx).await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn update_acp_title(&self, acp: &str, title: &str) -> Result<()> {
        self.update_acp_titles(&[(acp.to_string(), title.to_string())])
            .await?;
        Ok(())
    }

    /// Installs a Hub-owned fallback title exactly once for a Hub-created
    /// logical session. ACP titles and user aliases remain independent facts;
    /// [`ProjectSessionRecord::display_title`] defines their precedence.
    pub async fn seed_hub_title(&self, acp: &str, title: &str) -> Result<bool> {
        let title = title.trim();
        if acp.trim().is_empty() || title.is_empty() {
            return Ok(false);
        }
        let mut tx = self.pool.begin().await?;
        let changed = sqlx::query(
            "UPDATE project_sessions SET hub_title=?,updated_at=? \
             WHERE acp_session_id=? AND origin='hub' \
             AND COALESCE(custom_name,'')='' AND COALESCE(hub_title,'')=''",
        )
        .bind(title)
        .bind(now())
        .bind(acp)
        .execute(&mut *tx)
        .await?
        .rows_affected()
            > 0;
        if changed {
            bump_generation_tx(&mut tx).await?;
        }
        tx.commit().await?;
        Ok(changed)
    }

    /// Persist ACP-owned titles by exact durable session id. Empty titles never
    /// erase a known value, and user `custom_name` aliases remain untouched.
    /// Returns the number of changed rows so callers can avoid a no-op Registry
    /// rebuild on every session/list poll.
    pub async fn update_acp_titles(&self, titles: &[(String, String)]) -> Result<u64> {
        let mut tx = self.pool.begin().await?;
        let ts = now();
        let mut changed = 0u64;
        for (acp, title) in titles {
            if acp.trim().is_empty() || title.trim().is_empty() {
                continue;
            }
            changed += sqlx::query("UPDATE project_sessions SET acp_title=?,updated_at=? WHERE acp_session_id=? AND COALESCE(acp_title,'')<>?")
                .bind(title).bind(&ts).bind(acp).bind(title).execute(&mut *tx).await?.rows_affected();
        }
        if changed > 0 {
            bump_generation_tx(&mut tx).await?;
        }
        tx.commit().await?;
        Ok(changed)
    }

    pub async fn session(&self, id: &str) -> Result<Option<ProjectSessionRecord>> {
        let row = sqlx::query("SELECT id,project_id,acp_session_id,acp_title,custom_name,hub_title,lifecycle,created_at,updated_at,last_opened_at,last_chat_id,failure_code,origin,archived_at FROM project_sessions WHERE id=?")
            .bind(id).fetch_optional(&self.pool).await?;
        Ok(row.map(session_from_row))
    }

    pub async fn list_sessions(&self) -> Result<Vec<ProjectSessionRecord>> {
        Ok(sqlx::query("SELECT id,project_id,acp_session_id,acp_title,custom_name,hub_title,lifecycle,created_at,updated_at,last_opened_at,last_chat_id,failure_code,origin,archived_at FROM project_sessions ORDER BY updated_at DESC,id")
            .fetch_all(&self.pool).await?.into_iter().map(session_from_row).collect())
    }

    /// Reads the projection generation and its complete source data from one
    /// SQLite read transaction. A writer racing after this snapshot leaves a
    /// larger generation behind, so startup/poll repair can detect and replay
    /// it instead of falsely marking stale data as current.
    pub async fn snapshot(&self) -> Result<MetadataSnapshot> {
        let mut tx = self.pool.begin().await?;
        let generation: i64 =
            sqlx::query_scalar("SELECT generation FROM projection_state WHERE singleton=1")
                .fetch_one(&mut *tx)
                .await?;
        let projects = sqlx::query("SELECT id,name,cwd,instance_id,created_at,updated_at,archived_at FROM projects ORDER BY updated_at DESC,id")
            .fetch_all(&mut *tx).await?.into_iter().map(project_from_row).collect();
        let sessions = sqlx::query("SELECT id,project_id,acp_session_id,acp_title,custom_name,hub_title,lifecycle,created_at,updated_at,last_opened_at,last_chat_id,failure_code,origin,archived_at FROM project_sessions ORDER BY updated_at DESC,id")
            .fetch_all(&mut *tx).await?.into_iter().map(session_from_row).collect();
        tx.commit().await?;
        Ok(MetadataSnapshot {
            generation,
            projects,
            sessions,
        })
    }


    pub async fn generation(&self) -> Result<(i64, i64)> {
        let row = sqlx::query(
            "SELECT generation,projected_generation FROM projection_state WHERE singleton=1",
        )
        .fetch_one(&self.pool)
        .await?;
        Ok((row.get(0), row.get(1)))
    }

    pub async fn mark_projected(&self, generation: i64) -> Result<()> {
        sqlx::query("UPDATE projection_state SET projected_generation=MAX(projected_generation,?),updated_at=? WHERE singleton=1 AND generation>=?")
            .bind(generation).bind(now()).bind(generation).execute(&self.pool).await?;
        Ok(())
    }
}
