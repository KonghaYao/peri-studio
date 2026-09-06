//! SQLite `machines` 表：SSH 挂载意图与 local 行权威（ssh-machine-mount §8.1）。

use super::machine_phases::{
    normalize_ssh_destination, PHASE_AWAITING_HOST_KEY, PHASE_FAILED, PHASE_OFFLINE, PHASE_PENDING,
};
use super::*;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MachineRecord {
    pub instance_id: String,
    pub kind: String,
    pub display_name: String,
    pub ssh_destination: Option<String>,
    pub ssh_port: Option<i64>,
    pub identity_file: Option<String>,
    pub auto_reconnect: bool,
    pub remote_forward_port: Option<i64>,
    pub pipeline_generation: i64,
    pub phase: String,
    pub error_code: Option<String>,
    pub host_key_sha256: Option<String>,
    pub pending_host_key_fingerprint: Option<String>,
    pub pending_host_key_line: Option<String>,
    pub remote_owner_fingerprint: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
}

/// admit 输入；`instance_id` 由调用方预生成（`ssh_<uuid>`）。
pub struct AdmitSshMachineParams<'a> {
    pub instance_id: &'a str,
    pub destination: &'a str,
    pub port: Option<i64>,
    pub identity_file: Option<&'a str>,
    pub display_name: &'a str,
}

impl MetadataStore {
    pub async fn ensure_local_machine(&self) -> Result<()> {
        if self.machine("local").await?.is_some() {
            return Ok(());
        }
        let now = now();
        sqlx::query(
            "INSERT INTO machines(instance_id, kind, display_name, phase, auto_reconnect, \
             pipeline_generation, created_at, updated_at) VALUES('local','local',\
             'This computer','online',1,0,?,?)",
        )
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn list_machines(&self) -> Result<Vec<MachineRecord>> {
        let rows = sqlx::query(
            "SELECT instance_id, kind, display_name, ssh_destination, ssh_port, identity_file, \
             auto_reconnect, remote_forward_port, pipeline_generation, phase, error_code, \
             host_key_sha256, pending_host_key_fingerprint, pending_host_key_line, \
             remote_owner_fingerprint, created_at, updated_at, archived_at \
             FROM machines WHERE archived_at IS NULL ORDER BY \
             CASE WHEN kind='local' THEN 0 ELSE 1 END, display_name",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(machine_from_row).collect())
    }

    pub async fn machine(&self, instance_id: &str) -> Result<Option<MachineRecord>> {
        let row = sqlx::query(
            "SELECT instance_id, kind, display_name, ssh_destination, ssh_port, identity_file, \
             auto_reconnect, remote_forward_port, pipeline_generation, phase, error_code, \
             host_key_sha256, pending_host_key_fingerprint, pending_host_key_line, \
             remote_owner_fingerprint, created_at, updated_at, archived_at \
             FROM machines WHERE instance_id = ?",
        )
        .bind(instance_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(machine_from_row))
    }

    pub async fn find_ssh_by_destination(
        &self,
        destination: &str,
        port: Option<i64>,
    ) -> Result<Option<MachineRecord>> {
        let normalized = normalize_ssh_destination(destination);
        let row = sqlx::query(
            "SELECT instance_id, kind, display_name, ssh_destination, ssh_port, identity_file, \
             auto_reconnect, remote_forward_port, pipeline_generation, phase, error_code, \
             host_key_sha256, pending_host_key_fingerprint, pending_host_key_line, \
             remote_owner_fingerprint, created_at, updated_at, archived_at \
             FROM machines WHERE kind = 'ssh' AND archived_at IS NULL \
             AND ssh_destination = ? AND COALESCE(ssh_port, 0) = COALESCE(?, 0)",
        )
        .bind(&normalized)
        .bind(port)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(machine_from_row))
    }

