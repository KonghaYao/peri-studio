//! yrs 薄封装（§5.6 隔离范围）。
//!
//! 真实边界是 [`crate::state::doc_pair::DocPair`] + [`crate::state::chat_writer`]
//! 原语（聚合器/写者直接操作 `yrs::Doc`，经每 chat 单写者排除并发事务 panic，
//! §7.4）；本模块只保留三类收敛点：事务别名 [`TransactionCtx`]（隔离聚合器对
//! yrs 事务类型的直接命名）、update 编解码 free function（persist/gateway/
//! broadcaster 直接接触 yrs 类型的收敛点）、订阅句柄（Drop 即退订）。
//!
//! 早期版本的 `ViewStore` trait 承诺「聚合器经 trait 操作 yrs」，但生产路径
//! （`DocPair` 直操裸 `yrs::Doc`）从未兑现该抽象——trait 仅测试使用，已删除，
//! 避免文档承诺与实现脱节误导维护者。

use yrs::updates::decoder::Decode;
use yrs::{ReadTxn, StateVector, Transact, Update};

/// yrs 事务别名（隔离聚合器对 yrs 的直接命名；实现细节在本模块外）。
pub type TransactionCtx<'a> = yrs::TransactionMut<'a>;

/// 薄封装 free function（§5.6：persist/gateway/broadcaster 直接接触 yrs 类型
/// 的收敛点）。
///
/// `encode_state_as_update(doc)` = `Y.encodeStateAsUpdate`（全量快照）；
/// `merge_updates_v1(updates)` = `Y.mergeUpdatesV1`（增量合并，broadcaster
/// 背压路径，§6.4/§8.6）。
pub fn encode_state_as_update(doc: &yrs::Doc) -> Vec<u8> {
    doc.transact()
        .encode_state_as_update_v1(&StateVector::default())
}

/// 应用外部 update（启动重放，§8.4.1 恢复路径；聚合器运行期不调用）。
pub fn apply_update(doc: &yrs::Doc, update: &[u8]) -> Result<(), ViewStoreError> {
    let parsed =
        Update::decode_v1(update).map_err(|e| ViewStoreError::UpdateDecode(e.to_string()))?;
    doc.transact_mut()
        .apply_update(parsed)
        .map_err(|e| ViewStoreError::Apply(e.to_string()))
}

/// 合并多条 v1 update 为一条（`Y.mergeUpdatesV1`）。
pub fn merge_updates_v1(updates: &[Vec<u8>]) -> Result<Vec<u8>, ViewStoreError> {
    yrs::merge_updates_v1(updates).map_err(|e| ViewStoreError::Merge(e.to_string()))
}

/// ViewStore 操作错误。
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ViewStoreError {
    /// update 解码失败（格式损坏/版本不符）。
    #[error("update decode error: {0}")]
    UpdateDecode(String),
    /// update 应用失败。
    #[error("update apply error: {0}")]
    Apply(String),
    /// update 合并失败。
    #[error("update merge error: {0}")]
    Merge(String),
}
