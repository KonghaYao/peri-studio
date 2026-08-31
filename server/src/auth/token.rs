//! TokenStore（§4.3）：token 存储面——加载/生成/吊销/校验 + 原子写
//! （§4.3.2）+ mtime 惰性重载（§4.3.3）。
//!
//! 并发模型（§4.3.2【决策】）：单 server 进程持有内存 store；CLI
//! `token generate/revoke` 直写同一文件。不做文件锁——mtime 惰性重载消除
//! 「CLI 改完 server 不认」的主分歧；两写互相覆盖的竞态窗口接受为已知限制。
//! 文件落 `<config_dir>/tokens.toml`（0600），`persist()` 的 tmp+fsync+
//! rename 原子写为文档明示决策（§4.3.2）。

use std::collections::HashSet;
use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use base64::Engine as _;
use chrono::Utc;
use rand::Rng as _;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::credential::{
    write_private_credential, write_private_credential_replace, EnsuredInstanceCredential,
};
use crate::auth::{
    AuthError, TokenInfo, TokenRecord, TokenRole, BOOTSTRAP_INSTANCE_NAME, TOKENS_FILE_VERSION,
    TOKEN_B64_LEN,
};

/// store 错误（token 文件面）。
#[derive(Debug, Error)]
pub enum StoreError {
    /// 文件存在但不可解析/缺字段（拒绝启动，不静默覆盖，§4.3）。
    #[error("token 文件格式非法: {0}")]
    Format(String),
    /// 文件版本不匹配（未来格式演进）。
    #[error("token 文件版本不支持: {0}")]
    Version(u32),
    /// token 长度非法（需 44 字符 base64，§4.3.3 长度防御）。
    #[error("token 长度非法（需 {TOKEN_B64_LEN} 字符 base64）")]
    BadTokenLength,
    /// 文件 I/O 失败。
    #[error("token 文件 I/O 失败: {0}")]
    Io(#[from] std::io::Error),
    /// 序列化失败。
    #[error("token 文件序列化失败: {0}")]
    Serialize(#[from] toml::ser::Error),
    /// 反序列化失败。
    #[error("token 文件反序列化失败: {0}")]
    Deserialize(#[from] toml::de::Error),
    /// 生成碰撞（重试后仍重复）。
    #[error("token 生成碰撞（重试后仍重复）")]
    Collision,
    /// 持久化失败（fsync/rename 等）。
    #[error("token 持久化失败: {0}")]
    Persist(String),
}

// ---------------------------------------------------------------------------
// TokenStore（§4.3）
// ---------------------------------------------------------------------------

/// token 存储：加载/生成/吊销/校验 + 原子写（§4.3.2）+ mtime 惰性重载
/// （§4.3.3）。
///
/// 并发模型（§4.3.2【决策】）：单 server 进程持有内存 store；CLI
/// `token generate/revoke` 直写同一文件。不做文件锁——mtime 惰性重载消除
/// 「CLI 改完 server 不认」的主分歧；两写互相覆盖的竞态窗口接受为已知限制。
pub struct TokenStore {
    path: PathBuf,
    /// 内存记录（service 层的 `revalidate_*` 需要只读访问；写入面保持私有）。
    pub(crate) records: Vec<TokenRecord>,
    last_mtime: Option<SystemTime>,
}

/// tokens.toml 文件形态（§4.3.1）。
#[derive(Debug, Clone, Serialize, Deserialize)]
struct TokensFile {
    #[serde(default = "default_file_version")]
    version: u32,
    #[serde(default)]
    tokens: Vec<TokenRecord>,
}

fn default_file_version() -> u32 {
    TOKENS_FILE_VERSION
}

impl TokenStore {
    /// 加载：文件不存在 → 空 store；存在且坏格式/坏 token 长度 → Err
    /// （拒绝启动，不静默覆盖，§4.3）。
    pub fn load(path: &Path) -> Result<Self, StoreError> {
        let mut store = TokenStore {
            path: path.to_path_buf(),
            records: Vec::new(),
            last_mtime: None,
        };
        store.reload()?;
        Ok(store)
    }

    /// 生成并持久化（原子写，§4.3.2）。
    ///
    /// token：32B CSPRNG → base64（44 字符）；生成时防碰撞重试（hashset 查重）。
    pub fn generate(&mut self, role: TokenRole, name: &str) -> Result<TokenRecord, StoreError> {
        self.maybe_reload();
        let record = self.prepare_record(role, name)?;
        self.records.push(record.clone());
        if let Err(e) = self.persist() {
            // 回滚内存态，保持与磁盘一致（T4：写失败 → Err 且原文件完好）。
            self.records.pop();
            return Err(e);
        }
        Ok(record)
    }

    /// 将 instance/client 凭据排他写入私有文件，再持久化对应服务端记录。
    ///
    /// 两个文件无法共享原子事务，因此输出会先持久化。若 store 随后失败，
    /// 私有输出会刻意保留，避免删掉一个可能已越过 token-store rename 边界的
    /// 有效凭据。边界前崩溃只会留下无效凭据，不会丢失有效 token 的唯一 secret。
    pub fn generate_to_file(
        &mut self,
        role: TokenRole,
        name: &str,
        output: &Path,
    ) -> Result<TokenRecord, StoreError> {
        self.maybe_reload();
        let record = self.prepare_record(role, name)?;
        write_private_credential(output, &record.token)?;

        self.records.push(record.clone());
        if let Err(error) = self.persist() {
            self.records.pop();
            return Err(StoreError::Persist(format!(
                "token record persistence failed after credential file became durable; retain and reconcile {}: {error}",
                output.display()
            )));
        }
        Ok(record)
    }

    /// 确保指定 instance 身份存在一个有效 token，并把凭据原子发布到文件。
    ///
    /// 已有同名、未吊销的 instance token 时复用它；否则先持久化新记录。
    /// 输出文件允许存在，发布使用同目录临时文件 + rename，且每次都会把权限
    /// 收紧到 0600。返回值不含 token 本体，调用方不需要解析 `tokens.toml`。
    pub fn ensure_instance_credential_to_file(
        &mut self,
        instance_id: &str,
        output: &Path,
    ) -> Result<EnsuredInstanceCredential, StoreError> {
        self.maybe_reload();
        let (record, newly_created) = match self.records.iter().find(|record| {
            record.role == TokenRole::Instance && record.name == instance_id && !record.revoked
        }) {
            Some(record) => (record.clone(), false),
            None => (self.generate(TokenRole::Instance, instance_id)?, true),
        };

        // 新记录已先持久化；若凭据发布失败，重试会复用同一记录并补齐文件，
        // 不会产生一个 server 接受但唯一 secret 已丢失的新 token。
        write_private_credential_replace(output, &record.token)?;
        Ok(EnsuredInstanceCredential {
            token_id: record.id,
            instance_id: record.name,
            path: output.to_path_buf(),
            newly_created,
        })
    }

    fn prepare_record(&self, role: TokenRole, name: &str) -> Result<TokenRecord, StoreError> {
        let existing: HashSet<String> = self.records.iter().map(|r| r.token.clone()).collect();
        let token = (0..3)
            .find_map(|_| {
                let t = generate_token();
                (!existing.contains(&t)).then_some(t)
            })
            .ok_or(StoreError::Collision)?;
        let record = TokenRecord {
            id: uuid::Uuid::new_v4().to_string(),
            role,
            name: name.to_string(),
            token,
            created_at: Utc::now(),
            revoked: false,
        };
        Ok(record)
    }

    /// 吊销并持久化（幂等：已吊销/不存在返回 `Ok(None)`，不报错）。
    ///
    /// 吊销即刻生效（§9.2.1 密钥生命周期）；运行中 server 经 mtime 重载
    /// 在下次 `validate` 时生效。
    pub fn revoke(&mut self, id: &str) -> Result<Option<TokenRecord>, StoreError> {
        self.maybe_reload();
        let Some(rec) = self.records.iter_mut().find(|r| r.id == id) else {
            return Ok(None);
        };
        if rec.revoked {
            return Ok(None);
        }
        rec.revoked = true;
        let rec = rec.clone();
        self.persist()?;
        Ok(Some(rec))
    }

    /// 按 instance token name（即 `instance_id`）吊销；幂等。
    pub fn revoke_instance_token(&mut self, instance_id: &str) -> Result<Option<TokenRecord>, StoreError> {
        self.maybe_reload();
        let Some(id) = self
            .records
            .iter()
            .find(|record| {
                record.role == TokenRole::Instance
                    && record.name == instance_id
                    && !record.revoked
            })
            .map(|record| record.id.clone())
        else {
            return Ok(None);
        };
        self.revoke(&id)
    }

    /// 视图列表（无 token 本体，§9.2.1）。
    pub fn list(&self) -> Vec<TokenInfo> {
        self.records.iter().map(TokenInfo::from).collect()
    }

    /// 校验：常量时间比较 + 角色精确匹配 + 吊销态；**每次调用先按 mtime
    /// 惰性重载**（§4.3.3）。宽限期轮换：新旧 token 并存期间同时有效。
    pub fn validate(
        &mut self,
        candidate: &str,
        required: TokenRole,
    ) -> Result<TokenRecord, AuthError> {
        self.maybe_reload();
        for r in &self.records {
            if r.revoked {
                continue;
            }
            if constant_time_eq(candidate, &r.token) {
                if r.role != required {
                    return Err(AuthError::RoleMismatch {
                        token_id: r.id.clone(),
                    });
                }
                return Ok(r.clone());
            }
        }
        // 区分「已吊销」与「未登记」（H9：分开计数）。
        for r in &self.records {
            if r.revoked && constant_time_eq(candidate, &r.token) {
                return Err(AuthError::RevokedToken {
                    token_id: r.id.clone(),
                });
            }
        }
        Err(AuthError::UnknownToken)
    }

    /// client 认证校验（§4.6）：角色允许集 = Full | ReadOnly；Instance 角色
    /// token 提交 client 认证 → [`AuthError::RoleMismatch`]（防 token 跨面复用）。
    pub fn validate_client(&mut self, candidate: &str) -> Result<TokenRecord, AuthError> {
        self.maybe_reload();
        for r in &self.records {
            if r.revoked {
                continue;
            }
            if constant_time_eq(candidate, &r.token) {
                if r.role == TokenRole::Instance {
                    return Err(AuthError::RoleMismatch {
                        token_id: r.id.clone(),
                    });
                }
                return Ok(r.clone());
            }
        }
        for r in &self.records {
            if r.revoked && constant_time_eq(candidate, &r.token) {
                return Err(AuthError::RevokedToken {
                    token_id: r.id.clone(),
                });
            }
        }
        Err(AuthError::UnknownToken)
    }

    pub fn validate_client_id(&mut self, id: &str) -> Result<TokenRecord, AuthError> {
        self.maybe_reload();
        match self.records.iter().find(|r| r.id == id) {
            Some(r) if r.revoked => Err(AuthError::RevokedToken {
                token_id: id.to_string(),
            }),
            Some(r) if r.role == TokenRole::Instance => Err(AuthError::RoleMismatch {
                token_id: id.to_string(),
            }),
            Some(r) => Ok(r.clone()),
            None => Err(AuthError::UnknownToken),
        }
    }

    /// §3.3/§4.3.4 启动 bootstrap：不存在任何未吊销 instance 角色 token 时
    /// 自动生成一个（name = [`BOOTSTRAP_INSTANCE_NAME`]（`"local"`））。
    /// 返回是否生成了新 token
    /// （打印与审计由装配方 main.rs 执行——token 本体只进终端一次，不进日志）。
    pub fn ensure_instance_token(&mut self) -> Result<Option<TokenRecord>, StoreError> {
        self.maybe_reload();
        if self
            .records
            .iter()
            .any(|r| r.role == TokenRole::Instance && !r.revoked)
        {
            return Ok(None);
        }
        let rec = self.generate(TokenRole::Instance, BOOTSTRAP_INSTANCE_NAME)?;
        Ok(Some(rec))
    }

    /// 已登记记录数（供 bootstrap/诊断）。
    pub fn len(&self) -> usize {
        self.records.len()
    }

    /// 是否为空。
    pub fn is_empty(&self) -> bool {
        self.records.is_empty()
    }

    /// 惰性重载：`stat` 文件 mtime，与 `last_mtime` 不一致则重载并合并——
    /// CLI 的 generate/revoke 对运行中 server **即时生效**（M1 无控制面，
    /// 这是最小实现，§4.3.3【决策】）。重载失败（文件被手改坏）→ 保持旧
    /// 内存态 + `error!` 审计（不静默，也不因手改挂掉服务）。
    ///
    /// `pub(crate)`：service 层的身份再校验（`revalidate_instance_identity`）
    /// 需要先按 mtime 重载再查内存记录。
    pub(crate) fn maybe_reload(&mut self) {
        let mtime = current_mtime(&self.path);
        if mtime == self.last_mtime {
            return;
        }
        match load_records(&self.path) {
            Ok(records) => {
                self.records = records;
                self.last_mtime = mtime;
            }
            Err(e) => {
                tracing::error!(
                    target: "peri_studio.audit",
                    action = "auth.store_reload",
                    result = "failed",
                    reason = e.to_string(),
                );
            }
        }
    }

    /// 全量重载（load 入口；文件坏格式 → Err，拒绝启动）。
    fn reload(&mut self) -> Result<(), StoreError> {
        self.records = load_records(&self.path)?;
        self.last_mtime = current_mtime(&self.path);
        Ok(())
    }

    /// 原子写（§4.3.2）：序列化 → 同目录 `.tmp` 文件（0600）→ fsync →
    /// rename 覆盖 → 目录 fsync。崩溃不产生半文件；token 是安全关键资产，
    /// fsync 不可省（server 重启后丢失新 token = 机器被锁）。
    fn persist(&mut self) -> Result<(), StoreError> {
        let dir = self
            .path
            .parent()
            .ok_or_else(|| StoreError::Persist("token 路径无父目录".to_string()))?;
        if !dir.exists() {
            return Err(StoreError::Persist(format!(
                "token 目录不存在: {}",
                dir.display()
            )));
        }
        let file = TokensFile {
            version: TOKENS_FILE_VERSION,
            tokens: self.records.clone(),
        };
        let content = toml::to_string(&file)?;
        let tmp = dir.join(format!(".tokens.toml.tmp.{}", std::process::id()));
        if let Err(e) = write_atomic_tmp(&tmp, &content) {
            let _ = fs::remove_file(&tmp);
            return Err(e);
        }
        if let Err(e) = fs::rename(&tmp, &self.path) {
            let _ = fs::remove_file(&tmp);
            return Err(StoreError::Io(e));
        }
        // 目录 fsync（§4.3.2）。
        if let Ok(d) = fs::File::open(dir) {
            d.sync_all()
                .map_err(|e| StoreError::Persist(format!("目录 fsync 失败: {e}")))?;
        }
        self.last_mtime = current_mtime(&self.path);
        Ok(())
    }
}

/// 写 `.tmp` 文件：create（0600）→ 写入 → fsync。
fn write_atomic_tmp(tmp: &Path, content: &str) -> Result<(), StoreError> {
    let mut f = fs::File::create(tmp)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        f.set_permissions(fs::Permissions::from_mode(0o600))?;
    }
    f.write_all(content.as_bytes())?;
    f.sync_all()?;
    Ok(())
}

/// 读取并校验 records（不触碰 mtime）。
fn load_records(path: &Path) -> Result<Vec<TokenRecord>, StoreError> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path)?;
    let file: TokensFile = toml::from_str(&content)?;
    if file.version != TOKENS_FILE_VERSION {
        return Err(StoreError::Version(file.version));
    }
    for r in &file.tokens {
        if !is_valid_token(&r.token) {
            return Err(StoreError::BadTokenLength);
        }
    }
    Ok(file.tokens)
}

