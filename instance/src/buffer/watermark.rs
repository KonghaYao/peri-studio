//! 水位文件（§4.4.3）：epoch 跨重启单调 + 可验证的进程所有权。
//!
//! `{data_dir}/watermark.json`（0600）：epoch 跨重启单调（§4.5.1 判定正确性
//! 前提）、pgid + leader 出生指纹 + data-dir 身份供可证明所有权的启动清理，
//! last_seq 仅作诊断参考（权威在 server）。写盘用临时文件 + rename（原子）。

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// 水位文件错误。
#[derive(Debug, Error)]
pub enum WatermarkError {
    #[error("watermark file I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("watermark file parse error: {0}")]
    Parse(#[from] serde_json::Error),
}

/// 水位文件 JSON 形态（§4.4.3）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatermarkFile {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_dir_identity: Option<DataDirIdentity>,
    pub chats: HashMap<String, SessionWatermark>,
}

/// Unix data-dir identity. A copied directory must not inherit process ownership.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataDirIdentity {
    pub device: u64,
    pub inode: u64,
}

/// Opaque platform process birth identity for the process-group leader.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessFingerprint {
    pub platform: String,
    pub birth: String,
}

/// 单 session 水位（§4.4.3）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionWatermark {
    /// 流纪元（§4.5.1）。
    pub epoch: u64,
    /// 诊断参考 last_seq（非权威，权威在 server 侧 f3-persist 水位）。
    pub last_seq: u64,
    /// 进程组 id（启动清理残留用；0 = 无）。
    pub pgid: i32,
    /// Exact leader birth identity. Missing means cleanup authority is unproven.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub process_fingerprint: Option<ProcessFingerprint>,
}

/// 水位存储：epoch 跨重启单调 + 可验证的进程所有权（§4.4.3）。
///
/// 写盘用临时文件 + rename（原子，0600）；「last_seq 高频不落盘」由调用方
/// 控制 record 频率（epoch 变更时才写）。
#[derive(Debug)]
pub struct Watermark {
    path: PathBuf,
    state: WatermarkFile,
}

impl Watermark {
    /// 加载（文件不存在 → 空水位）。
    pub fn load(data_dir: &Path) -> Result<Self, WatermarkError> {
        let path = data_dir.join("watermark.json");
        let state = match fs::read_to_string(&path) {
            Ok(content) => serde_json::from_str(&content).unwrap_or_else(|e| {
                tracing::warn!(target: "peri_studio::instance", path = %path.display(),
                    "watermark file corrupt, falling back to empty watermark: {e}");
                WatermarkFile::default()
            }),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => WatermarkFile::default(),
            Err(e) => return Err(WatermarkError::Io(e)),
        };
        Ok(Watermark { path, state })
    }

    /// 某 session 的水位 epoch（无记录 → None）。
    pub fn epoch_of(&self, chat_id: &str) -> Option<u64> {
        self.state.chats.get(chat_id).map(|s| s.epoch)
    }

    /// Runtime ownership records retained for startup cleanup.
    pub fn runtime_records(&self) -> Vec<(i32, Option<ProcessFingerprint>)> {
        self.state
            .chats
            .values()
            .filter(|s| s.pgid > 0)
            .map(|s| (s.pgid, s.process_fingerprint.clone()))
            .collect()
    }

    pub fn data_dir_identity(&self) -> Option<DataDirIdentity> {
        self.state.data_dir_identity
    }

    /// Consume all stale cleanup authority while preserving epoch/sequence history.
    pub fn finalize_startup(&mut self, identity: DataDirIdentity) -> Result<(), WatermarkError> {
        self.state.data_dir_identity = Some(identity);
        for session in self.state.chats.values_mut() {
            session.pgid = 0;
            session.process_fingerprint = None;
        }
        self.write()
    }

    /// 写盘：临时文件（0600）+ rename（原子，§4.4.3【决策】）。
    pub fn write(&self) -> Result<(), WatermarkError> {
        let content = serde_json::to_string_pretty(&self.state)?;
        let tmp = self.path.with_extension("json.tmp");
        {
            let mut f = File::create(&tmp)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                f.set_permissions(fs::Permissions::from_mode(0o600))?;
            }
            f.write_all(content.as_bytes())?;
            f.sync_all()?;
        }
        fs::rename(&tmp, &self.path)?;
        Ok(())
    }

    /// 更新（或新增）session 水位并落盘（epoch 变更时调用，§4.4.3 更新时机）。
    pub fn record(
        &mut self,
        chat_id: &str,
        epoch: u64,
        last_seq: u64,
        pgid: i32,
        process_fingerprint: Option<ProcessFingerprint>,
    ) -> Result<(), WatermarkError> {
        self.state.chats.insert(
            chat_id.to_string(),
            SessionWatermark {
                epoch,
                last_seq,
                pgid,
                process_fingerprint,
            },
        );
        self.write()
    }
}
