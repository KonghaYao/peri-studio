//! 有界上传 ticket 状态机。
//!
//! ticket 只保存 server 可信的 principal/project/path 绑定和至多 8 MiB staging
//! 字节；HTTP 与 action 层只能通过本模块推进状态，不能直接读取内部 map。

use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex, Weak};
use std::time::Duration;

use chrono::{Duration as ChronoDuration, Utc};
use sha2::{Digest, Sha256};
use tokio::sync::Mutex;
use tokio::time::Instant;

use peri_studio_proto::resource::{
    ResourceErrorCode, ResourceFailure, ResourceUploadOpened, DEFAULT_UPLOAD_TICKET_TTL_SECS,
    MAX_CONCURRENT_UPLOADS_PER_PRINCIPAL, MAX_RESOURCE_BLOB_BYTES,
};

const EXPIRED_TOMBSTONE_TTL_SECS: u64 = 60;
const MAX_UPLOAD_STAGING_BYTES: usize = 256 * 1024 * 1024;
const MAX_CONCURRENT_UPLOADS_GLOBAL: usize =
    MAX_UPLOAD_STAGING_BYTES / MAX_RESOURCE_BLOB_BYTES as usize;

#[derive(Clone)]
pub(crate) struct UploadStore {
    inner: Arc<Mutex<HashMap<String, UploadTicket>>>,
    quota: Arc<StdMutex<UploadQuota>>,
}

#[derive(Debug)]
struct UploadQuota {
    reserved_bytes: usize,
    reserved_slots: usize,
    max_bytes: usize,
    max_slots: usize,
}

#[derive(Debug)]
struct UploadReservation {
    bytes: usize,
    quota: Arc<StdMutex<UploadQuota>>,
}

impl Drop for UploadReservation {
    fn drop(&mut self) {
        let mut quota = self.quota.lock().expect("upload quota mutex poisoned");
        quota.reserved_bytes = quota
            .reserved_bytes
            .checked_sub(self.bytes)
            .expect("upload byte reservation underflow");
        quota.reserved_slots = quota
            .reserved_slots
            .checked_sub(1)
            .expect("upload slot reservation underflow");
    }
}

#[derive(Debug, Clone)]
struct UploadTicket {
    principal: String,
    owner_conn: u64,
    project_id: String,
    path: String,
    expected_bytes: Option<u64>,
    sha256: Option<String>,
    expires_at: Instant,
    reservation: Option<Arc<UploadReservation>>,
    state: UploadState,
}

#[derive(Debug, Clone)]
enum UploadState {
    Open,
    Putting,
    Ready(Arc<Vec<u8>>),
    Committing(Arc<Vec<u8>>),
    Consumed,
    Failed(ResourceErrorCode),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum UploadStoreError {
    NotFound,
    Expired,
    TooLarge,
    RateLimited,
    AlreadyComplete,
    AlreadyConsumed,
    InvalidState,
    LengthMismatch,
    ChecksumMismatch,
    BindingMismatch,
}

#[derive(Debug, Clone)]
pub(crate) struct UploadCommit {
    pub project_id: String,
    pub path: String,
    pub bytes: Arc<Vec<u8>>,
    _reservation: Arc<UploadReservation>,
}

impl UploadStore {
    pub(crate) fn new() -> Self {
        Self::with_limits(MAX_UPLOAD_STAGING_BYTES, MAX_CONCURRENT_UPLOADS_GLOBAL)
    }

