//! AuthService（§4.5–§4.7）：instance 双向认证（HMAC challenge-response）+
//! client 单向认证 + 浏览器 cookie 会话 + 连接身份上下文。
//!
//! 服务端时序（§4.5）：nonce 解码 → 防重放（**先于 token 校验**，认证失败
//! 的 nonce 同样登记，防「失败后重放成功路径」）→ token 校验 → 生成
//! connection_context → HKDF 派生密钥 → 计算 MAC → 下发 auth_response。
//! 权威时钟在 server（[`std::time::Instant`]）。

use std::collections::HashMap;
use std::net::SocketAddr;
use std::time::Instant;

use base64::Engine as _;
use chrono::{DateTime, Utc};
use rand::Rng as _;

use peri_studio_proto::conn::{Auth, AuthResponse};
use peri_studio_proto::hmac::{
    compute_mac, derive_mac_key, generate_connection_context, mac_input, CHALLENGE_NONCE_LEN,
};
use peri_studio_proto::instance::InstanceHello;
use peri_studio_proto::version::PROTOCOL_VERSION;
use peri_studio_proto::whitelist::Role;

use crate::auth::audit::audit;
use crate::auth::nonce::NonceRegistry;
use crate::auth::stats::AuthStats;
use crate::auth::token::TokenStore;
use crate::auth::{
    AuthError, NonceVerdict, TokenRecord, TokenRole, BROWSER_SESSION_CAPACITY, BROWSER_SESSION_TTL,
    UNKNOWN_TOKEN_ID,
};

// ---------------------------------------------------------------------------

/// 认证通过后的连接身份上下文（gateway F5 持有，贯穿连接生命周期）。
#[derive(Debug, Clone)]
pub struct ConnectionCtx {
    /// 身份：token_id（审计/吊销引用键）。
    pub token_id: String,
    /// 身份级角色（§9.5：token 即身份）。
    pub role: TokenRole,
    /// TokenRecord.name。
    pub name: String,
    /// 绑定信息：远端地址（非回环拒绝判定输入，§3.7）。
    pub peer: SocketAddr,
    /// 绑定信息：instance 专属（hello.hostname）。
    pub hostname: Option<String>,
    /// 建立时间。
    pub established_at: DateTime<Utc>,
}

impl ConnectionCtx {
    /// 线级连接角色（§4.1 映射，`whitelist::Role`）。
    pub fn wire_role(&self) -> Role {
        self.role.wire_role()
    }

    /// 是否可发 Action（instance/full 可；read-only 不可，M1 即强制，§9.2.2）。
    pub fn can_send_action(&self) -> bool {
        self.role.can_send_action()
    }
}

/// instance 认证成功产物：连接上下文 + 待 gateway 下发的 auth_response。
#[derive(Debug, Clone)]
pub struct InstanceAuthOk {
    /// 连接身份上下文。
    pub ctx: ConnectionCtx,
    /// `auth_response` 载荷（`{ connection_context: b64, hmac: b64 }`，§9.2 步骤 2）。
    pub response: AuthResponse,
}

/// 认证服务：instance 双向认证（§9.2）+ client 单向认证（§4.6）。
///
/// 服务端时序（§4.5）：nonce 解码 → 防重放（**先于 token 校验**，认证失败
/// 的 nonce 同样登记，防「失败后重放成功路径」）→ token 校验 → 生成
/// connection_context → HKDF 派生密钥 → 计算 MAC → 下发 auth_response。
/// 权威时钟在 server（[`Instant`]）。
pub struct AuthService {
    store: TokenStore,
    nonces: NonceRegistry,
    stats: AuthStats,
    browser_sessions: HashMap<String, BrowserSession>,
}

#[derive(Clone)]
struct BrowserSession {
    token_id: String,
    expires_at: Instant,
}

impl AuthService {
    /// 以已加载的 [`TokenStore`] 构建（nonce 注册表与失败计数初始为空）。
    pub fn new(store: TokenStore) -> Self {
        AuthService {
            store,
            nonces: NonceRegistry::new(),
            stats: AuthStats::default(),
            browser_sessions: HashMap::new(),
        }
    }

