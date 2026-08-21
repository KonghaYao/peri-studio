//! 认证/授权模块（Feature F2）：token 模型、TokenStore、instance 双向认证
//! （HMAC challenge-response，§9.2）、连接身份上下文（§9.5）。
//!
//! 复用 `peri-studio-proto` 密码原语（`hmac.rs`），不重复实现：nonce/session
//! context 生成、HKDF 密钥派生、MAC 输入规范化、常量时间 MAC 校验。
//!
//! 脱敏纪律（§9.3）：token 本体/nonce/派生密钥/HMAC 输出永不进入日志、
//! 审计、错误 Display（本模块内仅 [`TokenRecord.token`] 持有，落 0600 文件）。

pub mod audit;
mod credential;
mod nonce;
mod service;
mod stats;
mod token;
pub use credential::EnsuredInstanceCredential;
pub use nonce::{NonceRegistry, NonceVerdict};
pub use service::{AuthService, ConnectionCtx, InstanceAuthOk};
pub use stats::AuthStats;
pub use token::{StoreError, TokenStore};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use peri_studio_proto::whitelist::Role;

/// token 存储文件名（`<config_dir>/tokens.toml`，0600，§4.3.2）。
pub const TOKENS_FILE: &str = "tokens.toml";

/// token 文件格式版本（§4.3.1：`version = 1`，未来格式演进可迁移）。
pub const TOKENS_FILE_VERSION: u32 = 1;

/// token 本体长度：32B CSPRNG → base64 标准字母表 44 字符（§9.2.1）。
pub const TOKEN_B64_LEN: usize = 44;

/// 未知 token 的失败计数 key（§4.8：泄露检测依赖按 token_id 可查失败次数，
/// 未知 token 无 id，需与已知 token 的失败区分呈现）。
pub const UNKNOWN_TOKEN_ID: &str = "<unknown>";

/// bootstrap 自动生成 instance token 的名称（§3.3【决策】；§4.5 instance_id =
/// token name）。必须与 `channel::DEFAULT_MACHINE_ID`（"local"）一致：本机
/// bootstrap 机器即「缺省本机」路由目标（§4.3 P5），否则 client 不带
/// instanceId 的 create 会命中 `UnknownInstance("local")`（E3 链路断点）。
pub const BOOTSTRAP_INSTANCE_NAME: &str = "local";
pub const BROWSER_COOKIE: &str = "peri_studio_session";
pub(crate) const BROWSER_SESSION_TTL_SECS: u64 = 8 * 3600;
const BROWSER_SESSION_TTL: std::time::Duration =
    std::time::Duration::from_secs(BROWSER_SESSION_TTL_SECS);
const BROWSER_SESSION_CAPACITY: usize = 256;

// ---------------------------------------------------------------------------
// TokenRole（token 三级角色，§9.2.2 + §9.5）
// ---------------------------------------------------------------------------

/// token 三级角色。串行化为 kebab-case 字符串（tokens.toml / CLI）。
///
/// 与线级 [`Role`]（`whitelist::Role { Client, Instance }`）的映射唯一入口是
/// [`TokenRole::wire_role`]——read-only 与 full 在线级同属 Client，其写权限
/// 差异由 gateway 用 [`ConnectionCtx::can_send_action`] 在帧级强制（§5）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TokenRole {
    /// 收 spawn/kill 指令、上报事件/心跳（§9.2，双向认证）。
    Instance,
    /// client：读全部 Doc + 发 Action（TUI）。
    Full,
    /// client：仅读 yjs 状态与订阅事件流（M3 Web 面板，M1 预留档位）。
    ReadOnly,
}

impl TokenRole {
    /// 线级连接角色（`whitelist::Role`）：instance→Instance；full/read-only→Client。
    pub fn wire_role(self) -> Role {
        match self {
            TokenRole::Instance => Role::Instance,
            TokenRole::Full | TokenRole::ReadOnly => Role::Client,
        }
    }

    /// 是否可发 Action（instance/full 可；read-only 不可，M1 即强制，§9.2.2）。
    pub fn can_send_action(self) -> bool {
        !matches!(self, TokenRole::ReadOnly)
    }

    /// HMAC 派生 role 字符串（§9.2：仅 instance 走双向认证，取值恒为
    /// `"instance"`）；CLI/toml 的 kebab-case 形态。
    pub fn as_str(self) -> &'static str {
        match self {
            TokenRole::Instance => "instance",
            TokenRole::Full => "full",
            TokenRole::ReadOnly => "read-only",
        }
    }
}

impl std::fmt::Display for TokenRole {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for TokenRole {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "instance" => Ok(TokenRole::Instance),
            "full" => Ok(TokenRole::Full),
            "read-only" => Ok(TokenRole::ReadOnly),
            other => Err(format!(
                "非法角色 {other:?}（可选 instance/full/read-only）"
            )),
        }
    }
}

// ---------------------------------------------------------------------------
// TokenRecord / TokenInfo（§4.2）
// ---------------------------------------------------------------------------