    /// 准入新 SSH 机器：唯一性检查、`phase=pending`、`pipeline_generation` 递增。
    pub async fn admit_ssh_machine(
        &self,
        params: AdmitSshMachineParams<'_>,
    ) -> Result<MachineRecord> {
        let normalized = normalize_ssh_destination(params.destination);
        if self
            .find_ssh_by_destination(&normalized, params.port)
            .await?
            .is_some()
        {
            return Err(MetadataError::Conflict(format!(
                "ssh destination already exists: {normalized}"
            )));
        }
        let ts = now();
        let display_name = if params.display_name.trim().is_empty() {
            normalized.as_str()
        } else {
            params.display_name.trim()
        };
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO machines(\
             instance_id, kind, display_name, ssh_destination, ssh_port, identity_file, \
             auto_reconnect, remote_forward_port, pipeline_generation, phase, \
             created_at, updated_at) \
             VALUES(?, 'ssh', ?, ?, ?, ?, 1, NULL, 1, ?, ?, ?)",
        )
        .bind(params.instance_id)
        .bind(display_name)
        .bind(&normalized)
        .bind(params.port)
        .bind(params.identity_file)
        .bind(PHASE_PENDING)
        .bind(&ts)
        .bind(&ts)
        .execute(&mut *tx)
        .await?;
        bump_generation_tx(&mut tx).await?;
        tx.commit().await?;
        self.machine(params.instance_id)
            .await?
            .ok_or_else(|| MetadataError::NotFound(params.instance_id.into()))
    }

    pub async fn update_machine_phase(
        &self,
        instance_id: &str,
        phase: &str,
        error_code: Option<&str>,
    ) -> Result<()> {
        let ts = now();
        let mut tx = self.pool.begin().await?;
        let result = sqlx::query(
            "UPDATE machines SET phase=?, error_code=?, updated_at=? \
             WHERE instance_id=? AND archived_at IS NULL",
        )
        .bind(phase)
        .bind(error_code)
        .bind(&ts)
        .bind(instance_id)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() == 0 {
            return Err(MetadataError::NotFound(format!("machine {instance_id}")));
        }
        bump_generation_tx(&mut tx).await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn bump_pipeline_generation(&self, instance_id: &str) -> Result<i64> {
        let ts = now();
        let mut tx = self.pool.begin().await?;
        let result = sqlx::query(
            "UPDATE machines SET pipeline_generation=pipeline_generation+1, updated_at=? \
             WHERE instance_id=? AND archived_at IS NULL",
        )
        .bind(&ts)
        .bind(instance_id)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() == 0 {
            return Err(MetadataError::NotFound(format!("machine {instance_id}")));
        }
        let generation: i64 =
            sqlx::query_scalar("SELECT pipeline_generation FROM machines WHERE instance_id=?")
                .bind(instance_id)
                .fetch_one(&mut *tx)
                .await?;
        bump_generation_tx(&mut tx).await?;
        tx.commit().await?;
        Ok(generation)
    }

    pub async fn set_pending_host_key(
        &self,
        instance_id: &str,
        fingerprint: &str,
        line: &str,
    ) -> Result<()> {
        let ts = now();
        let mut tx = self.pool.begin().await?;
        let result = sqlx::query(
            "UPDATE machines SET phase=?, pending_host_key_fingerprint=?, \
             pending_host_key_line=?, updated_at=? \
             WHERE instance_id=? AND archived_at IS NULL",
        )
        .bind(PHASE_AWAITING_HOST_KEY)
        .bind(fingerprint)
        .bind(line)
        .bind(&ts)
        .bind(instance_id)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() == 0 {
            return Err(MetadataError::NotFound(format!("machine {instance_id}")));
        }
        bump_generation_tx(&mut tx).await?;
        tx.commit().await?;
        Ok(())
    }

    /// Trust 写入：指纹必须与 pending 列逐字节相等（§6.3）。
    pub async fn trust_host_key(&self, instance_id: &str, fingerprint: &str) -> Result<()> {
        let ts = now();
        let mut tx = self.pool.begin().await?;
        let result = sqlx::query(
            "UPDATE machines SET host_key_sha256=?, pending_host_key_fingerprint=NULL, \
             pending_host_key_line=NULL, updated_at=? \
             WHERE instance_id=? AND archived_at IS NULL \
             AND pending_host_key_fingerprint=?",
        )
        .bind(fingerprint)
        .bind(&ts)
        .bind(instance_id)
        .bind(fingerprint)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() == 0 {
            return Err(MetadataError::Conflict(format!(
                "host key fingerprint mismatch for machine {instance_id}"
            )));
        }
        bump_generation_tx(&mut tx).await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn set_remote_forward_port(&self, instance_id: &str, port: i64) -> Result<()> {
        let ts = now();
        let result = sqlx::query(
            "UPDATE machines SET remote_forward_port=?, updated_at=? \
             WHERE instance_id=? AND archived_at IS NULL",
        )
        .bind(port)
        .bind(&ts)
        .bind(instance_id)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() == 0 {
            return Err(MetadataError::NotFound(format!("machine {instance_id}")));
        }
        Ok(())
    }

    pub async fn set_remote_owner_fingerprint(
        &self,
        instance_id: &str,
        fingerprint: &str,
    ) -> Result<()> {
        let ts = now();
        let result = sqlx::query(
            "UPDATE machines SET remote_owner_fingerprint=?, updated_at=? \
             WHERE instance_id=? AND archived_at IS NULL",
        )
        .bind(fingerprint)
        .bind(&ts)
        .bind(instance_id)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() == 0 {
            return Err(MetadataError::NotFound(format!("machine {instance_id}")));
        }
        Ok(())
    }

    pub async fn clear_remote_forward_port(&self, instance_id: &str) -> Result<()> {
        let ts = now();
        let result = sqlx::query(
            "UPDATE machines SET remote_forward_port=NULL, updated_at=? \
             WHERE instance_id=? AND archived_at IS NULL",
        )
        .bind(&ts)
        .bind(instance_id)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() == 0 {
            return Err(MetadataError::NotFound(format!("machine {instance_id}")));
        }
        Ok(())
    }

    pub async fn rename_machine(&self, instance_id: &str, display_name: &str) -> Result<()> {
        let name = display_name.trim();
        if name.is_empty() {
            return Err(MetadataError::InvalidState("display name is empty".into()));
        }
        let ts = now();
        let mut tx = self.pool.begin().await?;
        let result = sqlx::query(
            "UPDATE machines SET display_name=?, updated_at=? \
             WHERE instance_id=? AND archived_at IS NULL",
        )
        .bind(name)
        .bind(&ts)
        .bind(instance_id)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() == 0 {
            return Err(MetadataError::NotFound(format!("machine {instance_id}")));
        }
        bump_generation_tx(&mut tx).await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn set_auto_reconnect(&self, instance_id: &str, enabled: bool) -> Result<()> {
        let ts = now();
        let mut tx = self.pool.begin().await?;
        let result = sqlx::query(
            "UPDATE machines SET auto_reconnect=?, updated_at=? \
             WHERE instance_id=? AND kind='ssh' AND archived_at IS NULL",
        )
        .bind(i64::from(enabled))
        .bind(&ts)
        .bind(instance_id)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() == 0 {
            return Err(MetadataError::NotFound(format!(
                "ssh machine {instance_id}"
            )));
        }
        bump_generation_tx(&mut tx).await?;
        tx.commit().await?;
        Ok(())
    }

    /// server 重启：进行中 SSH 管道收敛为 `failed` / `server_restarted`（§6.2）。
    pub async fn fail_in_progress_machines_on_restart(&self) -> Result<u64> {
        let ts = now();
        let mut tx = self.pool.begin().await?;
        let result = sqlx::query(
            "UPDATE machines SET phase=?, error_code='server_restarted', updated_at=? \
             WHERE kind='ssh' AND archived_at IS NULL AND phase IN (\
             'pending','host_key_probe','awaiting_host_key','ssh_connect','probe',\
             'install','provision','tunnel','start','connecting')",
        )
        .bind(PHASE_FAILED)
        .bind(&ts)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() > 0 {
            bump_generation_tx(&mut tx).await?;
        }
        tx.commit().await?;
        Ok(result.rows_affected())
    }

    /// Healthy 之后自动重连候选（§2.1 A）。
    pub async fn list_auto_reconnect_candidates(&self) -> Result<Vec<MachineRecord>> {
        let rows = sqlx::query(
            "SELECT instance_id, kind, display_name, ssh_destination, ssh_port, identity_file, \
             auto_reconnect, remote_forward_port, pipeline_generation, phase, error_code, \
             host_key_sha256, pending_host_key_fingerprint, pending_host_key_line, \
             remote_owner_fingerprint, created_at, updated_at, archived_at \
             FROM machines WHERE kind='ssh' AND auto_reconnect=1 AND archived_at IS NULL \
             AND (phase=? OR (phase=? AND error_code='server_restarted')) \
             ORDER BY display_name",
        )
        .bind(PHASE_OFFLINE)
        .bind(PHASE_FAILED)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(machine_from_row).collect())
    }

    pub async fn archive_machine(&self, instance_id: &str) -> Result<()> {
        if instance_id == "local" {
            return Err(MetadataError::InvalidState(
                "cannot archive local machine".into(),
            ));
        }
        let ts = now();
        let mut tx = self.pool.begin().await?;
        let result = sqlx::query(
            "UPDATE machines SET archived_at=?, updated_at=? \
             WHERE instance_id=? AND archived_at IS NULL",
        )
        .bind(&ts)
        .bind(&ts)
        .bind(instance_id)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() == 0 {
            return Err(MetadataError::NotFound(format!("machine {instance_id}")));
        }
        bump_generation_tx(&mut tx).await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn restore_machine(&self, instance_id: &str) -> Result<MachineRecord> {
        let ts = now();
        let mut tx = self.pool.begin().await?;
        let result = sqlx::query(
            "UPDATE machines SET archived_at=NULL, phase=?, error_code=NULL, \
             pipeline_generation=pipeline_generation+1, updated_at=? \
             WHERE instance_id=? AND archived_at IS NOT NULL",
        )
        .bind(PHASE_OFFLINE)
        .bind(&ts)
        .bind(instance_id)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() == 0 {
            return Err(MetadataError::NotFound(format!(
                "archived machine {instance_id}"
            )));
        }
        bump_generation_tx(&mut tx).await?;
        tx.commit().await?;
        self.machine(instance_id)
            .await?
            .ok_or_else(|| MetadataError::NotFound(instance_id.into()))
    }
}

fn machine_from_row(row: sqlx::sqlite::SqliteRow) -> MachineRecord {
    MachineRecord {
        instance_id: row.get("instance_id"),
        kind: row.get("kind"),
        display_name: row.get("display_name"),
        ssh_destination: row.get("ssh_destination"),
        ssh_port: row.get("ssh_port"),
        identity_file: row.get("identity_file"),
        auto_reconnect: row.get::<i64, _>("auto_reconnect") != 0,
        remote_forward_port: row.get("remote_forward_port"),
        pipeline_generation: row.get("pipeline_generation"),
        phase: row.get("phase"),
        error_code: row.get("error_code"),
        host_key_sha256: row.get("host_key_sha256"),
        pending_host_key_fingerprint: row.get("pending_host_key_fingerprint"),
        pending_host_key_line: row.get("pending_host_key_line"),
        remote_owner_fingerprint: row.get("remote_owner_fingerprint"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        archived_at: row.get("archived_at"),
    }
}

pub fn new_ssh_instance_id() -> String {
    format!("ssh_{}", Uuid::new_v4().simple())
}

#[cfg(test)]
mod metadata_machines_tests {
    use super::*;

    #[tokio::test]
    async fn admit_ssh_machine_enforces_destination_uniqueness() {
        let dir = tempfile::tempdir().unwrap();
        let store = MetadataStore::open(dir.path()).await.unwrap();
        let id1 = new_ssh_instance_id();
        store
            .admit_ssh_machine(AdmitSshMachineParams {
                instance_id: &id1,
                destination: "user@host.example",
                port: Some(22),
                identity_file: None,
                display_name: "GPU box",
            })
            .await
            .unwrap();
        let id2 = new_ssh_instance_id();
        assert!(matches!(
            store
                .admit_ssh_machine(AdmitSshMachineParams {
                    instance_id: &id2,
                    destination: "USER@HOST.EXAMPLE",
                    port: Some(22),
                    identity_file: None,
                    display_name: "dup",
                })
                .await,
            Err(MetadataError::Conflict(_))
        ));
    }

    #[tokio::test]
    async fn fail_in_progress_machines_on_restart_marks_server_restarted() {
        let dir = tempfile::tempdir().unwrap();
        let store = MetadataStore::open(dir.path()).await.unwrap();
        let id = new_ssh_instance_id();
        store
            .admit_ssh_machine(AdmitSshMachineParams {
                instance_id: &id,
                destination: "user@remote",
                port: None,
                identity_file: None,
                display_name: "remote",
            })
            .await
            .unwrap();
        store
            .update_machine_phase(&id, "tunnel", None)
            .await
            .unwrap();
        let count = store.fail_in_progress_machines_on_restart().await.unwrap();
        assert_eq!(count, 1);
        let row = store.machine(&id).await.unwrap().unwrap();
        assert_eq!(row.phase, PHASE_FAILED);
        assert_eq!(row.error_code.as_deref(), Some("server_restarted"));
    }

    #[tokio::test]
    async fn trust_host_key_requires_matching_pending_fingerprint() {
        let dir = tempfile::tempdir().unwrap();
        let store = MetadataStore::open(dir.path()).await.unwrap();
        let id = new_ssh_instance_id();
        store
            .admit_ssh_machine(AdmitSshMachineParams {
                instance_id: &id,
                destination: "user@trust-test",
                port: None,
                identity_file: None,
                display_name: "trust",
            })
            .await
            .unwrap();
        store
            .set_pending_host_key(&id, "SHA256:abc", "host.example ssh-ed25519 AAA")
            .await
            .unwrap();
        assert!(matches!(
            store.trust_host_key(&id, "SHA256:wrong").await,
            Err(MetadataError::Conflict(_))
        ));
        store.trust_host_key(&id, "SHA256:abc").await.unwrap();
        let row = store.machine(&id).await.unwrap().unwrap();
        assert_eq!(row.host_key_sha256.as_deref(), Some("SHA256:abc"));
        assert!(row.pending_host_key_fingerprint.is_none());
    }

    #[tokio::test]
    async fn archive_and_restore_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let store = MetadataStore::open(dir.path()).await.unwrap();
        let id = new_ssh_instance_id();
        store
            .admit_ssh_machine(AdmitSshMachineParams {
                instance_id: &id,
                destination: "user@archive",
                port: None,
                identity_file: None,
                display_name: "archive me",
            })
            .await
            .unwrap();
        store.archive_machine(&id).await.unwrap();
        assert!(store.machine(&id).await.unwrap().is_some());
        assert!(store.list_machines().await.unwrap().is_empty());
        let restored = store.restore_machine(&id).await.unwrap();
        assert_eq!(restored.instance_id, id);
        assert_eq!(restored.phase, PHASE_OFFLINE);
        assert!(restored.archived_at.is_none());
        assert_eq!(restored.pipeline_generation, 2);
    }
}