    pub fn create_browser_session(
        &mut self,
        bearer: &str,
    ) -> Result<(String, ConnectionCtx), AuthError> {
        self.sweep_browser_sessions();
        let record = self.store.validate_client(bearer)?;
        if self.browser_sessions.len() >= BROWSER_SESSION_CAPACITY {
            if let Some(oldest) = self
                .browser_sessions
                .iter()
                .min_by_key(|(_, s)| s.expires_at)
                .map(|(id, _)| id.clone())
            {
                self.browser_sessions.remove(&oldest);
            }
        }
        let mut raw = [0u8; 32];
        rand::rng().fill_bytes(&mut raw);
        let id = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(raw);
        self.browser_sessions.insert(
            id.clone(),
            BrowserSession {
                token_id: record.id.clone(),
                expires_at: Instant::now() + BROWSER_SESSION_TTL,
            },
        );
        Ok((id, browser_ctx(record, "127.0.0.1:0".parse().unwrap())))
    }

    pub fn validate_browser_session(
        &mut self,
        id: &str,
        peer: SocketAddr,
    ) -> Result<ConnectionCtx, AuthError> {
        self.sweep_browser_sessions();
        let token_id = self
            .browser_sessions
            .get(id)
            .ok_or(AuthError::UnknownToken)?
            .token_id
            .clone();
        let record = self.store.validate_client_id(&token_id)?;
        Ok(browser_ctx(record, peer))
    }

    pub fn delete_browser_session(&mut self, id: &str) -> bool {
        self.browser_sessions.remove(id).is_some()
    }
    pub fn revalidate_client_identity(
        &mut self,
        token_id: &str,
        expected_role: TokenRole,
    ) -> Result<(), AuthError> {
        let record = self.store.validate_client_id(token_id)?;
        if record.role != expected_role {
            return Err(AuthError::RoleMismatch {
                token_id: token_id.to_string(),
            });
        }
        Ok(())
    }
    pub fn revalidate_instance_identity(&mut self, token_id: &str) -> Result<(), AuthError> {
        self.store.maybe_reload();
        match self.store.records.iter().find(|r| r.id == token_id) {
            Some(r) if !r.revoked && r.role == TokenRole::Instance => Ok(()),
            Some(r) if r.revoked => Err(AuthError::RevokedToken {
                token_id: token_id.to_string(),
            }),
            Some(_) => Err(AuthError::RoleMismatch {
                token_id: token_id.to_string(),
            }),
            None => Err(AuthError::UnknownToken),
        }
    }
    fn sweep_browser_sessions(&mut self) {
        let now = Instant::now();
        self.browser_sessions.retain(|_, s| s.expires_at > now);
    }

    /// 失败计数视图（审计/指标聚合）。
    pub fn stats(&self) -> &AuthStats {
        &self.stats
    }

    /// 底层 store（bootstrap/运维操作）。
    pub fn store_mut(&mut self) -> &mut TokenStore {
        &mut self.store
    }

    /// nonce 注册表（F5 gateway 周期任务与心跳同 tick 调 `sweep`，§4.4）。
    pub fn nonces_mut(&mut self) -> &mut NonceRegistry {
        &mut self.nonces
    }

