//! Project-scoped ACP session discovery lifecycle.
//!
//! The module owns per-project single-flight, live-runtime selection, private
//! runtime ownership, spawn/initialize/list/kill cleanup, title refresh and
//! candidate projection. It never creates a logical Hub session or normal chat.

use std::collections::HashSet;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use peri_studio_proto::instance::{InstanceKill, InstanceSpawn};
use crate::channel::spawn_env::default_acp_spawn_env;
use thiserror::Error;
use tokio::sync::RwLock;
use tracing::warn;
use uuid::Uuid;

use crate::channel::relay_event_handler::RelayEventHandler;
use crate::channel::session_catalog_sync::parse_session_list_response;
use crate::control::{ChatRegistry, InstanceRegistry, ProjectService, SpawnOutcome};
use crate::persist::metadata::ProjectRecord;
use crate::protocol::Translator;

#[derive(Debug, Error)]
pub(super) enum DiscoveryStartError {
    #[error("metadata catalog unavailable")]
    CatalogUnavailable,
    #[error("active project not found")]
    ActiveProjectNotFound,
    #[error("session discovery already in progress for this project")]
    AlreadyInProgress,
}

#[derive(Clone)]
pub(super) struct SessionDiscovery {
    chats: ChatRegistry,
    instance: Arc<InstanceRegistry>,
    relay: Arc<RelayEventHandler>,
    translator: Arc<Translator>,
    projects: Arc<RwLock<Option<ProjectService>>>,
    acp_cmd: Vec<String>,
    spawn_timeout: Duration,
    initialize_timeout: Duration,
    list_timeout: Duration,
    flights: Arc<StdMutex<HashSet<String>>>,
}

pub(super) struct SessionDiscoveryConfig {
    pub acp_cmd: Vec<String>,
    pub spawn_timeout: Duration,
    pub initialize_timeout: Duration,
    pub list_timeout: Duration,
}

pub(super) struct SessionDiscoveryRun {
    discovery: SessionDiscovery,
    project: ProjectRecord,
    _lease: DiscoveryLease,
}

struct DiscoveryLease {
    flights: Arc<StdMutex<HashSet<String>>>,
    project_id: String,
}

impl Drop for DiscoveryLease {
    fn drop(&mut self) {
        self.flights
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(&self.project_id);
    }
}

impl SessionDiscovery {
    pub fn new(
        chats: ChatRegistry,
        instance: Arc<InstanceRegistry>,
        relay: Arc<RelayEventHandler>,
        translator: Arc<Translator>,
        projects: Arc<RwLock<Option<ProjectService>>>,
        config: SessionDiscoveryConfig,
    ) -> Self {
        Self {
            chats,
            instance,
            relay,
            translator,
            projects,
            acp_cmd: config.acp_cmd,
            spawn_timeout: config.spawn_timeout,
            initialize_timeout: config.initialize_timeout,
            list_timeout: config.list_timeout,
            flights: Arc::new(StdMutex::new(HashSet::new())),
        }
    }

    /// Validate catalog identity and acquire the project lease before the
    /// caller emits Accepted. The returned run owns the lease to completion.
    pub async fn start(
        &self,
        project_id: &str,
    ) -> Result<SessionDiscoveryRun, DiscoveryStartError> {
        let Some(projects) = self.projects.read().await.clone() else {
            return Err(DiscoveryStartError::CatalogUnavailable);
        };
        let Some(project) = projects
            .metadata()
            .project(project_id)
            .await
            .ok()
            .flatten()
            .filter(|project| project.archived_at.is_none())
        else {
            return Err(DiscoveryStartError::ActiveProjectNotFound);
        };
        let mut flights = self
            .flights
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if !flights.insert(project_id.to_string()) {
            return Err(DiscoveryStartError::AlreadyInProgress);
        }
        drop(flights);
        Ok(SessionDiscoveryRun {
            discovery: self.clone(),
            project,
            _lease: DiscoveryLease {
                flights: self.flights.clone(),
                project_id: project_id.to_string(),
            },
        })
    }

