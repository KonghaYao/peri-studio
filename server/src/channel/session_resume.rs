//! server 重启恢复（无状态投影 §4 恢复路径 live chat）：对 instance 下
//! 全部非终态且已绑定会话的 chat 发起 `session/resume`——请求 ACP 进程
//! 按需注入冻结数据并从 ThreadStore 重放历史（view-commit → 聚合器
//! 投影 → server 镜像重建）。
//!
//! 与 `session/load` 不同：resume **不切换 binding、不开回放窗口**
//! （BeginLoadReplay 语义是换会话），恢复的是既有会话，重放事件走正常
//! 聚合路径。
//!
//! 每个 chat 独立后台任务（互不阻塞 hello 帧循环）；失败仅告警——视图
//! 恢复由客户端后续显式 load 兜底（以 ACP 现场为准，不重发命令）。
//!
//! 本文件是 [`SessionRuntimeOperations`] 的 resume 实现段；字段经
//! `pub(super)` 在 channel 模块内共享（结构拆分，行为语义不变）。

use tracing::{info, warn};

use crate::channel::session_runtime_operations::SessionRuntimeOperations;

/// 一次 instance 恢复批次的终态摘要。恢复门禁只消费这个稳定 interface，
/// 不依赖各 RPC task 的内部时序。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct ResumeSummary {
    pub launched: usize,
    pub failed: usize,
}

impl SessionRuntimeOperations {
    #[cfg(test)]
    pub(super) async fn resume_instance_chats(&self, instance_id: &str) -> usize {
        let candidates = self.resume_candidates(instance_id).await;
        let launched = candidates.len();
        self.log_resume_batch(instance_id, launched);
        for (chat_id, session_id, cwd) in candidates {
            let me = self.clone();
            let instance_id = instance_id.to_string();
            tokio::spawn(async move {
                let _ = me
                    .execute_resume(&instance_id, &chat_id, &cwd, &session_id)
                    .await;
            });
        }
        launched
    }

    /// 启动恢复专用路径：与普通 fire-and-forget adapter 共用候选规则，但等待
    /// 每个 RPC 的确定终态，使 RecoveryCoordinator 能在开门前证明恢复完成。
    pub(super) async fn resume_instance_chats_and_wait(&self, instance_id: &str) -> ResumeSummary {
        let candidates = self.resume_candidates(instance_id).await;
        let launched = candidates.len();
        self.log_resume_batch(instance_id, launched);
        let mut tasks = Vec::with_capacity(launched);
        for (chat_id, session_id, cwd) in candidates {
            let me = self.clone();
            let instance_id = instance_id.to_string();
            tasks.push(tokio::spawn(async move {
                me.execute_resume(&instance_id, &chat_id, &cwd, &session_id)
                    .await
            }));
        }
        let mut failed = 0;
        for task in tasks {
            if !matches!(task.await, Ok(true)) {
                failed += 1;
            }
        }
        ResumeSummary { launched, failed }
    }

    async fn resume_candidates(&self, instance_id: &str) -> Vec<(String, String, String)> {
        let mut candidates: Vec<(String, String, String)> = Vec::new();
        for (chat_id, state) in self.chats.chats_for_instance(instance_id).await {
            if state.is_terminal() {
                continue;
            }
            let Some(entry) = self.chats.entry(&chat_id).await else {
                continue;
            };
            let Some(session_id) = entry.session_id else {
                continue;
            };
            // 只对 instance 确认存活的 runtime 发 resume：进程不在时
            // forward 必然失败（view restored on explicit load），且会让
            // instance 反复告警。未确认的 chat 由用户显式打开时经 spawn
            // + session/load 恢复。
            if !entry.runtime_confirmed {
                continue;
            }
            candidates.push((chat_id, session_id, entry.cwd));
        }
        candidates
    }

    fn log_resume_batch(&self, instance_id: &str, launched: usize) {
        if launched > 0 {
            info!(
                instance_id,
                chats = launched,
                "instance hello: resuming live chat views"
            );
        }
    }

    async fn execute_resume(
        &self,
        instance_id: &str,
        chat_id: &str,
        cwd: &str,
        session_id: &str,
    ) -> bool {
        let (rpc_id, message) = self.translator.session_resume_rpc(cwd, session_id);
        let rx = self
            .relay
            .register_rpc(&rpc_id, format!("resume:{chat_id}"))
            .await;
        if let Err(error) = self
            .instance
            .forward_rpc(instance_id, chat_id, &message)
            .await
        {
            self.relay.cancel_rpc(&rpc_id).await;
            warn!(
                chat_id,
                instance_id,
                error = ?error,
                "session/resume forward failed; view restored on explicit load"
            );
            return false;
        }
        match tokio::time::timeout(self.load_timeout, rx).await {
            Ok(Ok(response)) if response.get("error").is_none() => {
                info!(
                    chat_id,
                    instance_id, "session/resume ok (view replay started)"
                );
                true
            }
            Ok(Ok(response)) => {
                warn!(
                    chat_id,
                    instance_id,
                    error = ?response.get("error"),
                    "session/resume rejected; view restored on explicit load"
                );
                false
            }
            _ => {
                self.relay.cancel_rpc(&rpc_id).await;
                warn!(
                    chat_id,
                    instance_id, "session/resume timed out; view restored on explicit load"
                );
                false
            }
        }
    }
}
