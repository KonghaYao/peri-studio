//! 可信 binding 生命周期（§6.1 规则 5 / §6.2 / §8.5）：`bind` / `bind_recovering` / `resolve` / `switch_session` 与反向查询 `session_id`（含锁序纪律注释与悬空 binding 回滚）。
//!
//! 本文件是 [`ChatRegistry`](super::ChatRegistry) 的实现段（结构拆分，行为
//! 语义不变）。

use super::*;

impl ChatRegistry {
    /// binding 建立（§6.2：session/new 结果 → session_id → chat_id）。
    /// 此后该 chat 的 ACP 帧才允许投影（binding 前到达的帧一律丢弃，§6.2）。
    ///
    /// `confirmed` = 此刻是否已有该 chat 的 ACP 进程存活证据（create 流程
    /// spawn 成功后为 true；server 重启视图重建为 false，由 instance hello
    /// 对账裁决后置位——未确认的 chat 不作为 live runtime 复用）。
    pub async fn bind(
        &self,
        chat_id: &str,
        session_id: &str,
        confirmed: bool,
    ) -> Result<(), ChatError> {
        let mut bindings = self.inner.bindings.write().await;
        if let Some(existing) = bindings.get(session_id) {
            if existing != chat_id {
                return Err(ChatError::BindingConflict(existing.clone()));
            }
            // 幂等：binding 已存在时仍刷新确认位（例如对账补确认）。
            // 确认位只升不降——一旦有存活证据，无证据的 bind 调用不得撤销；
            // 降级只能由对账（missing）或进程退出等权威证据驱动。
            if let Some(entry) = self.inner.chats.write().await.get_mut(chat_id) {
                entry.runtime_confirmed = entry.runtime_confirmed || confirmed;
                entry.updated_at = Utc::now();
            }
            return Ok(()); // 幂等
        }
        bindings.insert(session_id.to_string(), chat_id.to_string());
        drop(bindings);
        let mut chats = self.inner.chats.write().await;
        if let Some(entry) = chats.get_mut(chat_id) {
            entry.session_id = Some(session_id.to_string());
            entry.runtime_confirmed = confirmed;
            entry.updated_at = Utc::now();
            info!(chat_id, session_id, "chat bound");
            return Ok(());
        }
        // chat 条目缺失（未登记/已被移除）：回滚刚插入的 binding，避免
        // resolve 命中悬空 binding；告警不静默（§5 不吞错）。
        drop(chats);
        self.inner.bindings.write().await.remove(session_id);
        warn!(
            chat_id,
            session_id, "bind rejected: chat entry missing, binding rolled back"
        );
        Ok(())
    }