/// 存储态记录（含 token 本体，仅内存与 0600 文件内存在）。
///
/// 脱敏纪律（§9.3）：**不派生 `Debug`**——`token` 本体是凭证材料，任何
/// `{:?}` 输出（日志/断言 panic）都会泄露；手写 `Debug` 只暴露
/// id/role/name/created_at/revoked，token 恒为 `"***"`（与 [`TokenInfo`]
/// 的「结构级不可外泄」保证对齐）。
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TokenRecord {
    /// uuid v4（视图/审计/吊销引用键）。
    pub id: String,
    /// token 角色。
    pub role: TokenRole,
    /// instance：hostname；client：运维命名（如「桌面 TUI」）。
    pub name: String,
    /// 32B CSPRNG，base64（44 字符，§9.2.1「32B CSPRNG」）。
    pub token: String,
    /// RFC3339。
    pub created_at: DateTime<Utc>,
    /// 吊销态（吊销即刻生效，§9.2.1）。
    pub revoked: bool,
}

impl std::fmt::Debug for TokenRecord {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TokenRecord")
            .field("id", &self.id)
            .field("role", &self.role)
            .field("name", &self.name)
            .field("token", &"***")
            .field("created_at", &self.created_at)
            .field("revoked", &self.revoked)
            .finish()
    }
}

/// 对外视图（§9.2.1：只暴露 token_id，**绝不暴露 token 本体**——结构级
/// 保证，编译期不可外泄）。
#[derive(Debug, Clone, PartialEq)]
pub struct TokenInfo {
    /// uuid v4。
    pub id: String,
    /// token 角色。
    pub role: TokenRole,
    /// 展示名。
    pub name: String,
    /// 签发时间（RFC3339）。
    pub created_at: DateTime<Utc>,
    /// 吊销态。
    pub revoked: bool,
}

impl From<&TokenRecord> for TokenInfo {
    fn from(r: &TokenRecord) -> Self {
        TokenInfo {
            id: r.id.clone(),
            role: r.role,
            name: r.name.clone(),
            created_at: r.created_at,
            revoked: r.revoked,
        }
    }
}

impl std::fmt::Display for TokenInfo {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{:<36}  {:<10}  {:<20}  {}  {}",
            self.id,
            self.role,
            self.name,
            self.created_at.to_rfc3339(),
            if self.revoked { "revoked" } else { "active" }
        )
    }
}

// ---------------------------------------------------------------------------
// 错误面（§4.5）/// 认证错误面。
///
/// **脱敏**：变体不携带 token 本体（token_id 非凭证材料，§9.2.1 视图对象即
/// 暴露 token_id；携带它仅为审计计数，§4.8）。Display 不含任何凭证材料。
///
/// **关闭码映射**（§4.5 失败语义）：任何失败 → 关闭连接，instance 用
/// `CLOSE_CONFIG_FATAL`(4502)；client 认证失败同用 4502（token 错误属配置性
/// 永久失败，重连无益）。实际关闭由 F5 gateway 执行（本模块只产出错误）。
#[derive(Debug, Error)]
pub enum AuthError {
    /// instance 与 server 的线协议版本不兼容。
    #[error("协议版本不匹配（received={received}, expected={expected}）")]
    ProtocolVersionMismatch { received: u32, expected: u32 },
    /// nonce 非 base64 / 非 32B。
    #[error("nonce 编码非法")]
    BadNonceEncoding,
    /// nonce 重放（窗口内重复提交）。
    #[error("nonce 重放")]
    ReplayNonce,
    /// token 未登记。
    #[error("token 未登记")]
    UnknownToken,
    /// token 已吊销（携带 id 供按 token_id 计数，§4.8）。
    #[error("token 已吊销")]
    RevokedToken {
        /// 吊销记录 id。
        token_id: String,
    },
    /// 角色不匹配（如 instance/hello 提交 client token）。
    #[error("角色不匹配")]
    RoleMismatch {
        /// 匹配记录 id。
        token_id: String,
    },
    /// store 错误。
    #[error("store 错误: {0}")]
    Store(#[from] StoreError),
}

impl AuthError {
    /// 失败计数/审计用的稳定结果串（脱敏、可聚合，§9.4）。
    fn result_key(&self) -> &'static str {
        match self {
            AuthError::ProtocolVersionMismatch { .. } => "protocol_version_mismatch",
            AuthError::BadNonceEncoding => "bad_nonce",
            AuthError::ReplayNonce => "replay_nonce",
            AuthError::UnknownToken => "unknown_token",
            AuthError::RevokedToken { .. } => "revoked_token",
            AuthError::RoleMismatch { .. } => "role_mismatch",
            AuthError::Store(_) => "store_error",
        }
    }

    /// 已知记录 id（RevokedToken/RoleMismatch 时）；其余为 None → 计数
    /// key 取 [`UNKNOWN_TOKEN_ID`]。
    fn token_id(&self) -> Option<&str> {
        match self {
            AuthError::RevokedToken { token_id } => Some(token_id),
            AuthError::RoleMismatch { token_id } => Some(token_id),
            _ => None,
        }
    }
}

#[cfg(test)]
#[path = "bootstrap_test.rs"]
mod bootstrap_test;
#[cfg(test)]
#[path = "service_test.rs"]
mod service_test;
#[cfg(test)]
mod test_util;
#[cfg(test)]
#[path = "token_test.rs"]
mod token_test;
