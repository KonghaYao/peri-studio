//! 短租约远程资源 Yjs 投影。
//!
//! instance 返回普通 DTO；本模块是唯一将 DTO 写入 `resource:{view_id}` Doc
//! 的 server writer，并同时拥有 principal 授权与生命周期回收。

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use peri_studio_proto::conn::DocId;
use peri_studio_proto::resource::{
    GitChangeStatus, GitGroupId, InstanceResourcePayload, ResourceErrorCode, ResourceFailure,
    ResourceViewOpened,
};
use tokio::sync::Mutex;
use yrs::{Array, Map, ReadTxn, Transact};

use crate::control::StoreSink;
use crate::state::doc_manager::UpdateSink;
use crate::state::factory::{DocKind, Factory, ROOT};
use crate::state::view_store::encode_state_as_update;

#[derive(Debug, Clone)]
struct ResourceLease {
    principal: String,
    expires_at: DateTime<Utc>,
}

#[derive(Clone)]
pub struct ResourceProjection {
    sink: Arc<StoreSink>,
    leases: Arc<Mutex<HashMap<DocId, ResourceLease>>>,
    lease_ttl: Duration,
    max_views_per_principal: usize,
}

impl ResourceProjection {
    pub fn new(sink: Arc<StoreSink>, lease_ttl: Duration, max_views_per_principal: usize) -> Self {
        Self {
            sink,
            leases: Arc::new(Mutex::new(HashMap::new())),
            lease_ttl,
            max_views_per_principal,
        }
    }

    /// 发布一次 instance 查询结果并签发 principal 绑定的 Doc 租约。
    pub async fn publish(
        &self,
        principal: &str,
        project_id: &str,
        payload: &InstanceResourcePayload,
    ) -> Result<ResourceViewOpened, ResourceFailure> {
        let now = Utc::now();
        let expires_at = now
            + chrono::Duration::from_std(self.lease_ttl)
                .unwrap_or_else(|_| chrono::Duration::minutes(1));
        {
            let mut leases = self.leases.lock().await;
            leases.retain(|_, lease| lease.expires_at > now);
            let count = leases
                .values()
                .filter(|lease| lease.principal == principal)
                .count();
            if count >= self.max_views_per_principal {
                return Err(failure(
                    ResourceErrorCode::RateLimited,
                    "too many open resource views",
                    true,
                ));
            }
        }

        let view_id = uuid::Uuid::new_v4().to_string();
        let doc_id = DocId::resource(&view_id);
        let update = build_update(&view_id, project_id, payload);
        self.sink
            .persist_update(doc_id.clone(), update)
            .await
            .map_err(|_| {
                failure(
                    ResourceErrorCode::Unavailable,
                    "resource projection unavailable",
                    true,
                )
            })?;
        self.leases.lock().await.insert(
            doc_id.clone(),
            ResourceLease {
                principal: principal.to_string(),
                expires_at,
            },
        );
        Ok(ResourceViewOpened {
            view_id,
            doc_id,
            lease_expires_at: expires_at.to_rfc3339(),
        })
    }

    pub async fn authorize(&self, principal: &str, doc: &DocId) -> bool {
        let now = Utc::now();
        let mut leases = self.leases.lock().await;
        leases.retain(|_, lease| lease.expires_at > now);
        leases
            .get(doc)
            .is_some_and(|lease| lease.principal == principal)
    }

    pub async fn release(&self, principal: &str, view_id: &str) -> bool {
        let doc = DocId::resource(view_id);
        let removed = {
            let mut leases = self.leases.lock().await;
            if leases
                .get(&doc)
                .is_some_and(|lease| lease.principal == principal)
            {
                leases.remove(&doc);
                true
            } else {
                false
            }
        };
        if removed {
            self.sink.remove_resource_doc(&doc).await;
        }
        removed
    }
}

fn build_update(view_id: &str, project_id: &str, payload: &InstanceResourcePayload) -> Vec<u8> {
    let mut doc = yrs::Doc::new();
    Factory::new()
        .ensure_schema(&mut doc, DocKind::Resource)
        .expect("resource schema");
    {
        let mut txn = doc.transact_mut();
        let root = txn.get_map(ROOT).expect("resource root");
        root.insert(&mut txn, "projection_version", 1u32);
        let meta = root.get_or_init::<_, yrs::MapRef>(&mut txn, "meta");
        meta.insert(&mut txn, "view_id", view_id);
        meta.insert(&mut txn, "project_id", project_id);
        meta.insert(&mut txn, "status", "ready");
        meta.insert(&mut txn, "generated_at", Utc::now().to_rfc3339());
        let order = root.get_or_init::<_, yrs::ArrayRef>(&mut txn, "entry_order");
        let entries = root.get_or_init::<_, yrs::MapRef>(&mut txn, "entries");
        project_payload(&mut txn, &meta, &order, &entries, payload);
    }
    encode_state_as_update(&doc)
}