    /// 恢复 open 专用绑定（§8.3 恢复场景）：目标 acp 会话已存在 binding 时，
    /// 仅当旧 binding **无存活证据**才允许迁移到新 runtime chat——旧 chat
    /// 已注销、终态、或 `runtime_confirmed=false`（视图重建 + 对账 missing，
    /// 进程已死）；有存活证据的 binding 不可覆盖（并发打开保护，§6.2）。
    ///
    /// 视图重建/对账不会自动释放 binding（与终态 release 不同，§8.2 仅
    /// close/崩溃释放），若无此接管语义，恢复 open 会在 pre-bind 处撞上
    /// 残留 binding 而 BindingConflict → create 失败 → instance/kill 杀掉
    /// 新 spawn 的进程。接管同时清掉旧 chat 的会话引用（该会话已归属新
    /// runtime chat；旧 chat 的 prompt 将不再误投）。
    pub async fn bind_recovering(
        &self,
        chat_id: &str,
        session_id: &str,
        confirmed: bool,
    ) -> Result<(), ChatError> {
        let bindings = self.inner.bindings.read().await;
        let Some(existing) = bindings.get(session_id).cloned() else {
            // 无既有 binding：与 bind 相同（登记新 binding）。
            drop(bindings);
            let mut bindings = self.inner.bindings.write().await;
            if let Some(existing) = bindings.get(session_id) {
                if existing != chat_id {
                    return Err(ChatError::BindingConflict(existing.clone()));
                }
            }
            bindings.insert(session_id.to_string(), chat_id.to_string());
            drop(bindings);
            let mut chats = self.inner.chats.write().await;
            if let Some(entry) = chats.get_mut(chat_id) {
                entry.session_id = Some(session_id.to_string());
                entry.runtime_confirmed = confirmed;
                entry.updated_at = Utc::now();
                info!(chat_id, session_id, "chat bound (recovering open)");
                return Ok(());
            }
            // 与 bind 同款处理：chat 条目缺失时回滚刚插入的 binding
            // （§5 不静默，避免悬空 binding）。
            drop(chats);
            self.inner.bindings.write().await.remove(session_id);
            warn!(
                chat_id,
                session_id, "recovering bind rejected: chat entry missing, binding rolled back"
            );
            return Ok(());
        };
        if existing == chat_id {
            // 幂等（与 bind 一致：确认位只升不降，降级只能由对账/退出裁决）。
            drop(bindings);
            if let Some(entry) = self.inner.chats.write().await.get_mut(chat_id) {
                entry.runtime_confirmed = entry.runtime_confirmed || confirmed;
                entry.updated_at = Utc::now();
            }
            return Ok(());
        }
        // 旧 binding 存活裁决：无存活证据才可接管。双读锁嵌套（bindings →
        // chats）安全：全库锁序图——
        //   (a) bind / bind_recovering / switch_session 持 bindings（读或写）
        //       期间可**嵌套获取 chats 写锁**（bindings → chats 方向，无
        //       反向获取）；
        //   (b) transition 先 drop chats 再取 bindings（chats → (drop) →
        //       bindings，绝不持 chats 锁时获取 bindings）；
        //   (c) 本处为读锁共享，无写锁嵌套。
        // 若未来在 transition 中不 drop 即取 bindings，或 bind 中反向
        // 嵌套，将立即死锁（tokio RwLock 无重入）。
        // 判定与写入之间的状态变化窗口极小（对账仅在 instance hello
        // 时运行一次，早于恢复 open），误判后果仅为一次不必要的拒绝。
        let stealable = {
            let chats = self.inner.chats.read().await;
            match chats.get(&existing) {
                None => true,
                Some(entry) => !entry.runtime_confirmed || entry.state.is_terminal(),
            }
        };
        if !stealable {
            return Err(ChatError::BindingConflict(existing.clone()));
        }
        drop(bindings);
        self.inner
            .bindings
            .write()
            .await
            .insert(session_id.to_string(), chat_id.to_string());
        let mut chats = self.inner.chats.write().await;
        if let Some(old) = chats.get_mut(&existing) {
            // 会话已被新 runtime chat 接管：旧 chat 不再拥有该会话。
            old.session_id = None;
            old.updated_at = Utc::now();
        }
        if let Some(entry) = chats.get_mut(chat_id) {
            entry.session_id = Some(session_id.to_string());
            entry.runtime_confirmed = confirmed;
            entry.updated_at = Utc::now();
        }
        info!(
            chat_id,
            session_id,
            from = %existing,
            "recovering open took over unconfirmed binding"
        );
        Ok(())
    }
    /// binding 查询（RelayEventHandler/ACPChannel 投递前校验，§6.1 规则 5：
    /// session_id 只用于协议投递，不能成为 Doc 名/广播频道/缓存键）。
    pub async fn resolve(&self, session_id: &str) -> Option<String> {
        self.inner.bindings.read().await.get(session_id).cloned()
    }

    /// 会话切换（§8.5 当前对话内 load）：把 chat 的**当前会话**切到
    /// `session_id`（进程内切换，进程不重建）。新会话登记 binding
    /// （relay 逐帧校验需要命中——load 后事件帧携带新 sessionId），
    /// 旧会话 binding 保留（同 chat 映射无害，且旧会话可被切回——
    /// switch 幂等更新 entry.session_id，与 [`ChatRegistry::bind`] 的
    /// 幂等分支不同：bind 不更新已有绑定会话的 entry）。
    pub async fn switch_session(&self, chat_id: &str, session_id: &str) -> Result<(), ChatError> {
        // The old session's value allowlist must never authorize a request for
        // the newly loaded session. Its response/update installs a fresh one.
        self.clear_config_catalog(chat_id).await;
        {
            let mut bindings = self.inner.bindings.write().await;
            if let Some(existing) = bindings.get(session_id) {
                if existing != chat_id {
                    return Err(ChatError::BindingConflict(existing.clone()));
                }
            }
            bindings.insert(session_id.to_string(), chat_id.to_string());
        }
        let mut chats = self.inner.chats.write().await;
        if let Some(entry) = chats.get_mut(chat_id) {
            entry.session_id = Some(session_id.to_string());
            entry.updated_at = Utc::now();
        }
        info!(chat_id, session_id, "chat session switched (load)");
        Ok(())
    }

    /// 会话条目查询。
    pub async fn session_id(&self, chat_id: &str) -> Option<String> {
        self.inner
            .chats
            .read()
            .await
            .get(chat_id)
            .and_then(|e| e.session_id.clone())
    }
}
