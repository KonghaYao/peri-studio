//! 重连对账（§8.3 步骤 5）：`reconcile_alive`（alive_sessions 与 Registry
//! 比对 → 摘要 + 待 kill 清单）与 [`ReconciliationReport`]。

use super::*;

/// 重连对账摘要（§8.3 步骤 5）。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ReconciliationReport {
    /// instance 存活且 server 登记的 chat（正常）。
    pub alive: Vec<String>,
    /// instance 存活但 server 已标记终态/未知（应补发 kill，§7.5/§7.6）。
    pub unexpected_alive: Vec<String>,
    /// server 登记但 instance 未上报存活（进程已死；置 gap 或已由断链处理）。
    pub missing: Vec<String>,
    /// 对账后需要 server 下发 kill 的 chat（pending_close 补发 + 意外存活
    /// 裁决，§7.6/§8.3）。
    pub to_kill: Vec<String>,
}

impl ChatRegistry {
    /// 重连对账（§8.3 步骤 5）：alive_sessions 与 Registry 比对 → 摘要 +
    /// 待 kill 清单（意外存活 §7.5 裁决 + pending_close 补发 §7.6）。
    ///
    /// 同时维护每 chat 的 `runtime_confirmed`：instance 上报存活的 chat
    /// 置为确认（进程存活证据），已登记但未上报（missing）的 chat 清除
    /// 确认位并迁移状态到 [`ChatState::Gap`]（不再呈现「运行中」；Gap 非
    /// 终态，会话本身可经 spawn + session/load 恢复，首个业务帧投递后经
    /// recover_from_gap 迁回 Accepting）——此后该 chat 不作为 live runtime
    /// 复用（session/open 走 spawn + `session/load`），也不参与 session/list
    /// 轮询通道选择。
    pub async fn reconcile_alive(
        &self,
        instance_id: &str,
        alive: &[String],
    ) -> Result<ReconciliationReport, ChatError> {
        let chats = self.inner.chats.read().await;
        let mut report = ReconciliationReport::default();
        let registered: HashMap<String, ChatRecord> = chats
            .iter()
            .filter(|(_, e)| e.instance_id == instance_id)
            .map(|(id, e)| (id.clone(), e.clone()))
            .collect();
        let pending_close = self.inner.pending_close.read().await.clone();
        let ephemeral = self.inner.ephemeral_chats.read().await.clone();
        let mut confirmed: Vec<String> = Vec::new();
        drop(chats);

        for cid in alive {
            if ephemeral.contains(cid) {
                report.alive.push(cid.clone());
                confirmed.push(cid.clone());
                continue;
            }
            match registered.get(cid) {
                Some(e) if e.state.is_terminal() => {
                    // server 已标记终态但 instance 声称存活 → 意外存活，kill 裁决
                    // （§7.5）。
                    report.unexpected_alive.push(cid.clone());
                    report.to_kill.push(cid.clone());
                }
                Some(_) => {
                    report.alive.push(cid.clone());
                    confirmed.push(cid.clone());
                }
                None => {
                    // server 无登记（重启后遗留）→ 意外存活，kill 清理。
                    report.unexpected_alive.push(cid.clone());
                    report.to_kill.push(cid.clone());
                }
            }
        }
        // missing = server 登记但 instance 未上报存活 → 进程无存活证据，
        // 清除确认位（不置终态：会话本身可经 spawn + session/load 恢复）。
        let mut unconfirmed: Vec<String> = Vec::new();
        for cid in registered.keys() {
            if !alive.contains(cid) {
                report.missing.push(cid.clone());
                unconfirmed.push(cid.clone());
            }
        }
        // pending_close 补发（§7.6：instance 重连后自动补发 kill）。
        for cid in &pending_close {
            if !report.to_kill.contains(cid) {
                report.to_kill.push(cid.clone());
            }
        }
        if !confirmed.is_empty() || !unconfirmed.is_empty() {
            let mut chats = self.inner.chats.write().await;
            let now = Utc::now();
            for cid in confirmed {
                if let Some(entry) = chats.get_mut(&cid) {
                    if entry.state.is_terminal() {
                        continue;
                    }
                    entry.runtime_confirmed = true;
                    entry.updated_at = now;
                }
            }
            for cid in unconfirmed {
                if let Some(entry) = chats.get_mut(&cid) {
                    entry.runtime_confirmed = false;
                    entry.updated_at = now;
                }
            }
        }
        // missing → Gap：无进程存活证据的 chat 不再呈现为「运行中」
        // （accepting）。Gap 非终态（§8.2：会话仍可经 spawn + session/load
        // 恢复），与 runtime_confirmed=false 语义一致；恢复 open 成功、首个
        // 业务帧投递后经 recover_from_gap（ResumeAfterGap 可校准）迁回
        // Accepting。终态 chat 保持终态（跳过，binding 已释放）。
        // 单次读锁收集 missing 中非终态的 chat_id（避免逐 chat 锁往返，
        // O(n) 次获取降为 2 次）；收集后逐个 transition——transition 内部
        // 的防御性终态检查仍生效，收集窗口内并发迁移到终态的 chat 会被
        // 拒绝（warn 防御），行为与逐 chat 判定等价。
        let gap_targets: Vec<String> = {
            let chats = self.inner.chats.read().await;
            report
                .missing
                .iter()
                .filter(|cid| chats.get(*cid).is_some_and(|e| !e.state.is_terminal()))
                .cloned()
                .collect()
        };
        for cid in gap_targets {
            if let Err(error) = self.transition(&cid, ChatState::Gap).await {
                debug!(chat_id = %cid, ?error, "reconcile: gap transition rejected (防御)");
            }
        }
        info!(
            instance_id,
            alive = report.alive.len(),
            unexpected_alive = report.unexpected_alive.len(),
            missing = report.missing.len(),
            to_kill = report.to_kill.len(),
            "alive_sessions reconciliation complete"
        );
        Ok(report)
    }
}