    /// instance 连接认证（§9.2 步骤 1–2，服务端身份证明）。
    ///
    /// 签名保持 async 与设计文档一致（F5 装配后可引入 IO）；当前实现无
    /// await 点。
    #[allow(clippy::unused_async)]
    pub async fn authenticate_instance(
        &mut self,
        hello: &InstanceHello,
        peer: SocketAddr,
    ) -> Result<InstanceAuthOk, AuthError> {
        let start = Instant::now();
        // 版本协商先于 nonce/token：旧 binary（字段缺失 => 0）得到明确升级
        // 诊断，且不会消耗 nonce 或探测任何 credential 状态。
        if hello.protocol_version != PROTOCOL_VERSION {
            return Err(self.fail_auth(
                "auth.instance",
                None,
                AuthError::ProtocolVersionMismatch {
                    received: hello.protocol_version,
                    expected: PROTOCOL_VERSION,
                },
                start,
            ));
        }
        // 1. nonce: base64 解码 → [u8; 32]（失败 → BadNonceEncoding）。
        let nonce = match decode_nonce(&hello.nonce) {
            Ok(n) => n,
            Err(e) => return Err(self.fail_auth("auth.instance", None, e, start)),
        };
        // 2. 防重放（token 校验之前，§4.4）。
        match self.nonces.check_and_mark(&nonce, Instant::now()) {
            NonceVerdict::Accepted => {}
            NonceVerdict::Replay => {
                return Err(self.fail_auth("auth.instance", None, AuthError::ReplayNonce, start))
            }
        }
        // 3. token 校验（角色必须为 Instance）。
        let record = match self.store.validate(&hello.token, TokenRole::Instance) {
            Ok(r) => r,
            Err(e) => {
                let tid = e.token_id().map(ToOwned::to_owned);
                return Err(self.fail_auth("auth.instance", tid.as_deref(), e, start));
            }
        };
        // 4–7. connection_context + 派生密钥 + MAC（复用 proto 原语）。
        let token_bytes: [u8; 32] = base64::engine::general_purpose::STANDARD
            .decode(&record.token)
            .expect("token 加载时已断言 44 字符 base64")
            .try_into()
            .expect("44 字符 base64 解码为 32B");
        let context = generate_connection_context();
        let key = derive_mac_key(&token_bytes, TokenRole::Instance.as_str());
        let input = mac_input(
            &nonce,
            &context,
            &PROTOCOL_VERSION.to_string(),
            TokenRole::Instance.as_str(),
        );
        let hmac = compute_mac(&key, &input);
        let ctx = ConnectionCtx {
            token_id: record.id.clone(),
            role: record.role,
            name: record.name.clone(),
            peer,
            hostname: Some(hello.hostname.clone()),
            established_at: Utc::now(),
        };
        audit(
            "auth.instance",
            None,
            Some(&record.id),
            "ok",
            start.elapsed(),
            None,
        );
        Ok(InstanceAuthOk {
            ctx,
            response: AuthResponse {
                connection_context: base64::engine::general_purpose::STANDARD.encode(context),
                hmac: base64::engine::general_purpose::STANDARD.encode(hmac),
            },
        })
    }

    /// client 连接认证（单向，`auth` 帧，§4.6）。
    ///
    /// client 无 HMAC（§9.2 明示仅覆盖 instance 连接）；read-only 的帧级写
    /// 限制由 gateway 用 [`ConnectionCtx::can_send_action`] 强制（§5）。
    #[allow(clippy::unused_async)]
    pub async fn authenticate_client(
        &mut self,
        auth: &Auth,
        peer: SocketAddr,
    ) -> Result<ConnectionCtx, AuthError> {
        let start = Instant::now();
        let record = match self.store.validate_client(&auth.token) {
            Ok(r) => r,
            Err(e) => {
                let tid = e.token_id().map(ToOwned::to_owned);
                return Err(self.fail_auth("auth.client", tid.as_deref(), e, start));
            }
        };
        let ctx = ConnectionCtx {
            token_id: record.id.clone(),
            role: record.role,
            name: record.name.clone(),
            peer,
            hostname: None,
            established_at: Utc::now(),
        };
        audit(
            "auth.client",
            None,
            Some(&record.id),
            "ok",
            start.elapsed(),
            None,
        );
        Ok(ctx)
    }

    /// 失败路径统一处理：计数（未知 token → [`UNKNOWN_TOKEN_ID`]）+ 审计
    /// `auth.* failed`（携带 `auth_failed_total` 快照，§4.8）+ 原样返回错误
    /// （不静默，§9.2 失败语义）。
    fn fail_auth(
        &self,
        action: &str,
        token_id: Option<&str>,
        err: AuthError,
        start: Instant,
    ) -> AuthError {
        let key = token_id.unwrap_or(UNKNOWN_TOKEN_ID);
        self.stats.record_failure(key);
        audit(
            action,
            None,
            Some(key),
            err.result_key(),
            start.elapsed(),
            Some(self.stats.total_failures()),
        );
        err
    }
}

fn browser_ctx(record: TokenRecord, peer: SocketAddr) -> ConnectionCtx {
    ConnectionCtx {
        token_id: record.id,
        role: record.role,
        name: record.name,
        peer,
        hostname: None,
        established_at: Utc::now(),
    }
}

/// nonce 解码：base64 → [u8; 32]（失败 → [`AuthError::BadNonceEncoding`]）。
fn decode_nonce(s: &str) -> Result<[u8; CHALLENGE_NONCE_LEN], AuthError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(s)
        .map_err(|_| AuthError::BadNonceEncoding)?;
    bytes.try_into().map_err(|_| AuthError::BadNonceEncoding)
}
