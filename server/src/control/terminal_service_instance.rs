//! Instance 终端回调与连接生命周期处理。

use super::*;

impl TerminalService {
    /// 生产 instance hello：在同一 terminal 生命周期临界区内完成 fencing、
    /// 旧 route 清理和新连接激活，避免旧帧与新 PTY 交错。
    pub async fn on_instance_connection_hello(
        &self,
        instance_id: &str,
        token_id: &str,
        conn: InstanceConn,
        hello: &peri_studio_proto::instance::InstanceHello,
        disconnect: tokio_util::sync::CancellationToken,
    ) -> Result<crate::control::HelloOutcome, crate::control::InstanceError> {
        let _open_guard = self.lifecycle_lock.lock().await;
        let outcome = self
            .instance
            .on_connection_hello(instance_id, token_id, conn.clone(), hello, disconnect)
            .await;
        if outcome.fenced_previous {
            self.cleanup_instance_routes(instance_id).await;
        }
        self.instance
            .activate_terminal_connection(instance_id, &conn)
            .await?;
        Ok(outcome)
    }

    pub async fn on_instance_opened(
        &self,
        instance_id: &str,
        conn: &InstanceConn,
        opened: InstanceTerminalOpened,
    ) {
        let _open_guard = self.lifecycle_lock.lock().await;
        if !self
            .instance
            .is_current_terminal_connection(instance_id, conn)
            .await
        {
            return;
        }
        let terminal_id_valid = validate_terminal_id(&opened.terminal_id, "terminalId").is_ok();
        if validate_terminal_id(&opened.request_id, "requestId").is_err() || !terminal_id_valid {
            if opened.ok && terminal_id_valid {
                let _ = self
                    .instance
                    .send_terminal_close(instance_id, conn, opened.terminal_id)
                    .await;
            }
            return;
        }
        let (pending, promoted, shutting_down) = {
            let mut inner = self.inner.lock().await;
            let shutting_down = inner.shutting_down;
            let belongs_to_instance =
                inner
                    .pending
                    .get(&opened.request_id)
                    .is_some_and(|pending| {
                        pending.owner.instance_id == instance_id
                            && pending.owner.instance_conn.tx.same_channel(&conn.tx)
                    });
            let pending = belongs_to_instance
                .then(|| inner.pending.remove(&opened.request_id))
                .flatten();
            let mut promoted = false;
            if let Some(pending) = &pending {
                if opened.ok
                    && pending.instance_request_id == opened.request_id
                    && pending.terminal_id == opened.terminal_id
                    && valid_opened_fields(&opened)
                {
                    let opened_frame = Frame::TerminalOpened(TerminalOpened {
                        request_id: pending.owner.request_id.clone(),
                        terminal_id: opened.terminal_id.clone(),
                        cwd: opened.cwd.clone().expect("validated terminal cwd"),
                        cols: opened.cols.expect("validated terminal cols"),
                        rows: opened.rows.expect("validated terminal rows"),
                    });
                    if pending
                        .owner
                        .client_tx
                        .try_send(OutboundMsg::Frame(opened_frame))
                        .is_ok()
                    {
                        *inner
                            .principal_counts
                            .entry(pending.owner.principal.clone())
                            .or_insert(0) += 1;
                        *inner
                            .instance_counts
                            .entry(pending.owner.instance_id.clone())
                            .or_insert(0) += 1;
                        inner
                            .active
                            .insert(pending.terminal_id.clone(), pending.owner.clone());
                        promoted = true;
                    }
                }
            }
            (pending, promoted, shutting_down)
        };
        let Some(pending) = pending else {
            if opened.ok && !shutting_down {
                let _ = self
                    .instance
                    .send_terminal_close(instance_id, conn, opened.terminal_id)
                    .await;
            }
            return;
        };
        if pending.instance_request_id != opened.request_id
            || pending.terminal_id != opened.terminal_id
            || (opened.ok && !valid_opened_fields(&opened))
        {
            if opened.ok {
                let close_ids =
                    HashSet::from([pending.terminal_id.clone(), opened.terminal_id.clone()]);
                for terminal_id in close_ids {
                    let _ = self
                        .instance
                        .send_terminal_close(instance_id, conn, terminal_id)
                        .await;
                }
            }
            let _ = pending
                .owner
                .client_tx
                .try_send(OutboundMsg::Frame(Frame::TerminalError(terminal_error(
                    Some(pending.owner.request_id.clone()),
                    Some(pending.terminal_id.clone()),
                    TerminalErrorCode::Unavailable,
                    "terminal open response mismatch",
                    true,
                ))));
            return;
        }
        if !opened.ok {
            let _ = pending
                .owner
                .client_tx
                .try_send(OutboundMsg::Frame(Frame::TerminalError(terminal_error(
                    Some(pending.owner.request_id.clone()),
                    Some(opened.terminal_id),
                    TerminalErrorCode::Unavailable,
                    opened
                        .error
                        .unwrap_or_else(|| "terminal open rejected".into()),
                    true,
                ))));
        } else if !promoted {
            let _ = self
                .instance
                .send_terminal_close(instance_id, conn, opened.terminal_id)
                .await;
        }
    }