    fn with_limits(max_bytes: usize, max_slots: usize) -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
            quota: Arc::new(StdMutex::new(UploadQuota {
                reserved_bytes: 0,
                reserved_slots: 0,
                max_bytes,
                max_slots,
            })),
        }
    }

    pub(crate) async fn open(
        &self,
        principal: &str,
        owner_conn: u64,
        project_id: &str,
        path: &str,
        expected_bytes: Option<u64>,
        sha256: Option<String>,
    ) -> Result<ResourceUploadOpened, UploadStoreError> {
        if expected_bytes.is_some_and(|size| size > MAX_RESOURCE_BLOB_BYTES) {
            return Err(UploadStoreError::TooLarge);
        }
        let now = Instant::now();
        let mut tickets = self.inner.lock().await;
        purge_old_tombstones(&mut tickets, now);
        let principal_slots = tickets
            .values()
            .filter(|ticket| ticket.principal == principal && ticket.expires_at > now)
            .filter(|ticket| {
                !matches!(ticket.state, UploadState::Consumed | UploadState::Failed(_))
            })
            .count();
        if principal_slots >= MAX_CONCURRENT_UPLOADS_PER_PRINCIPAL as usize {
            return Err(UploadStoreError::RateLimited);
        }
        let upload_id = uuid::Uuid::new_v4().to_string();
        let ttl = Duration::from_secs(DEFAULT_UPLOAD_TICKET_TTL_SECS);
        let expires_at = now + ttl;
        tickets.insert(
            upload_id.clone(),
            UploadTicket {
                principal: principal.to_string(),
                owner_conn,
                project_id: project_id.to_string(),
                path: path.to_string(),
                expected_bytes,
                sha256,
                expires_at,
                reservation: None,
                state: UploadState::Open,
            },
        );
        drop(tickets);
        schedule_expiry(Arc::downgrade(&self.inner), upload_id.clone(), expires_at);
        let wall_expiry =
            Utc::now() + ChronoDuration::seconds(DEFAULT_UPLOAD_TICKET_TTL_SECS as i64);
        Ok(ResourceUploadOpened {
            upload_id: upload_id.clone(),
            url: format!("/api/resource-uploads/{upload_id}"),
            expires_at: wall_expiry.to_rfc3339(),
        })
    }

    pub(crate) async fn begin_put(
        &self,
        principal: &str,
        upload_id: &str,
        content_length: usize,
    ) -> Result<(), UploadStoreError> {
        if content_length > MAX_RESOURCE_BLOB_BYTES as usize {
            return Err(UploadStoreError::TooLarge);
        }
        let now = Instant::now();
        let mut tickets = self.inner.lock().await;
        let Some(ticket) = tickets.get_mut(upload_id) else {
            return Err(UploadStoreError::NotFound);
        };
        authorize(ticket, principal, now)?;
        if ticket
            .expected_bytes
            .is_some_and(|size| size != content_length as u64)
        {
            fail_ticket(ticket, ResourceErrorCode::InvalidRequest);
            return Err(UploadStoreError::LengthMismatch);
        }
        match ticket.state {
            UploadState::Open => {}
            UploadState::Ready(_) | UploadState::Putting => {
                return Err(UploadStoreError::AlreadyComplete);
            }
            UploadState::Committing(_) | UploadState::Consumed => {
                return Err(UploadStoreError::AlreadyConsumed);
            }
            UploadState::Failed(code) => return Err(error_for_failed(code)),
        }
        let reservation = reserve(&self.quota, content_length)?;
        ticket.reservation = Some(reservation);
        ticket.state = UploadState::Putting;
        Ok(())
    }

    pub(crate) async fn complete_put(
        &self,
        principal: &str,
        upload_id: &str,
        bytes: Vec<u8>,
    ) -> Result<(), UploadStoreError> {
        let now = Instant::now();
        let mut tickets = self.inner.lock().await;
        let Some(ticket) = tickets.get_mut(upload_id) else {
            return Err(UploadStoreError::NotFound);
        };
        authorize(ticket, principal, now)?;
        if !matches!(ticket.state, UploadState::Putting) {
            return Err(UploadStoreError::InvalidState);
        }
        let reserved_bytes = ticket
            .reservation
            .as_ref()
            .map_or(0, |reservation| reservation.bytes);
        if bytes.len() != reserved_bytes
            || bytes.len() > MAX_RESOURCE_BLOB_BYTES as usize
            || ticket
                .expected_bytes
                .is_some_and(|size| size != bytes.len() as u64)
        {
            fail_ticket(ticket, ResourceErrorCode::InvalidRequest);
            return Err(UploadStoreError::LengthMismatch);
        }
        if let Some(expected) = ticket.sha256.as_deref() {
            let actual = format!("{:x}", Sha256::digest(&bytes));
            if !actual.eq_ignore_ascii_case(expected) {
                fail_ticket(ticket, ResourceErrorCode::UploadChecksumMismatch);
                return Err(UploadStoreError::ChecksumMismatch);
            }
        }
        ticket.state = UploadState::Ready(Arc::new(bytes));
        Ok(())
    }

    pub(crate) async fn abort_put(&self, principal: &str, upload_id: &str) {
        let mut tickets = self.inner.lock().await;
        if tickets.get(upload_id).is_some_and(|ticket| {
            ticket.principal == principal && matches!(ticket.state, UploadState::Putting)
        }) {
            tickets.remove(upload_id);
        }
    }

    pub(crate) async fn begin_commit(
        &self,
        principal: &str,
        project_id: &str,
        path: &str,
        upload_id: &str,
    ) -> Result<UploadCommit, UploadStoreError> {
        let now = Instant::now();
        let mut tickets = self.inner.lock().await;
        let Some(ticket) = tickets.get_mut(upload_id) else {
            return Err(UploadStoreError::NotFound);
        };
        authorize(ticket, principal, now)?;
        if ticket.project_id != project_id || ticket.path != path {
            return Err(UploadStoreError::BindingMismatch);
        }
        match &ticket.state {
            UploadState::Ready(bytes) => {
                let bytes = bytes.clone();
                let reservation = ticket
                    .reservation
                    .as_ref()
                    .expect("ready upload must retain its reservation")
                    .clone();
                ticket.state = UploadState::Committing(bytes.clone());
                Ok(UploadCommit {
                    project_id: ticket.project_id.clone(),
                    path: ticket.path.clone(),
                    bytes,
                    _reservation: reservation,
                })
            }
            UploadState::Open | UploadState::Putting => Err(UploadStoreError::InvalidState),
            UploadState::Committing(_) | UploadState::Consumed => {
                Err(UploadStoreError::AlreadyConsumed)
            }
            UploadState::Failed(code) => Err(error_for_failed(*code)),
        }
    }

    pub(crate) async fn finish_commit(&self, upload_id: &str, committed: bool) {
        let mut tickets = self.inner.lock().await;
        let Some(ticket) = tickets.get_mut(upload_id) else {
            return;
        };
        let UploadState::Committing(bytes) = &ticket.state else {
            return;
        };
        if committed {
            ticket.state = UploadState::Consumed;
            ticket.reservation = None;
        } else {
            ticket.state = UploadState::Ready(bytes.clone());
        }
    }

    pub(crate) async fn cleanup_connection(&self, owner_conn: u64) {
        self.inner
            .lock()
            .await
            .retain(|_, ticket| ticket.owner_conn != owner_conn);
    }

    #[cfg(test)]
    fn quota_usage(&self) -> (usize, usize) {
        let quota = self.quota.lock().expect("upload quota mutex poisoned");
        (quota.reserved_bytes, quota.reserved_slots)
    }
}

