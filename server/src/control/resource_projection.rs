//! 短租约远程资源 Yjs 投影。
//!
//! instance 返回普通 DTO；本模块是唯一将 DTO 写入 `resource:{view_id}` Doc
//! 的 server writer，并同时拥有 principal 授权与生命周期回收。

use std::collections::{HashMap, HashSet};
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
    subscribers: HashSet<u64>,
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
        let projection = Self {
            sink,
            leases: Arc::new(Mutex::new(HashMap::new())),
            lease_ttl,
            max_views_per_principal,
        };
        projection.spawn_lease_sweeper();
        projection
    }

    /// 发布一次 instance 查询结果并签发 principal 绑定的 Doc 租约。
    pub async fn publish(
        &self,
        principal: &str,
        project_id: &str,
        payload: &InstanceResourcePayload,
    ) -> Result<ResourceViewOpened, ResourceFailure> {
        let now = Utc::now();
        self.sweep_expired(now).await;
        let expires_at = now
            + chrono::Duration::from_std(self.lease_ttl)
                .unwrap_or_else(|_| chrono::Duration::minutes(1));
        let view_id = uuid::Uuid::new_v4().to_string();
        let doc_id = DocId::resource(&view_id);
        let update = build_update(&view_id, project_id, payload);
        let persist_failed = {
            let mut leases = self.leases.lock().await;
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
            leases.insert(
                doc_id.clone(),
                ResourceLease {
                    principal: principal.to_string(),
                    expires_at,
                    subscribers: HashSet::new(),
                },
            );
            // 授权、过期回收与首个快照发布共用该临界区，避免短 TTL
            // 在 persist 完成前回收 lease，随后留下无主 Doc。
            let failed = self
                .sink
                .persist_update(doc_id.clone(), update)
                .await
                .is_err();
            if failed {
                leases.remove(&doc_id);
            }
            failed
        };
        if persist_failed {
            self.sink.remove_resource_doc(&doc_id).await;
            return Err(failure(
                ResourceErrorCode::Unavailable,
                "resource projection unavailable",
                true,
            ));
        }
        Ok(ResourceViewOpened {
            view_id,
            doc_id,
            lease_expires_at: expires_at.to_rfc3339(),
        })
    }

    pub async fn authorize(&self, principal: &str, doc: &DocId) -> bool {
        let now = Utc::now();
        self.sweep_expired(now).await;
        self.leases
            .lock()
            .await
            .get(doc)
            .is_some_and(|lease| lease.principal == principal)
    }

    /// 授权并登记活跃连接；有订阅者的 view 不进入 TTL 回收。
    pub async fn subscribe(&self, principal: &str, conn_id: u64, doc: &DocId) -> bool {
        let now = Utc::now();
        self.sweep_expired(now).await;
        let mut leases = self.leases.lock().await;
        let Some(lease) = leases
            .get_mut(doc)
            .filter(|lease| lease.principal == principal)
        else {
            return false;
        };
        lease.subscribers.insert(conn_id);
        true
    }

    /// 连接退订后，最后一个订阅者离开才开始短 TTL。
    pub async fn unsubscribe(&self, conn_id: u64, docs: &[DocId]) {
        let expires_at = lease_deadline(Utc::now(), self.lease_ttl);
        let mut leases = self.leases.lock().await;
        for doc in docs {
            if let Some(lease) = leases.get_mut(doc) {
                lease.subscribers.remove(&conn_id);
                if lease.subscribers.is_empty() {
                    lease.expires_at = expires_at;
                }
            }
        }
    }

    /// 连接断开等同于它对全部资源 Doc 的退订。
    pub async fn disconnect(&self, conn_id: u64) {
        let expires_at = lease_deadline(Utc::now(), self.lease_ttl);
        let mut leases = self.leases.lock().await;
        for lease in leases.values_mut() {
            if lease.subscribers.remove(&conn_id) && lease.subscribers.is_empty() {
                lease.expires_at = expires_at;
            }
        }
    }

    pub async fn release(&self, principal: &str, view_id: &str) -> bool {
        self.sweep_expired(Utc::now()).await;
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

    async fn sweep_expired(&self, now: DateTime<Utc>) {
        sweep_expired_parts(&self.sink, &self.leases, now).await;
    }

    fn spawn_lease_sweeper(&self) {
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            return;
        };
        let sink = Arc::downgrade(&self.sink);
        let leases = Arc::downgrade(&self.leases);
        let interval = self
            .lease_ttl
            .clamp(Duration::from_millis(10), Duration::from_secs(30));
        runtime.spawn(async move {
            loop {
                tokio::time::sleep(interval).await;
                let (Some(sink), Some(leases)) = (sink.upgrade(), leases.upgrade()) else {
                    break;
                };
                sweep_expired_parts(&sink, &leases, Utc::now()).await;
            }
        });
    }
}

async fn sweep_expired_parts(
    sink: &StoreSink,
    leases: &Mutex<HashMap<DocId, ResourceLease>>,
    now: DateTime<Utc>,
) {
    let expired = {
        let mut leases = leases.lock().await;
        let expired = leases
            .iter()
            .filter(|(_, lease)| lease.subscribers.is_empty() && lease.expires_at <= now)
            .map(|(doc, _)| doc.clone())
            .collect::<Vec<_>>();
        for doc in &expired {
            leases.remove(doc);
        }
        expired
    };
    for doc in expired {
        sink.remove_resource_doc(&doc).await;
    }
}

fn lease_deadline(now: DateTime<Utc>, ttl: Duration) -> DateTime<Utc> {
    now + chrono::Duration::from_std(ttl).unwrap_or_else(|_| chrono::Duration::minutes(1))
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
    id.as_str()
}

fn change_status(status: GitChangeStatus) -> &'static str {
    status.as_str()
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
