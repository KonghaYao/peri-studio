//! metadata 投影面（§目录）：generation 水位与 snapshot。
//!
//! ADR-0003 起 `project_sessions` 不再落 SQLite；`ProjectSessionRecord` 仅作
//! Registry 内存投影载体，本文件只保留 projection_state 读写。

use super::*;

impl MetadataStore {
    /// Reads the projection generation and project catalog from one SQLite read
    /// transaction. Session rows are no longer persisted; the sessions field is
    /// always empty and populated upstream from ACP `session/list`.
    pub async fn snapshot(&self) -> Result<MetadataSnapshot> {
        let mut tx = self.pool.begin().await?;
        let generation: i64 =
            sqlx::query_scalar("SELECT generation FROM projection_state WHERE singleton=1")
                .fetch_one(&mut *tx)
                .await?;
        let projects = sqlx::query("SELECT id,name,cwd,instance_id,created_at,updated_at,archived_at FROM projects ORDER BY updated_at DESC,id")
            .fetch_all(&mut *tx).await?.into_iter().map(project_from_row).collect();
        tx.commit().await?;
        Ok(MetadataSnapshot {
            generation,
            projects,
            sessions: Vec::new(),
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

    /// Server restart no longer rebuilds chat views from SQLite session rows.
    pub async fn list_runtime_chats(&self) -> Result<Vec<RuntimeChatView>> {
        Ok(Vec::new())
    }
}