    async fn discover(&self, project: &ProjectRecord) -> Result<(), String> {
        let reusable = self
            .chats
            .all_chats()
            .await
            .into_iter()
            .find(|(_, chat)| {
                !chat.state.is_terminal()
                    && chat.session_id.is_some()
                    && chat.instance_id == project.instance_id
                    && chat.cwd == project.cwd
            })
            .map(|(chat_id, _)| chat_id);
        if let Some(chat_id) = reusable {
            return self
                .list_through_runtime(&project.instance_id, &chat_id, &project.cwd)
                .await;
        }

        let chat_id = Uuid::new_v4().to_string();
        self.chats.register_ephemeral(&chat_id).await;
        let result = self
            .list_through_ephemeral(&project.instance_id, &chat_id, &project.cwd)
            .await;
        let kill = InstanceKill {
            command_id: Uuid::new_v4().to_string(),
            chat_id: chat_id.clone(),
            grace: Some(1_000),
        };
        if let Err(error) = self.instance.send_kill(&project.instance_id, kill).await {
            warn!(chat_id, error = ?error, "discovery runtime cleanup failed");
        }
        self.chats.unregister_ephemeral(&chat_id).await;
        result
    }

    async fn list_through_ephemeral(
        &self,
        instance_id: &str,
        chat_id: &str,
        cwd: &str,
    ) -> Result<(), String> {
        let spawn = InstanceSpawn {
            command_id: Uuid::new_v4().to_string(),
            chat_id: chat_id.to_string(),
            cmd: self.acp_cmd.clone(),
            cwd: cwd.to_string(),
            env: default_acp_spawn_env(),
        };
        match tokio::time::timeout(
            self.spawn_timeout,
            self.instance.send_spawn(instance_id, spawn),
        )
        .await
        {
            Ok(Ok(SpawnOutcome::Acked(ack))) if ack.ok => {}
            Ok(Ok(_)) => return Err("ACP discovery process failed to start".to_string()),
            Ok(Err(error)) => return Err(format!("ACP discovery spawn failed: {error}")),
            Err(_) => return Err("ACP discovery spawn timed out".to_string()),
        }
        let (rpc_id, message) = self.translator.initialize_rpc(cwd);
        let rx = self
            .relay
            .register_rpc(&rpc_id, "session_discover_initialize".to_string())
            .await;
        if let Err(error) = self
            .instance
            .forward_rpc(instance_id, chat_id, &message)
            .await
        {
            self.relay.cancel_rpc(&rpc_id).await;
            return Err(format!("ACP discovery initialize failed: {error}"));
        }
        match tokio::time::timeout(self.initialize_timeout, rx).await {
            Ok(Ok(response)) if response.get("error").is_none() => {}
            _ => return Err("ACP discovery initialize timed out or was rejected".to_string()),
        }
        self.list_through_runtime(instance_id, chat_id, cwd).await
    }

    async fn list_through_runtime(
        &self,
        instance_id: &str,
        chat_id: &str,
        cwd: &str,
    ) -> Result<(), String> {
        let rpc_id = self.translator.alloc_rpc_id();
        let message = serde_json::json!({
            "jsonrpc": "2.0",
            "id": rpc_id,
            "method": "session/list",
            "params": { "cwd": cwd },
        });
        let rx = self
            .relay
            .register_rpc(&rpc_id, "session_discover".to_string())
            .await;
        if let Err(error) = self
            .instance
            .forward_rpc(instance_id, chat_id, &message)
            .await
        {
            self.relay.cancel_rpc(&rpc_id).await;
            return Err(format!("ACP session discovery failed: {error}"));
        }
        let response = match tokio::time::timeout(self.list_timeout, rx).await {
            Ok(Ok(response)) if response.get("error").is_none() => response,
            _ => return Err("ACP session discovery timed out or was rejected".to_string()),
        };
        let mut entries = parse_session_list_response(&response);
        for entry in &mut entries {
            entry.cwd = cwd.to_string();
            entry.bound_chat_id = None;
        }
        if let Some(projects) = self.projects.read().await.clone() {
            if let Err(error) = projects.refresh_acp_titles(&entries).await {
                warn!(error = ?error, "ACP session title metadata refresh failed");
            }
        }
        self.chats
            .registry()
            .apply_sessions(entries)
            .await
            .map_err(|error| format!("session discovery projection failed: {error}"))?;
        Ok(())
    }
}

impl SessionDiscoveryRun {
    pub async fn execute(self) -> Result<(), String> {
        self.discovery.discover(&self.project).await
    }
}

#[cfg(test)]
#[path = "session_discovery_test.rs"]
mod session_discovery_test;
