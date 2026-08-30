//! Deep module owning SQLite navigation mutations and Registry projection.

use std::sync::Arc;

use peri_studio_proto::schema::{ProjectSummary, SessionSummaryProjection, WorkspaceSummary};
use thiserror::Error;

use crate::control::{CatalogSession, ChatRegistry, SessionCatalog};
use crate::persist::metadata::{MetadataError, MetadataStore, ProjectRecord};
use crate::state::registry::{RegistryError, RegistryState};

#[derive(Debug, Error)]
pub enum ProjectServiceError {
    #[error(transparent)]
    Metadata(#[from] MetadataError),
    #[error(transparent)]
    Registry(#[from] RegistryError),
}

#[derive(Clone)]
pub struct ProjectService {
    metadata: Arc<MetadataStore>,
    registry: RegistryState,
    catalog: SessionCatalog,
    chats: ChatRegistry,
}

impl ProjectService {
    pub fn new(
        metadata: Arc<MetadataStore>,
        registry: RegistryState,
        catalog: SessionCatalog,
        chats: ChatRegistry,
    ) -> Self {
        Self {
            metadata,
            registry,
            catalog,
            chats,
        }
    }

    pub fn metadata(&self) -> &Arc<MetadataStore> {
        &self.metadata
    }

    pub fn catalog(&self) -> &SessionCatalog {
        &self.catalog
    }

    pub async fn import_legacy_workspaces(&self) -> Result<(), ProjectServiceError> {
        const SOURCE: &str = "registry-workspaces-v1";
        if self.metadata.import_completed(SOURCE).await? {
            return Ok(());
        }
        let mut imported = 0i64;
        for w in self.registry.list_workspaces().await? {
            let rec = ProjectRecord {
                id: w.id,
                name: w.name,
                cwd: w.cwd,
                instance_id: "local".into(),
                created_at: w.created_at,
                updated_at: w.updated_at,
                archived_at: None,
            };
            if self.metadata.import_project(&rec).await? {
                imported += 1;
            }
        }
        self.metadata
            .mark_import_complete(SOURCE, imported, 0)
            .await?;
        self.reproject().await
    }

    pub async fn create_project(
        &self,
        id: &str,
        name: &str,
        cwd: &str,
        instance: &str,
    ) -> Result<ProjectRecord, ProjectServiceError> {
        let p = self
            .metadata
            .create_project(id, name, cwd, instance)
            .await?;
        self.reproject().await?;
        Ok(p)
    }

    pub async fn create_project_metadata(
        &self,
        id: &str,
        name: &str,
        cwd: &str,
        instance: &str,
    ) -> Result<ProjectRecord, ProjectServiceError> {
        Ok(self
            .metadata
            .create_project(id, name, cwd, instance)
            .await?)
    }

    pub async fn archive_project_metadata(&self, id: &str) -> Result<(), ProjectServiceError> {
        Ok(self.metadata.archive_project(id).await?)
    }

    pub async fn restore_project_metadata(&self, id: &str) -> Result<(), ProjectServiceError> {
        Ok(self.metadata.restore_project(id).await?)
    }

    pub async fn rename_project_metadata(
        &self,
        id: &str,
        name: &str,
    ) -> Result<(), ProjectServiceError> {
        Ok(self.metadata.rename_project(id, name).await?)
    }

    pub async fn archive_project(&self, id: &str) -> Result<(), ProjectServiceError> {
        self.metadata.archive_project(id).await?;
        self.reproject().await
    }

    /// Refreshes the in-memory ACP catalog for one project and reprojects when
    /// list facts changed.
    pub async fn refresh_project_catalog(
        &self,
        project_id: &str,
        sessions: &[SessionSummaryProjection],
    ) -> Result<(), ProjectServiceError> {
        self.catalog.refresh(project_id, sessions).await;
        self.reproject().await
    }

    /// Derives a restrained Hub fallback from the first dispatched user
    /// prompt. It never mutates the ACP thread title and never outranks a
    /// meaningful ACP-owned title.
    pub async fn seed_prompt_title(
        &self,
        acp_session_id: &str,
        prompt: &str,
    ) -> Result<bool, ProjectServiceError> {
        let Some(title) = prompt_title(prompt) else {
            return Ok(false);
        };
        let changed = self.catalog.seed_hub_title(acp_session_id, &title).await;
        if changed {
            self.reproject().await?;
        }
        Ok(changed)
    }

    pub async fn reproject(&self) -> Result<(), ProjectServiceError> {
        let snapshot = self.metadata.snapshot().await?;
        let projects = snapshot.projects.into_iter().map(project_summary).collect();
        let sessions =
            SessionCatalog::project_summaries(self.catalog.list_all().await, &self.chats).await;
        self.registry.replace_projects(projects, sessions).await?;
        self.metadata.mark_projected(snapshot.generation).await?;
        Ok(())
    }

    pub async fn mirror_legacy_workspace(
        &self,
        p: &ProjectRecord,
    ) -> Result<(), ProjectServiceError> {
        self.registry
            .upsert_workspace(WorkspaceSummary {
                id: p.id.clone(),
                name: p.name.clone(),
                cwd: p.cwd.clone(),
                created_at: p.created_at.clone(),
                updated_at: p.updated_at.clone(),
            })
            .await?;
        Ok(())
    }

    pub async fn record_opened_session(&self, acp_session_id: &str) -> Result<(), ProjectServiceError> {
        self.catalog.touch_opened(acp_session_id).await;
        self.reproject().await
    }

    pub async fn upsert_catalog_session(
        &self,
        session: CatalogSession,
    ) -> Result<(), ProjectServiceError> {
        self.catalog.upsert(session).await;
        self.reproject().await
    }

    pub async fn bound_chat_ids(&self, acp_session_id: &str) -> Vec<String> {
        self.chats
            .resolve(acp_session_id)
            .await
            .into_iter()
            .collect()
    }
}

fn prompt_title(prompt: &str) -> Option<String> {
    const MAX_CHARS: usize = 60;
    let line = prompt.lines().find(|line| !line.trim().is_empty())?;
    let normalized = line.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return None;
    }
    let mut chars = normalized.chars();
    let prefix: String = chars.by_ref().take(MAX_CHARS).collect();
    if chars.next().is_some() {
        let mut shortened: String = prefix.chars().take(MAX_CHARS - 1).collect();
        shortened.push('…');
        Some(shortened)
    } else {
        Some(prefix)
    }
}

fn project_summary(p: ProjectRecord) -> ProjectSummary {
    ProjectSummary {
        id: p.id,
        name: p.name,
        cwd: p.cwd,
        instance_id: p.instance_id,
        created_at: p.created_at,
        updated_at: p.updated_at,
        archived_at: p.archived_at,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use tempfile::tempdir;

    use super::{prompt_title, ProjectService, SessionCatalog};
    use crate::control::{ChatRegistry, StoreSink};
    use crate::persist::metadata::MetadataStore;
    use crate::state::doc_manager::{BatchConfig, DocManager};

    #[tokio::test]
    async fn catalog_refresh_repairs_registry_projection() {
        let dir = tempdir().unwrap();
        let sink = Arc::new(StoreSink::new());
        let doc = DocManager::new(BatchConfig::default(), sink);
        let metadata = Arc::new(MetadataStore::open(dir.path()).await.unwrap());
        metadata
            .create_project("p", "Demo", "/", "local")
            .await
            .unwrap();
        let catalog = SessionCatalog::new();
        let chats = ChatRegistry::new(doc.registry());
        let service = ProjectService::new(metadata.clone(), doc.registry(), catalog, chats);
        service.reproject().await.unwrap();

        service
            .refresh_project_catalog(
                "p",
                &[peri_studio_proto::schema::SessionSummaryProjection {
                    session_id: "acp".into(),
                    title: "New".into(),
                    status: String::new(),
                    updated_at: "2026-08-13T00:00:00Z".into(),
                    cwd: "/".into(),
                    bound_chat_id: None,
                }],
            )
            .await
            .unwrap();
        let session = service.catalog().get("acp").await.unwrap();
        assert_eq!(session.title, "New");
        assert_eq!(session.project_id, "p");
    }

    #[test]
    fn prompt_title_uses_the_first_meaningful_line_and_unicode_boundaries() {
        assert_eq!(
            prompt_title("\n  重构   ACP Hub 的会话目录  \nignored").as_deref(),
            Some("重构 ACP Hub 的会话目录")
        );
        let title = prompt_title(&"界".repeat(80)).unwrap();
        assert_eq!(title.chars().count(), 60);
        assert!(title.ends_with('…'));
        assert_eq!(prompt_title(" \n\t"), None);
    }
}