fn project_payload(
    txn: &mut yrs::TransactionMut<'_>,
    meta: &yrs::MapRef,
    order: &yrs::ArrayRef,
    entries: &yrs::MapRef,
    payload: &InstanceResourcePayload,
) {
    match payload {
        InstanceResourcePayload::DirectoryPage(page) => {
            meta.insert(txn, "view_type", "fs_directory_page");
            meta.insert(txn, "path", page.path.clone());
            meta.insert(txn, "source_generation", page.source_generation.clone());
            insert_optional(meta, txn, "next_cursor", page.next_cursor.as_deref());
            for entry in &page.entries {
                order.push_back(txn, entry.id.clone());
                let item = entries.insert(txn, entry.id.clone(), yrs::MapPrelim::default());
                item.insert(txn, "id", entry.id.clone());
                item.insert(txn, "name", entry.name.clone());
                item.insert(txn, "path", entry.path.clone());
                item.insert(txn, "kind", format!("{:?}", entry.kind).to_lowercase());
                item.insert(txn, "size", entry.size.to_string());
                item.insert(txn, "mtime_ns", entry.mtime_ns.clone());
                item.insert(txn, "revision", entry.revision.clone());
            }
        }
        InstanceResourcePayload::RepositoriesPage(page) => {
            meta.insert(txn, "view_type", "workspace_repositories_page");
            meta.insert(txn, "source_generation", page.source_generation.clone());
            insert_optional(meta, txn, "next_cursor", page.next_cursor.as_deref());
            for repo in &page.repositories {
                order.push_back(txn, repo.repo_id.clone());
                let item = entries.insert(txn, repo.repo_id.clone(), yrs::MapPrelim::default());
                item.insert(txn, "repo_id", repo.repo_id.clone());
                item.insert(txn, "root", repo.root.clone());
                item.insert(txn, "name", repo.name.clone());
            }
        }
        InstanceResourcePayload::GitRepository(repo) => {
            meta.insert(txn, "view_type", "git_repository");
            meta.insert(txn, "repo_id", repo.repo_id.clone());
            meta.insert(txn, "root", repo.root.clone());
            meta.insert(txn, "source_generation", repo.generation.clone());
            insert_optional(meta, txn, "head_name", repo.head_name.as_deref());
            insert_optional(meta, txn, "head_oid", repo.head_oid.as_deref());
            insert_optional(meta, txn, "upstream", repo.upstream.as_deref());
            meta.insert(txn, "detached", repo.detached);
            meta.insert(txn, "ahead", repo.ahead);
            meta.insert(txn, "behind", repo.behind);
            for group in &repo.groups {
                let id = group_id(group.id);
                order.push_back(txn, id);
                let item = entries.insert(txn, id, yrs::MapPrelim::default());
                item.insert(txn, "id", id);
                item.insert(txn, "count", group.count);
                item.insert(txn, "revision", group.revision.clone());
            }
        }
        InstanceResourcePayload::GitGroupPage(page) => {
            meta.insert(txn, "view_type", "git_group_page");
            meta.insert(txn, "repo_id", page.repo_id.clone());
            meta.insert(txn, "group_id", group_id(page.group_id));
            meta.insert(txn, "source_generation", page.source_generation.clone());
            insert_optional(meta, txn, "next_cursor", page.next_cursor.as_deref());
            for change in &page.changes {
                order.push_back(txn, change.change_id.clone());
                let item = entries.insert(txn, change.change_id.clone(), yrs::MapPrelim::default());
                item.insert(txn, "change_id", change.change_id.clone());
                item.insert(txn, "path", change.path.clone());
                insert_optional(&item, txn, "original_path", change.original_path.as_deref());
                item.insert(txn, "status", change_status(change.status));
            }
        }
        InstanceResourcePayload::Blob(_) | InstanceResourcePayload::Mutation(_) => {
            meta.insert(txn, "view_type", "blob");
        }
    }
}

fn insert_optional(
    map: &yrs::MapRef,
    txn: &mut yrs::TransactionMut<'_>,
    key: &str,
    value: Option<&str>,
) {
    match value {
        Some(value) => map.insert(txn, key, value),
        None => map.insert(txn, key, yrs::Any::Null),
    };
}

fn group_id(id: GitGroupId) -> &'static str {
    match id {
        GitGroupId::Conflicts => "conflicts",
        GitGroupId::Index => "index",
        GitGroupId::WorkingTree => "working_tree",
        GitGroupId::Untracked => "untracked",
    }
}

fn change_status(status: GitChangeStatus) -> &'static str {
    match status {
        GitChangeStatus::Added => "added",
        GitChangeStatus::Modified => "modified",
        GitChangeStatus::Deleted => "deleted",
        GitChangeStatus::Renamed => "renamed",
        GitChangeStatus::Copied => "copied",
        GitChangeStatus::Untracked => "untracked",
        GitChangeStatus::Ignored => "ignored",
        GitChangeStatus::Conflict => "conflict",
        GitChangeStatus::TypeChanged => "type_changed",
    }
}

fn failure(code: ResourceErrorCode, message: &str, retryable: bool) -> ResourceFailure {
    ResourceFailure {
        code,
        message: message.to_string(),
        retryable,
    }
}

#[cfg(test)]
#[path = "resource_projection_test.rs"]
mod resource_projection_test;
