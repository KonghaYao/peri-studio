//! metadata.sqlite3 schema 迁移面：版本常量（`SCHEMA_VERSION`）、
//! `MIGRATION_V1..V6` 与 [`MetadataStore`](super::MetadataStore) 的
//! `migrate()`/`verify_pragmas()` 执行（§migrate 逐语句模式为受控常量，
//! 无字符串内分号；`unknown_newer_metadata_schema_fails_before_mutating_user_
//! tables` 保证不向后迁移）。

use super::*;


const SCHEMA_VERSION: i64 = 6;

const MIGRATION_V1: &str = r#"
CREATE TABLE IF NOT EXISTS schema_migrations(
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cwd TEXT NOT NULL,
  instance_id TEXT NOT NULL DEFAULT 'local',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS projects_updated_idx ON projects(updated_at DESC);
CREATE TABLE IF NOT EXISTS project_sessions(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  acp_session_id TEXT UNIQUE,
  acp_title TEXT,
  custom_name TEXT,
  lifecycle TEXT NOT NULL CHECK(lifecycle IN
    ('pending','activating','ready','failed','reconciliation_required','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_opened_at TEXT,
  last_chat_id TEXT,
  failure_code TEXT
);
CREATE INDEX IF NOT EXISTS project_sessions_project_updated_idx
  ON project_sessions(project_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS metadata_commands(
  command_id TEXT PRIMARY KEY,
  command_type TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  phase TEXT NOT NULL,
  project_id TEXT,
  session_id TEXT,
  chat_id TEXT,
  acp_session_id TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS session_activations(
  session_id TEXT PRIMARY KEY REFERENCES project_sessions(id) ON DELETE CASCADE,
  command_id TEXT NOT NULL REFERENCES metadata_commands(command_id) ON DELETE RESTRICT,
  phase TEXT NOT NULL,
  chat_id TEXT,
  acp_session_id TEXT,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS metadata_imports(
  source TEXT PRIMARY KEY,
  completed_at TEXT NOT NULL,
  imported_count INTEGER NOT NULL,
  skipped_count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS projection_state(
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  generation INTEGER NOT NULL,
  projected_generation INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO projection_state(singleton,generation,projected_generation,updated_at)
VALUES(1,0,0,'1970-01-01T00:00:00Z');
"#;

const MIGRATION_V2: &str = r#"
ALTER TABLE project_sessions ADD COLUMN origin TEXT NOT NULL DEFAULT 'legacy_hidden'
  CHECK(origin IN ('hub','imported','legacy_hidden'));
UPDATE project_sessions
SET origin='hub'
WHERE EXISTS (
  SELECT 1 FROM metadata_commands c
  WHERE c.session_id=project_sessions.id AND c.command_type='session/create'
);
"#;

const MIGRATION_V3: &str = r#"
ALTER TABLE project_sessions ADD COLUMN hub_title TEXT;
"#;

const MIGRATION_V4: &str = r#"
ALTER TABLE project_sessions ADD COLUMN archived_at TEXT;
CREATE INDEX IF NOT EXISTS project_sessions_archived_updated_idx
  ON project_sessions(archived_at, updated_at DESC);
"#;

const MIGRATION_V5: &str = r#"
CREATE TABLE session_runtime_history(
  session_id TEXT NOT NULL REFERENCES project_sessions(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  activated_at TEXT NOT NULL,
  retired_at TEXT,
  PRIMARY KEY(session_id,chat_id)
);
CREATE INDEX session_runtime_history_session_activated_idx
  ON session_runtime_history(session_id,activated_at DESC);
INSERT OR IGNORE INTO session_runtime_history(session_id,chat_id,activated_at,retired_at)
  SELECT id,last_chat_id,COALESCE(last_opened_at,updated_at),NULL
  FROM project_sessions WHERE last_chat_id IS NOT NULL;
"#;

const MIGRATION_V6: &str = r#"
CREATE TABLE oauth_commands(
  command_id TEXT PRIMARY KEY,
  command_type TEXT NOT NULL CHECK(command_type IN ('mcp/oauth-start','mcp/oauth-cancel')),
  chat_id TEXT NOT NULL,
  payload_fingerprint TEXT NOT NULL,
  phase TEXT NOT NULL CHECK(phase IN
    ('intent_durable','dispatching','committed','rejected','failed_not_delivered','delivery_unknown')),
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX oauth_commands_updated_idx ON oauth_commands(updated_at DESC);
"#;

impl MetadataStore {
pub(super) async fn migrate(&self) -> Result<()> {
    let mut tx = self.pool.begin().await?;
    sqlx::query("CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)")
        .execute(&mut *tx).await?;
    let found: Option<i64> = sqlx::query_scalar("SELECT MAX(version) FROM schema_migrations")
        .fetch_one(&mut *tx)
        .await?;
    let found = found.unwrap_or(0);
    if found > SCHEMA_VERSION {
        return Err(MetadataError::NewerSchema {
            found,
            supported: SCHEMA_VERSION,
        });
    }
    if found < 1 {
        for statement in MIGRATION_V1
            .split(';')
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            sqlx::query(statement).execute(&mut *tx).await?;
        }
        sqlx::query("INSERT INTO schema_migrations(version,applied_at) VALUES(1,?)")
            .bind(now())
            .execute(&mut *tx)
            .await?;
    }
    if found < 2 {
        for statement in MIGRATION_V2
            .split(';')
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            sqlx::query(statement).execute(&mut *tx).await?;
        }
        sqlx::query("INSERT INTO schema_migrations(version,applied_at) VALUES(2,?)")
            .bind(now())
            .execute(&mut *tx)
            .await?;
    }
    if found < 3 {
        for statement in MIGRATION_V3
            .split(';')
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            sqlx::query(statement).execute(&mut *tx).await?;
        }
        sqlx::query("INSERT INTO schema_migrations(version,applied_at) VALUES(3,?)")
            .bind(now())
            .execute(&mut *tx)
            .await?;
    }
    if found < 4 {
        for statement in MIGRATION_V4
            .split(';')
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            sqlx::query(statement).execute(&mut *tx).await?;
        }
        sqlx::query("INSERT INTO schema_migrations(version,applied_at) VALUES(4,?)")
            .bind(now())
            .execute(&mut *tx)
            .await?;
    }
    if found < 5 {
        for statement in MIGRATION_V5
            .split(';')
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            sqlx::query(statement).execute(&mut *tx).await?;
        }
        sqlx::query("INSERT INTO schema_migrations(version,applied_at) VALUES(5,?)")
            .bind(now())
            .execute(&mut *tx)
            .await?;
    }
    if found < 6 {
        for statement in MIGRATION_V6
            .split(';')
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            sqlx::query(statement).execute(&mut *tx).await?;
        }
        sqlx::query("INSERT INTO schema_migrations(version,applied_at) VALUES(6,?)")
            .bind(now())
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(())
}

pub(super) async fn verify_pragmas(&self) -> Result<()> {
    let fk: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
        .fetch_one(&self.pool)
        .await?;
    if fk != 1 {
        return Err(MetadataError::InvalidState(
            "foreign_keys is disabled".into(),
        ));
    }
    let mode: String = sqlx::query_scalar("PRAGMA journal_mode")
        .fetch_one(&self.pool)
        .await?;
    if !mode.eq_ignore_ascii_case("wal") {
        return Err(MetadataError::InvalidState(format!(
            "journal_mode is {mode}, expected wal"
        )));
    }
    Ok(())
}

}