fn reserve(
    quota: &Arc<StdMutex<UploadQuota>>,
    bytes: usize,
) -> Result<Arc<UploadReservation>, UploadStoreError> {
    let mut current = quota.lock().expect("upload quota mutex poisoned");
    if current.reserved_slots >= current.max_slots
        || current
            .reserved_bytes
            .checked_add(bytes)
            .is_none_or(|total| total > current.max_bytes)
    {
        return Err(UploadStoreError::RateLimited);
    }
    current.reserved_bytes += bytes;
    current.reserved_slots += 1;
    drop(current);
    Ok(Arc::new(UploadReservation {
        bytes,
        quota: quota.clone(),
    }))
}

fn schedule_expiry(
    inner: Weak<Mutex<HashMap<String, UploadTicket>>>,
    upload_id: String,
    expires_at: Instant,
) {
    tokio::spawn(async move {
        tokio::time::sleep_until(expires_at).await;
        let Some(inner) = inner.upgrade() else {
            return;
        };
        {
            let mut tickets = inner.lock().await;
            if let Some(ticket) = tickets
                .get_mut(&upload_id)
                .filter(|ticket| ticket.expires_at == expires_at)
            {
                expire_ticket(ticket);
            }
        }
        tokio::time::sleep_until(expires_at + Duration::from_secs(EXPIRED_TOMBSTONE_TTL_SECS))
            .await;
        let mut tickets = inner.lock().await;
        if tickets
            .get(&upload_id)
            .is_some_and(|ticket| ticket.expires_at == expires_at)
        {
            tickets.remove(&upload_id);
        }
    });
}