    pub async fn on_instance_output(
        &self,
        instance_id: &str,
        conn: &InstanceConn,
        output: InstanceTerminalOutput,
    ) {
        let _open_guard = self.lifecycle_lock.lock().await;
        if !self
            .instance
            .is_current_terminal_connection(instance_id, conn)
            .await
        {
            return;
        }
        let terminal_id = output.terminal_id.clone();
        if validate_terminal_id(&terminal_id, "terminalId").is_err() {
            return;
        }
        let route = {
            let mut inner = self.inner.lock().await;
            if inner.shutting_down {
                return;
            }
            let Some(owner) = inner.active.get_mut(&terminal_id) else {
                drop(inner);
                let _ = self
                    .instance
                    .send_terminal_close(instance_id, conn, terminal_id)
                    .await;
                return;
            };
            if owner.instance_id != instance_id || !owner.instance_conn.tx.same_channel(&conn.tx) {
                drop(inner);
                let _ = self
                    .instance
                    .send_terminal_close(instance_id, conn, terminal_id)
                    .await;
                return;
            }
            let owner_snapshot = owner.clone();
            if decode_terminal_chunk(&output.data).is_err() {
                Err((owner_snapshot, "invalid terminal output"))
            } else if output.seq != owner.next_output_seq {
                Err((owner_snapshot, "terminal output sequence out of order"))
            } else if let Some(next) = owner.next_output_seq.checked_add(1) {
                owner.next_output_seq = next;
                Ok(owner_snapshot)
            } else {
                Err((owner_snapshot, "terminal output sequence exhausted"))
            }
        };
        let owner = match route {
            Ok(owner) => owner,
            Err((owner, message)) => {
                self.fail_active_terminal(&terminal_id, &owner, message, false)
                    .await;
                return;
            }
        };
        if owner
            .client_tx
            .try_send(OutboundMsg::Frame(Frame::TerminalOutput(TerminalOutput {
                terminal_id: terminal_id.clone(),
                seq: output.seq,
                data: output.data,
            })))
            .is_err()
            && self.remove_terminal(&terminal_id).await.is_some()
        {
            let _ = self
                .instance
                .send_terminal_close(&owner.instance_id, &owner.instance_conn, terminal_id)
                .await;
        }
    }

