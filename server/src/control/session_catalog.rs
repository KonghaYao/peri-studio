//! In-memory ACP session catalog (ADR-0003).
//!
//! Per-project cache of durable threads from `session/list`, merged with
//! [`ChatRegistry`] runtime facts at projection time. Server restart clears the
//! cache until discovery or an interactive list refresh repopulates it.

use std::collections::HashMap;
use std::sync::Arc;

use chrono::Utc;
use peri_studio_proto::schema::{ProjectSessionSummary, SessionSummaryProjection};
use tokio::sync::RwLock;

use super::ChatRegistry;
use crate::persist::metadata::CatalogSessionPrefMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogSession {
    pub acp_session_id: String,
    pub project_id: String,
    pub title: String,
    pub updated_at: String,
    pub status: String,
    pub lifecycle: String,
    pub last_opened_at: Option<String>,
    pub hub_title: Option<String>,
}

#[derive(Clone, Default)]
pub struct SessionCatalog {
    inner: Arc<RwLock<HashMap<String, HashMap<String, CatalogSession>>>>,
    index: Arc<RwLock<HashMap<String, String>>>,
}

impl SessionCatalog {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(HashMap::new())),
            index: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn refresh(&self, project_id: &str, entries: &[SessionSummaryProjection]) {
        let mut catalog = self.inner.write().await;
        let mut index = self.index.write().await;
        let project = catalog
            .entry(project_id.to_string())
            .or_insert_with(HashMap::new);
        for entry in entries {
            let acp_id = entry.session_id.trim();
            if acp_id.is_empty() {
                continue;
            }
            index.insert(acp_id.to_string(), project_id.to_string());
            let existing = project.get(acp_id);
            let hub_title = existing.and_then(|s| s.hub_title.clone());
            let lifecycle = existing
                .map(|s| s.lifecycle.clone())
                .filter(|l| l == "activating")
                .unwrap_or_else(|| "ready".to_string());
            let last_opened_at = existing.and_then(|s| s.last_opened_at.clone());
            project.insert(
                acp_id.to_string(),
                CatalogSession {
                    acp_session_id: acp_id.to_string(),
                    project_id: project_id.to_string(),
                    title: entry.title.clone(),
                    updated_at: if entry.updated_at.is_empty() {
                        Utc::now().to_rfc3339()
                    } else {
                        entry.updated_at.clone()
                    },
                    status: entry.status.clone(),
                    lifecycle,
                    last_opened_at,
                    hub_title,
                },
            );
        }
    }

    pub async fn upsert(&self, session: CatalogSession) {
        let acp_id = session.acp_session_id.clone();
        let project_id = session.project_id.clone();
        self.index
            .write()
            .await
            .insert(acp_id.clone(), project_id.clone());
        self.inner
            .write()
            .await
            .entry(project_id)
            .or_insert_with(HashMap::new)
            .insert(acp_id, session);
    }

    pub async fn get(&self, acp_session_id: &str) -> Option<CatalogSession> {
        let index = self.index.read().await;
        let project_id = index.get(acp_session_id)?;
        self.inner
            .read()
            .await
            .get(project_id)?
            .get(acp_session_id)
            .cloned()
    }

    pub async fn list_for_project(&self, project_id: &str) -> Vec<CatalogSession> {
        self.inner
            .read()
            .await
            .get(project_id)
            .map(|sessions| sessions.values().cloned().collect())
            .unwrap_or_default()
    }

    pub async fn list_all(&self) -> Vec<CatalogSession> {
        self.inner
            .read()
            .await
            .values()
            .flat_map(|sessions| sessions.values().cloned())
            .collect()
    }

    pub async fn set_lifecycle(&self, acp_session_id: &str, lifecycle: &str) -> bool {
        let Some(project_id) = self.index.read().await.get(acp_session_id).cloned() else {
            return false;
        };
        let mut inner = self.inner.write().await;
        let Some(sessions) = inner.get_mut(&project_id) else {
            return false;
        };
        let Some(session) = sessions.get_mut(acp_session_id) else {
            return false;
        };
        session.lifecycle = lifecycle.to_string();
        true
    }

    pub async fn touch_opened(&self, acp_session_id: &str) {
        let Some(project_id) = self.index.read().await.get(acp_session_id).cloned() else {
            return;
        };
        let mut inner = self.inner.write().await;
        let Some(sessions) = inner.get_mut(&project_id) else {
            return;
        };
        let Some(session) = sessions.get_mut(acp_session_id) else {
            return;
        };
        let ts = Utc::now().to_rfc3339();
        session.last_opened_at = Some(ts.clone());
        session.updated_at = ts;
        session.lifecycle = "ready".to_string();
    }

    pub async fn seed_hub_title(&self, acp_session_id: &str, title: &str) -> bool {
        let title = title.trim();
        if title.is_empty() {
            return false;
        }
        let Some(project_id) = self.index.read().await.get(acp_session_id).cloned() else {
            return false;
        };
        let mut inner = self.inner.write().await;
        let Some(sessions) = inner.get_mut(&project_id) else {
            return false;
        };
        let Some(session) = sessions.get_mut(acp_session_id) else {
            return false;
        };
        if session
            .hub_title
            .as_deref()
            .is_some_and(|existing| !existing.trim().is_empty())
        {
            return false;
        }
        session.hub_title = Some(title.to_string());
        true
    }

    pub async fn project_summaries(
        sessions: Vec<CatalogSession>,
        chats: &ChatRegistry,
        prefs: &CatalogSessionPrefMap,
    ) -> Vec<ProjectSessionSummary> {
        let mut out = Vec::with_capacity(sessions.len());
        for session in sessions {
            let active_chat_id = active_chat_for(chats, &session.acp_session_id).await;
            let pref = prefs.get(&(session.project_id.clone(), session.acp_session_id.clone()));
            let title = pref
                .and_then(|value| value.custom_name.as_deref())
                .filter(|name| !name.trim().is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| display_title(&session));
            out.push(ProjectSessionSummary {
                id: session.acp_session_id.clone(),
                project_id: session.project_id,
                acp_session_id: Some(session.acp_session_id),
                title,
                lifecycle: session.lifecycle,
                updated_at: session.updated_at,
                last_opened_at: session.last_opened_at,
                active_chat_id,
                archived_at: pref.and_then(|value| value.archived_at.clone()),
            });
        }
        out
    }
}

fn display_title(session: &CatalogSession) -> String {
    session
        .hub_title
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| {
            if meaningful_title(&session.title) || !session.title.trim().is_empty() {
                Some(session.title.as_str())
            } else {
                None
            }
        })
        .unwrap_or("新对话")
        .to_string()
}

fn meaningful_title(title: &str) -> bool {
    let normalized = title.trim().to_lowercase();
    !normalized.is_empty()
        && !matches!(
            normalized.as_str(),
            "新对话" | "未命名会话" | "untitled" | "new conversation" | "new chat"
        )
}

async fn active_chat_for(chats: &ChatRegistry, acp_session_id: &str) -> Option<String> {
    let chat_id = chats.resolve(acp_session_id).await?;
    let entry = chats.entry(&chat_id).await?;
    if entry.state.is_terminal() || !entry.runtime_confirmed {
        return None;
    }
    if entry.session_id.as_deref() != Some(acp_session_id) {
        return None;
    }
    Some(chat_id)
}