fn authorize(
    ticket: &mut UploadTicket,
    principal: &str,
    now: Instant,
) -> Result<(), UploadStoreError> {
    if ticket.principal != principal {
        return Err(UploadStoreError::NotFound);
    }
    if ticket.expires_at <= now {
        expire_ticket(ticket);
        return Err(UploadStoreError::Expired);
    }
    Ok(())
}

fn fail_ticket(ticket: &mut UploadTicket, code: ResourceErrorCode) {
    ticket.state = UploadState::Failed(code);
    ticket.reservation = None;
}

fn expire_ticket(ticket: &mut UploadTicket) {
    if !matches!(ticket.state, UploadState::Consumed | UploadState::Failed(_)) {
        fail_ticket(ticket, ResourceErrorCode::UploadExpired);
    }
}

fn purge_old_tombstones(tickets: &mut HashMap<String, UploadTicket>, now: Instant) {
    for ticket in tickets.values_mut() {
        if ticket.expires_at <= now {
            expire_ticket(ticket);
        }
    }
    let tombstone_ttl = Duration::from_secs(EXPIRED_TOMBSTONE_TTL_SECS);
    tickets.retain(|_, ticket| ticket.expires_at + tombstone_ttl > now);
}

fn error_for_failed(code: ResourceErrorCode) -> UploadStoreError {
    match code {
        ResourceErrorCode::UploadExpired => UploadStoreError::Expired,
        ResourceErrorCode::UploadChecksumMismatch => UploadStoreError::ChecksumMismatch,
        _ => UploadStoreError::InvalidState,
    }
}

pub(crate) fn store_failure(error: UploadStoreError) -> ResourceFailure {
    let (code, message, retryable) = match error {
        UploadStoreError::NotFound => (ResourceErrorCode::NotFound, "upload was not found", false),
        UploadStoreError::Expired => (ResourceErrorCode::UploadExpired, "upload expired", false),
        UploadStoreError::TooLarge => (
            ResourceErrorCode::UploadTooLarge,
            "upload exceeds the 8 MiB limit",
            false,
        ),
        UploadStoreError::RateLimited => (
            ResourceErrorCode::RateLimited,
            "upload capacity reached",
            true,
        ),
        UploadStoreError::AlreadyComplete => (
            ResourceErrorCode::UploadAlreadyComplete,
            "upload body was already submitted",
            false,
        ),
        UploadStoreError::AlreadyConsumed => (
            ResourceErrorCode::UploadAlreadyConsumed,
            "upload was already consumed",
            false,
        ),
        UploadStoreError::InvalidState => (
            ResourceErrorCode::InvalidRequest,
            "upload is not ready",
            false,
        ),
        UploadStoreError::LengthMismatch => (
            ResourceErrorCode::InvalidRequest,
            "upload length does not match",
            false,
        ),
        UploadStoreError::ChecksumMismatch => (
            ResourceErrorCode::UploadChecksumMismatch,
            "upload checksum does not match",
            false,
        ),
        UploadStoreError::BindingMismatch => (
            ResourceErrorCode::Forbidden,
            "upload binding does not match",
            false,
        ),
    };
    ResourceFailure {
        code,
        message: message.to_string(),
        retryable,
        suggested_limit: None,
    }
}

#[cfg(test)]
#[path = "resource_upload_store_test.rs"]
mod tests;