    pub async fn on_instance_exit(
        &self,
        instance_id: &str,
        conn: &InstanceConn,
        exit: peri_studio_proto::terminal::InstanceTerminalExit,
    ) {
        let _open_guard = self.lifecycle_lock.lock().await;
        if !self
            .instance
            .is_current_terminal_connection(instance_id, conn)
            .await
        {
            return;
        }
        if validate_terminal_id(&exit.terminal_id, "terminalId").is_err() {
            return;
        }
        let belongs_to_instance = {
            let inner = self.inner.lock().await;
            !inner.shutting_down
                && inner.active.get(&exit.terminal_id).is_some_and(|owner| {
                    owner.instance_id == instance_id
                        && owner.instance_conn.tx.same_channel(&conn.tx)
                })
        };
        if !belongs_to_instance {
            return;
        }
        let Some(owner) = self.remove_terminal(&exit.terminal_id).await else {
            return;
        };
        let _ = owner
            .client_tx
            .try_send(OutboundMsg::Frame(Frame::TerminalExit(
                peri_studio_proto::terminal::TerminalExit {
                    terminal_id: exit.terminal_id,
                    exit_code: exit.exit_code,
                    signal: exit.signal,
                },
            )));
    }

    pub async fn disconnect(&self, conn_id: ConnId) {
        let _open_guard = self.lifecycle_lock.lock().await;
        let (to_close, pending_to_close): (Vec<_>, Vec<_>) = {
            let mut inner = self.inner.lock().await;
            let active_ids = inner
                .active
                .iter()
                .filter(|(_, owner)| owner.conn_id == conn_id)
                .map(|(terminal_id, _)| terminal_id.clone())
                .collect::<Vec<_>>();
            let mut active = Vec::new();
            for terminal_id in active_ids {
                if let Some(owner) = inner.active.remove(&terminal_id) {
                    dec_count(&mut inner.principal_counts, &owner.principal);
                    dec_count(&mut inner.instance_counts, &owner.instance_id);
                    active.push((terminal_id, owner));
                }
            }
            let mut pending = Vec::new();
            inner.pending.retain(|_, open| {
                if open.owner.conn_id == conn_id {
                    pending.push((open.terminal_id.clone(), open.owner.clone()));
                    false
                } else {
                    true
                }
            });
            (active, pending)
        };
        for (terminal_id, owner) in to_close {
            let _ = self
                .instance
                .send_terminal_close(&owner.instance_id, &owner.instance_conn, terminal_id)
                .await;
        }
        for (terminal_id, owner) in pending_to_close {
            let _ = self
                .instance
                .send_terminal_close(&owner.instance_id, &owner.instance_conn, terminal_id)
                .await;
        }
    }

    async fn cleanup_instance_routes(&self, instance_id: &str) {
        let (victims, pending_victims): (Vec<_>, Vec<_>) = {
            let mut inner = self.inner.lock().await;
            let ids: Vec<String> = inner
                .active
                .iter()
                .filter(|(_, o)| o.instance_id == instance_id)
                .map(|(id, _)| id.clone())
                .collect();
            let mut owners = Vec::new();
            for id in ids {
                if let Some(owner) = inner.active.remove(&id) {
                    dec_count(&mut inner.principal_counts, &owner.principal);
                    dec_count(&mut inner.instance_counts, &owner.instance_id);
                    owners.push((id, owner));
                }
            }
            let mut pending_owners = Vec::new();
            inner.pending.retain(|_, pending| {
                if pending.owner.instance_id == instance_id {
                    pending_owners.push((pending.terminal_id.clone(), pending.owner.clone()));
                    false
                } else {
                    true
                }
            });
            (owners, pending_owners)
        };
        let live_conn = self.instance.current_terminal_connection(instance_id).await;
        for (terminal_id, owner) in victims {
            let conn = live_conn.as_ref().unwrap_or(&owner.instance_conn);
            let _ = self
                .instance
                .send_terminal_close(instance_id, conn, terminal_id.clone())
                .await;
            let _ = owner
                .client_tx
                .try_send(OutboundMsg::Frame(Frame::TerminalExit(
                    peri_studio_proto::terminal::TerminalExit {
                        terminal_id,
                        exit_code: None,
                        signal: Some("instance-offline".into()),
                    },
                )));
        }
        for (terminal_id, owner) in pending_victims {
            let conn = live_conn.as_ref().unwrap_or(&owner.instance_conn);
            let _ = self
                .instance
                .send_terminal_close(instance_id, conn, terminal_id.clone())
                .await;
            let _ = owner
                .client_tx
                .try_send(OutboundMsg::Frame(Frame::TerminalError(terminal_error(
                    Some(owner.request_id),
                    Some(terminal_id),
                    TerminalErrorCode::Unavailable,
                    "instance disconnected while opening terminal",
                    true,
                ))));
        }
    }

