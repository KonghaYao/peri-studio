//! ACP 会话目录的用户导航偏好（归档、自定义名称）。
//!
//! ADR-0003 移除了 `project_sessions` 表，但归档/重命名仍需跨客户端共享；
//! 本表只存导航覆盖，不复制 ACP durable thread 事实。

use std::collections::HashMap;

use super::*;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogSessionPref {
    pub project_id: String,
    pub acp_session_id: String,
    pub custom_name: Option<String>,
    pub archived_at: Option<String>,
    pub updated_at: String,
}

pub type CatalogSessionPrefMap = HashMap<(String, String), CatalogSessionPref>;

impl MetadataStore {
    pub async fn list_catalog_session_prefs(&self) -> Result<Vec<CatalogSessionPref>> {
        Ok(sqlx::query(
            "SELECT project_id,acp_session_id,custom_name,archived_at,updated_at \
             FROM catalog_session_prefs ORDER BY updated_at DESC,acp_session_id",
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(catalog_session_pref_from_row)
        .collect())
    }

    pub async fn archive_catalog_session(
        &self,
        project_id: &str,
        acp_session_id: &str,
    ) -> Result<()> {
        let ts = now();
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO catalog_session_prefs(project_id,acp_session_id,archived_at,updated_at) \
             VALUES(?,?,?,?) \
             ON CONFLICT(project_id,acp_session_id) DO UPDATE SET \
               archived_at=excluded.archived_at,updated_at=excluded.updated_at",
        )
        .bind(project_id)
        .bind(acp_session_id)
        .bind(&ts)
        .bind(&ts)
        .execute(&mut *tx)
        .await?;
        bump_generation_tx(&mut tx).await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn restore_catalog_session(
        &self,
        project_id: &str,
        acp_session_id: &str,
    ) -> Result<()> {
        let ts = now();
        let mut tx = self.pool.begin().await?;
        let result = sqlx::query(
            "UPDATE catalog_session_prefs \
             SET archived_at=NULL,updated_at=? \
             WHERE project_id=? AND acp_session_id=? AND archived_at IS NOT NULL",
        )
        .bind(&ts)
        .bind(project_id)
        .bind(acp_session_id)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() == 0 {
            return Err(MetadataError::NotFound(format!(
                "archived session {acp_session_id}"
            )));
        }
        sqlx::query(
            "DELETE FROM catalog_session_prefs \
             WHERE project_id=? AND acp_session_id=? \
               AND archived_at IS NULL \
               AND (custom_name IS NULL OR trim(custom_name)='')",
        )
        .bind(project_id)
        .bind(acp_session_id)
        .execute(&mut *tx)
        .await?;
        bump_generation_tx(&mut tx).await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn rename_catalog_session(
        &self,
        project_id: &str,
        acp_session_id: &str,
        name: &str,
    ) -> Result<()> {
        let name = name.trim();
        if name.is_empty() {
            return Err(MetadataError::InvalidState("session name is empty".into()));
        }
        let ts = now();
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO catalog_session_prefs(project_id,acp_session_id,custom_name,updated_at) \
             VALUES(?,?,?,?) \
             ON CONFLICT(project_id,acp_session_id) DO UPDATE SET \
               custom_name=excluded.custom_name,updated_at=excluded.updated_at",
        )
        .bind(project_id)
        .bind(acp_session_id)
        .bind(name)
        .bind(&ts)
        .execute(&mut *tx)
        .await?;
        bump_generation_tx(&mut tx).await?;
        tx.commit().await?;
        Ok(())
    }
}

fn catalog_session_pref_from_row(r: sqlx::sqlite::SqliteRow) -> CatalogSessionPref {
    CatalogSessionPref {
        project_id: r.get(0),
        acp_session_id: r.get(1),
        custom_name: r.get(2),
        archived_at: r.get(3),
        updated_at: r.get(4),
    }
}

pub fn catalog_session_pref_map(
    prefs: Vec<CatalogSessionPref>,
) -> CatalogSessionPrefMap {
    prefs
        .into_iter()
        .map(|pref| {
            (
                (pref.project_id.clone(), pref.acp_session_id.clone()),
                pref,
            )
        })
        .collect()
}