fn current_mtime(path: &Path) -> Option<SystemTime> {
    fs::metadata(path).and_then(|m| m.modified()).ok()
}

/// token 本体合法性：44 字符 base64 且解码为 32B（§4.3.3 长度防御）。
fn is_valid_token(s: &str) -> bool {
    if s.len() != TOKEN_B64_LEN {
        return false;
    }
    matches!(
        base64::engine::general_purpose::STANDARD.decode(s),
        Ok(b) if b.len() == 32
    )
}

/// 32B CSPRNG → base64（44 字符，§9.2.1）。
fn generate_token() -> String {
    let mut b = [0u8; 32];
    rand::rng().fill_bytes(&mut b);
    base64::engine::general_purpose::STANDARD.encode(b)
}

/// 常量时间比较（§4.3.3【决策】；`subtle` 未预填，退化为手写 XOR-fold）。
///
/// token 为固定 44 字符（加载时断言）；长度分支只泄露「候选是否 44 字符」，
/// 无凭证价值（长度防御语义）。
fn constant_time_eq(a: &str, b: &str) -> bool {
    let a = a.as_bytes();
    let b = b.as_bytes();
    if a.len() != b.len() {
        return false;
    }
    let mut acc: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        acc |= x ^ y;
    }
    acc == 0
}