    pub async fn on_instance_disconnect(&self, instance_id: &str) {
        let _open_guard = self.lifecycle_lock.lock().await;
        self.cleanup_instance_routes(instance_id).await;
    }

    /// 停止接收新终端并清空全部内存路由；PTY close 在状态锁外尽力下发。
    pub async fn shutdown(&self) {
        let _open_guard = self.lifecycle_lock.lock().await;
        let (active, pending, close_targets) = {
            let mut inner = self.inner.lock().await;
            inner.shutting_down = true;
            let active = inner.active.drain().collect::<Vec<_>>();
            let pending = inner
                .pending
                .drain()
                .map(|(_, pending)| pending)
                .collect::<Vec<_>>();
            inner.principal_counts.clear();
            inner.instance_counts.clear();
            inner.completed_requests.clear();
            inner.completed_request_order.clear();
            let close_targets = active
                .iter()
                .map(|(terminal_id, owner)| {
                    (
                        owner.instance_id.clone(),
                        owner.instance_conn.clone(),
                        terminal_id.clone(),
                    )
                })
                .chain(pending.iter().map(|pending| {
                    (
                        pending.owner.instance_id.clone(),
                        pending.owner.instance_conn.clone(),
                        pending.terminal_id.clone(),
                    )
                }))
                .collect::<Vec<_>>();
            (active, pending, close_targets)
        };

        for (terminal_id, owner) in active {
            let _ = owner
                .client_tx
                .try_send(OutboundMsg::Frame(Frame::TerminalExit(
                    peri_studio_proto::terminal::TerminalExit {
                        terminal_id,
                        exit_code: None,
                        signal: Some("server-shutdown".into()),
                    },
                )));
        }
        for pending in pending {
            let _ = pending
                .owner
                .client_tx
                .try_send(OutboundMsg::Frame(Frame::TerminalError(terminal_error(
                    Some(pending.owner.request_id),
                    Some(pending.terminal_id),
                    TerminalErrorCode::Unavailable,
                    "server shut down while opening terminal",
                    true,
                ))));
        }
        for (instance_id, instance_conn, terminal_id) in close_targets {
            let _ = self
                .instance
                .send_terminal_close(&instance_id, &instance_conn, terminal_id)
                .await;
        }
    }

    pub async fn sweep_expired_pending(&self, now: Instant) {
        let _open_guard = self.lifecycle_lock.lock().await;
        let expired = {
            let mut inner = self.inner.lock().await;
            let keys: Vec<String> = inner
                .pending
                .iter()
                .filter(|(_, pending)| {
                    now.saturating_duration_since(pending.created_at) >= self.open_timeout
                })
                .map(|(request_id, _)| request_id.clone())
                .collect();
            keys.into_iter()
                .filter_map(|request_id| inner.pending.remove(&request_id))
                .collect::<Vec<_>>()
        };
        for pending in expired {
            let _ = self
                .instance
                .send_terminal_close(
                    &pending.owner.instance_id,
                    &pending.owner.instance_conn,
                    pending.terminal_id.clone(),
                )
                .await;
            let _ = pending
                .owner
                .client_tx
                .try_send(OutboundMsg::Frame(Frame::TerminalError(terminal_error(
                    Some(pending.owner.request_id),
                    Some(pending.terminal_id),
                    TerminalErrorCode::DeliveryUnknown,
                    "terminal open timed out",
                    true,
                ))));
        }
    }
}
