//! metadata 项目目录 CRUD（§目录）：项目 CRUD、导入面与导入完成标记。
//!
//! 本文件是 [`MetadataStore`](super::MetadataStore) 的实现段（结构拆分，
//! 行为语义不变）。

use super::*;

impl MetadataStore {
    pub async fn create_project(
        &self,
        id: &str,
        name: &str,
        cwd: &str,
        instance: &str,
    ) -> Result<ProjectRecord> {
        let ts = now();
        // 写 + generation 递增同事务（§5 原子性：插入成功而 bump 失败会
        // 留下「数据变了、generation 未变」的投影 gap，reproject 永不触发）。
        let mut tx = self.pool.begin().await?;
        sqlx::query("INSERT INTO projects(id,name,cwd,instance_id,created_at,updated_at) VALUES(?,?,?,?,?,?)")
            .bind(id).bind(name).bind(cwd).bind(instance).bind(&ts).bind(&ts).execute(&mut *tx).await?;
        bump_generation_tx(&mut tx).await?;
        tx.commit().await?;
        self.project(id)
            .await?
            .ok_or_else(|| MetadataError::NotFound(id.into()))
    }

    pub async fn import_project(&self, rec: &ProjectRecord) -> Result<bool> {
        let result = sqlx::query("INSERT OR IGNORE INTO projects(id,name,cwd,instance_id,created_at,updated_at,archived_at) VALUES(?,?,?,?,?,?,?)")
            .bind(&rec.id).bind(&rec.name).bind(&rec.cwd).bind(&rec.instance_id)
            .bind(&rec.created_at).bind(&rec.updated_at).bind(&rec.archived_at).execute(&self.pool).await?;
        Ok(result.rows_affected() == 1)
    }

    pub async fn archive_project(&self, id: &str) -> Result<()> {
        let ts = now();
        let mut tx = self.pool.begin().await?;
        let result = sqlx::query(
            "UPDATE projects SET archived_at=?,updated_at=? WHERE id=? AND archived_at IS NULL",
        )
        .bind(&ts)
        .bind(&ts)
        .bind(id)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() == 0 {
            return Err(MetadataError::NotFound(format!("project {id}")));
        }
        bump_generation_tx(&mut tx).await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn restore_project(&self, id: &str) -> Result<()> {
        let ts = now();
        let mut tx = self.pool.begin().await?;
        let result = sqlx::query(
            "UPDATE projects SET archived_at=NULL,updated_at=? WHERE id=? AND archived_at IS NOT NULL",
        )
        .bind(&ts)
        .bind(id)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() == 0 {
            return Err(MetadataError::NotFound(format!("archived project {id}")));
        }
        bump_generation_tx(&mut tx).await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn rename_project(&self, id: &str, name: &str) -> Result<()> {
        let name = name.trim();
        if name.is_empty() {
            return Err(MetadataError::InvalidState("project name is empty".into()));
        }
        let ts = now();
        let mut tx = self.pool.begin().await?;
        let result = sqlx::query(
            "UPDATE projects SET name=?,updated_at=? WHERE id=? AND archived_at IS NULL",
        )
        .bind(name)
        .bind(&ts)
        .bind(id)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() == 0 {
            return Err(MetadataError::NotFound(format!("active project {id}")));
        }
        bump_generation_tx(&mut tx).await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn project(&self, id: &str) -> Result<Option<ProjectRecord>> {
        let row = sqlx::query("SELECT id,name,cwd,instance_id,created_at,updated_at,archived_at FROM projects WHERE id=?")
            .bind(id).fetch_optional(&self.pool).await?;
        Ok(row.map(project_from_row))
    }

    pub async fn list_projects(&self) -> Result<Vec<ProjectRecord>> {
        Ok(sqlx::query("SELECT id,name,cwd,instance_id,created_at,updated_at,archived_at FROM projects ORDER BY updated_at DESC,id")
            .fetch_all(&self.pool).await?.into_iter().map(project_from_row).collect())
    }

    pub async fn import_completed(&self, source: &str) -> Result<bool> {
        let found: Option<i64> =
            sqlx::query_scalar("SELECT 1 FROM metadata_imports WHERE source=?")
                .bind(source)
                .fetch_optional(&self.pool)
                .await?;
        Ok(found.is_some())
    }

    pub async fn mark_import_complete(
        &self,
        source: &str,
        imported: i64,
        skipped: i64,
    ) -> Result<()> {
        // 写 + generation 递增同事务（§5 原子性）。
        let mut tx = self.pool.begin().await?;
        sqlx::query("INSERT INTO metadata_imports(source,completed_at,imported_count,skipped_count) VALUES(?,?,?,?)")
            .bind(source).bind(now()).bind(imported).bind(skipped).execute(&mut *tx).await?;
        bump_generation_tx(&mut tx).await?;
        tx.commit().await?;
        Ok(())
    }
}
