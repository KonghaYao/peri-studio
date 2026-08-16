//! `instance/buffer_sync` 补推消费（§8.5 补推纪律）：epoch 校验 → 逐帧
//! binding 校验 + from_seq 连续性投递 → 排空完成判定（设计稿决策 4）。
//!
//! 本文件是 [`RelayEventHandler`] 的实现段（结构拆分，行为语义不变）；
//! 由 `relay_event_handler` 的 `on_instance_event` 同构驱动，入口为
//! `on_buffer_sync`。

use tracing::debug;

use peri_studio_proto::instance::InstanceBufferSync;

use crate::channel::relay_event_handler::{ClientRequestRejection, ConsumeResult, RelayEventHandler};
use crate::protocol::{extract_session_id, NormalizeOutcome};

impl RelayEventHandler {
    /// `instance/buffer_sync` 消费（§8.5 补推纪律）。
    ///
    /// epoch 校验（与 hello 上报的 stream_epochs 不一致 → 拒绝整批，§4.5.1）
    /// → 逐帧按 from_seq 连续性投递（乱序/重复丢弃计数——聚合器幂等兜底）→
    /// 排空完成判定（设计稿决策 4：server 不做额外结束帧；gap 的精确计数与
    /// 追平清除由 F4 聚合器 `judge_stream`/gap_dirty → registry 写回）。
    pub async fn on_buffer_sync(
        &self,
        instance_id: &str,
        sync: &InstanceBufferSync,
    ) -> ConsumeResult {
        // 1. epoch 校验（与 server 记录不一致即拒绝该批，§4.5.1）。
        if let Some(expected) = self
            .inner
            .instance
            .chat_epoch(instance_id, &sync.chat_id)
            .await
        {
            if expected != sync.epoch {
                self.count_dropped("buffer_sync_epoch_mismatch");
                return ConsumeResult::BatchRejected {
                    reason: "buffer_sync_epoch_mismatch",
                };
            }
        }
        // 2. binding 校验（§6.1/§495）：信封 chat_id = instance 进程归属
        //    （hub chat id，§4.5.1）；帧内 sessionId 逐帧对照可信 binding
        //    （acp_session_id → hub chat_id）。JSON-RPC 形态例外（#5，与
        //    on_instance_event 同判据）按信封兜底（§4.4 L3 / #1 request /
        //    agent/status 通知）。
        let hub_chat_id = sync.chat_id.clone();
        // 3. from_seq 连续性（乱序/重复 → 丢弃计数，§8.5 纪律）。
        let mut expected_seq = sync.from_seq;
        let mut delivered = 0usize;
        let mut rejected = 0usize;
        let now = chrono::Utc::now().to_rfc3339();
        for bf in &sync.frames {
            if bf.seq != expected_seq {
                rejected += 1;
                self.count_dropped("buffer_sync_out_of_order");
                continue;
            }
            expected_seq = bf.seq + 1;
            // Sensitive OAuth notifications are never replayable. A conforming
            // instance excludes them from buffer_sync; reject defensively before
            // parsing so a legacy/malicious instance cannot persist or fan them out.
            if bf.frame.get("method").and_then(serde_json::Value::as_str) == Some("peri/oauth") {
                let _ = self
                    .observe_non_projected_frame(&hub_chat_id, sync.epoch, bf.seq)
                    .await;
                rejected += 1;
                self.count_dropped("oauth_replay_rejected");
                continue;
            }
            let binding_ok = match extract_session_id(&bf.frame) {
                Some(acp_id) => matches!(
                    self.inner.chats.resolve(&acp_id).await,
                    Some(mapped) if mapped == hub_chat_id
                ),
                None => false,
            };
            if !binding_ok {
                // 同构（on_instance_event C2）：无帧内 sessionId 的 JSON-RPC
                // 形态帧（有 jsonrpc 键）按信封兜底（投递路径与下方 Some
                // 分支合并）；方法面帧另要求信封 chat 登记；原始形态仍拒
                // （§6.1）。
                if bf.frame.get("jsonrpc").is_none()
                    || (bf.frame.get("method").is_some()
                        && self.inner.chats.entry(&hub_chat_id).await.is_none())
                {
                    let _ = self
                        .observe_non_projected_frame(&hub_chat_id, sync.epoch, bf.seq)
                        .await;
                    rejected += 1;
                    self.count_dropped("binding_missing");
                    continue;
                }
            }
            match self
                .inner
                .channel
                .normalize(&hub_chat_id, sync.epoch, bf.seq, &now, &bf.frame)
            {
                NormalizeOutcome::Event(nev) => match self.submit(&hub_chat_id, *nev).await {
                    ConsumeResult::Delivered { .. } => delivered += 1,
                    ConsumeResult::Dropped { reason } => {
                        rejected += 1;
                        self.count_dropped(reason);
                    }
                    // PersistFailed 计入 rejected（review #12：整批持久化失败
                    // 不得被报告为「已投递」——applied 与真实投递一致）。
                    ConsumeResult::PersistFailed { .. } => {
                        rejected += 1;
                        self.count_dropped("persist_failed");
                    }
                    _ => {}
                },
                // #1 官方 request_permission：登记 pending 表 + 投递投影
                // （补推路径同构，与实时帧一致）。
                NormalizeOutcome::PermissionRequest(req) => {
                    match self
                        .register_permission_request(&hub_chat_id, sync.epoch, bf.seq, &now, &req)
                        .await
                    {
                        ConsumeResult::Delivered { .. } => delivered += 1,
                        ConsumeResult::Dropped { reason } => {
                            rejected += 1;
                            self.count_dropped(reason);
                        }
                        ConsumeResult::PersistFailed { .. } => {
                            rejected += 1;
                            self.count_dropped("persist_failed");
                        }
                        _ => {}
                    }
                }
                NormalizeOutcome::ElicitationRequest(req) => {
                    match self
                        .register_elicitation_request(
                            instance_id,
                            &hub_chat_id,
                            sync.epoch,
                            bf.seq,
                            &now,
                            &req,
                        )
                        .await
                    {
                        ConsumeResult::Delivered { .. } => delivered += 1,
                        ConsumeResult::Dropped { reason } => {
                            rejected += 1;
                            self.count_dropped(reason);
                        }
                        ConsumeResult::PersistFailed { .. } => {
                            rejected += 1;
                            self.count_dropped("persist_failed");
                        }
                        _ => {}
                    }
                }
                NormalizeOutcome::RejectedClientRequest {
                    request_id,
                    code,
                    message,
                } => match self
                    .reject_client_request(
                        instance_id,
                        &hub_chat_id,
                        sync.epoch,
                        bf.seq,
                        ClientRequestRejection {
                            request_id,
                            code,
                            message,
                        },
                    )
                    .await
                {
                    ConsumeResult::Delivered { .. } => delivered += 1,
                    _ => rejected += 1,
                },
                NormalizeOutcome::RpcResponse { id, is_error } => {
                    if !self
                        .observe_non_projected_frame(&hub_chat_id, sync.epoch, bf.seq)
                        .await
                    {
                        rejected += 1;
                        self.count_dropped("rpc_response_stream_rejected");
                        continue;
                    }
                    self.confirm_rpc(&id, bf.frame.clone(), is_error).await;
                    delivered += 1;
                }
                NormalizeOutcome::Dropped(reason) => {
                    let _ = self
                        .observe_non_projected_frame(&hub_chat_id, sync.epoch, bf.seq)
                        .await;
                    rejected += 1;
                    self.count_dropped(reason.as_str());
                }
            }
        }
        // #3 增量窗口续命：补推投递成功同样刷新活动 turn 计时（断链补推
        // 期间的长流式 turn 不因窗口到期误判 delivery_unknown）。
        if delivered > 0 {
            self.inner.chats.touch_active_turn(&hub_chat_id).await;
        }
        debug!(
            chat_id = hub_chat_id,
            epoch = sync.epoch,
            from_seq = sync.from_seq,
            delivered,
            rejected,
            "buffer_sync consumed"
        );
        // 补推追平（§7.3/§8.5）：缓冲完整（无乱序/重复丢弃）且至少一帧
        // 投递 → 清除断链置的 gap 标记并恢复 chat 可用。`rejected > 0`
        // 保留 gap——缓冲孔洞的真实缺口由聚合器在后续实时帧 seq 跳号时
        // 精确计数上报（设计稿「缺口数量由补推时聚合器精确计算」）。
        if rejected == 0 && delivered > 0 {
            self.recover_from_gap(&hub_chat_id).await;
        }
        if delivered == 0 && rejected > 0 {
            ConsumeResult::BatchRejected {
                reason: "all_frames_rejected",
            }
        } else {
            ConsumeResult::Delivered {
                chat_id: hub_chat_id,
                kind: "buffer_sync",
                seq: sync.from_seq,
                applied: rejected == 0,
            }
        }
    }
}
