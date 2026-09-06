//! Browser 终端帧处理与 owner 路由。

use super::*;

impl TerminalService {
    pub(super) async fn handle_open(
        &self,
        conn_id: ConnId,
        principal: &str,
        can_mutate: bool,
        open: TerminalOpen,
        client_tx: mpsc::Sender<OutboundMsg>,
    ) {
        let request_id = validate_terminal_id(&open.request_id, "requestId")
            .is_ok()
            .then(|| open.request_id.clone());
        if !can_mutate {
            send_error(
                &client_tx,
                terminal_error(
                    request_id,
                    None,
                    TerminalErrorCode::Forbidden,
                    "read-only principals cannot open terminals",
                    false,
                ),
            )
            .await;
            return;
        }
        if let Err(message) = validate_open_fields(&open) {
            send_error(
                &client_tx,
                terminal_error(
                    request_id,
                    None,
                    TerminalErrorCode::InvalidRequest,
                    message,
                    false,
                ),
            )
            .await;
            return;
        }
        let project = match self.metadata.project(&open.project_id).await {
            Ok(Some(p)) if p.archived_at.is_none() => p,
            Ok(Some(_)) => {
                send_error(
                    &client_tx,
                    terminal_error(
                        Some(open.request_id),
                        None,
                        TerminalErrorCode::InvalidRequest,
                        "project is archived",
                        false,
                    ),
                )
                .await;
                return;
            }
            Ok(None) => {
                send_error(
                    &client_tx,
                    terminal_error(
                        Some(open.request_id),
                        None,
                        TerminalErrorCode::InvalidRequest,
                        "project not found",
                        false,
                    ),
                )
                .await;
                return;
            }
            Err(_) => {
                send_error(
                    &client_tx,
                    terminal_error(
                        Some(open.request_id),
                        None,
                        TerminalErrorCode::Unavailable,
                        "metadata unavailable",
                        true,
                    ),
                )
                .await;
                return;
            }
        };
        let terminal_id = uuid::Uuid::new_v4().to_string();
        let instance_request_id = uuid::Uuid::new_v4().to_string();
        let replay_key = request_key(principal, &open.request_id);
        let _open_guard = self.lifecycle_lock.lock().await;
        let Some(instance_conn) = self
            .instance
            .current_terminal_connection(&project.instance_id)
            .await
        else {
            send_error(
                &client_tx,
                terminal_error(
                    Some(open.request_id),
                    None,
                    TerminalErrorCode::Unavailable,
                    "instance unavailable",
                    true,
                ),
            )
            .await;
            return;
        };
        let owner = TerminalOwner {
            conn_id,
            principal: principal.to_string(),
            request_id: open.request_id.clone(),
            instance_id: project.instance_id.clone(),
            instance_conn: instance_conn.clone(),
            client_tx: client_tx.clone(),
            next_input_seq: 1,
            next_output_seq: 1,
        };
        let reservation_error = {
            let mut inner = self.inner.lock().await;
            if inner.shutting_down {
                Some((TerminalErrorCode::Unavailable, "server is shutting down"))
            } else if inner.pending.contains_key(&instance_request_id)
                || inner.completed_requests.contains(&replay_key)
            {
                Some((
                    TerminalErrorCode::InvalidRequest,
                    "request id already in use",
                ))
            } else if inner.active.contains_key(&terminal_id)
                || inner
                    .pending
                    .values()
                    .any(|pending| pending.terminal_id == terminal_id)
            {
                Some((
                    TerminalErrorCode::InvalidRequest,
                    "terminal id already in use",
                ))
            } else {
                let count = inner.principal_counts.get(principal).copied().unwrap_or(0)
                    + inner
                        .pending
                        .values()
                        .filter(|pending| pending.owner.principal == principal)
                        .count();
                if count >= MAX_TERMINALS_PER_PRINCIPAL {
                    Some((
                        TerminalErrorCode::LimitExceeded,
                        "too many terminals for principal",
                    ))
                } else {
                    let instance_count = inner
                        .instance_counts
                        .get(&project.instance_id)
                        .copied()
                        .unwrap_or(0)
                        + inner
                            .pending
                            .values()
                            .filter(|pending| pending.owner.instance_id == project.instance_id)
                            .count();
                    if instance_count >= MAX_TERMINALS_PER_INSTANCE_HOST {
                        Some((
                            TerminalErrorCode::LimitExceeded,
                            "too many terminals for instance",
                        ))
                    } else {
                        remember_completed_request(&mut inner, replay_key.clone());
                        inner.pending.insert(
                            instance_request_id.clone(),
                            PendingOpen {
                                owner,
                                terminal_id: terminal_id.clone(),
                                instance_request_id: instance_request_id.clone(),
                                created_at: Instant::now(),
                            },
                        );
                        None
                    }
                }
            }
        };
        if let Some((code, message)) = reservation_error {
            send_error(
                &client_tx,
                terminal_error(Some(open.request_id), None, code, message, false),
            )
            .await;
            return;
        }
        let query = InstanceTerminalOpen {
            request_id: instance_request_id.clone(),
            terminal_id: terminal_id.clone(),
            cwd: project.cwd.clone(),
            cols: open.cols,
            rows: open.rows,
        };
        if let Err(err) = self
            .instance
            .send_terminal_open(&project.instance_id, &instance_conn, query)
            .await
        {
            let removed = {
                let mut inner = self.inner.lock().await;
                inner.pending.remove(&instance_request_id)
            };
            if removed.is_some() {
                send_error(
                    &client_tx,
                    map_instance_error(&open.request_id, &terminal_id, err),
                )
                .await;
            }
        }
    }

    pub(super) async fn handle_input(
        &self,
        conn_id: ConnId,
        principal: &str,
        can_mutate: bool,
        input: TerminalInput,
    ) {
        if !can_mutate || validate_terminal_id(&input.terminal_id, "terminalId").is_err() {
            return;
        }
        let _open_guard = self.lifecycle_lock.lock().await;
        let decoded = decode_terminal_chunk(&input.data);
        let route = {
            let mut inner = self.inner.lock().await;
            let Some(owner) = inner.active.get_mut(&input.terminal_id) else {
                return;
            };
            if owner.conn_id != conn_id || owner.principal != principal {
                return;
            }
            let owner_snapshot = owner.clone();
            if decoded.is_err() {
                Err((owner_snapshot, "invalid terminal input"))
            } else if input.seq != owner.next_input_seq {
                Err((owner_snapshot, "terminal input sequence out of order"))
            } else if let Some(next) = owner.next_input_seq.checked_add(1) {
                owner.next_input_seq = next;
                Ok(owner_snapshot)
            } else {
                Err((owner_snapshot, "terminal input sequence exhausted"))
            }
        };
        let owner = match route {
            Ok(owner) => owner,
            Err((owner, message)) => {
                self.fail_active_terminal(&input.terminal_id, &owner, message, false)
                    .await;
                return;
            }
        };
        if self
            .instance
            .send_terminal_input(
                &owner.instance_id,
                &owner.instance_conn,
                InstanceTerminalInput {
                    terminal_id: input.terminal_id.clone(),
                    seq: input.seq,
                    data: input.data,
                },
            )
            .await
            .is_err()
        {
            self.fail_active_terminal(
                &input.terminal_id,
                &owner,
                "terminal input could not be delivered",
                true,
            )
            .await;
        }
    }

    pub(super) async fn handle_resize(
        &self,
        conn_id: ConnId,
        principal: &str,
        can_mutate: bool,
        resize: TerminalResize,
    ) {
        if !can_mutate
            || validate_terminal_id(&resize.terminal_id, "terminalId").is_err()
            || validate_terminal_dims(resize.cols, resize.rows).is_err()
        {
            return;
        }
        let _open_guard = self.lifecycle_lock.lock().await;
        let Some(owner) = self
            .lookup_owner(conn_id, principal, &resize.terminal_id)
            .await
        else {
            return;
        };
        let terminal_id = resize.terminal_id.clone();
        if self
            .instance
            .send_terminal_resize(
                &owner.instance_id,
                &owner.instance_conn,
                InstanceTerminalResize {
                    terminal_id: terminal_id.clone(),
                    cols: resize.cols,
                    rows: resize.rows,
                },
            )
            .await
            .is_err()
        {
            let owner = {
                let inner = self.inner.lock().await;
                inner.active.get(&terminal_id).cloned()
            };
            if let Some(owner) = owner {
                self.fail_active_terminal(
                    &terminal_id,
                    &owner,
                    "terminal resize could not be delivered",
                    true,
                )
                .await;
            }
        }
    }

    pub(super) async fn handle_close(
        &self,
        conn_id: ConnId,
        principal: &str,
        can_mutate: bool,
        close: TerminalClose,
        client_tx: mpsc::Sender<OutboundMsg>,
    ) {
        if !can_mutate {
            return;
        }
        let request_id_valid = close
            .request_id
            .as_deref()
            .is_none_or(|request_id| validate_terminal_id(request_id, "requestId").is_ok());
        let terminal_id_valid = close
            .terminal_id
            .as_deref()
            .is_none_or(|terminal_id| validate_terminal_id(terminal_id, "terminalId").is_ok());
        if !request_id_valid || !terminal_id_valid {
            send_error(
                &client_tx,
                terminal_error(
                    None,
                    None,
                    TerminalErrorCode::InvalidRequest,
                    "invalid terminal close id",
                    false,
                ),
            )
            .await;
            return;
        }
        let _open_guard = self.lifecycle_lock.lock().await;
        if let Some(request_id) = close.request_id {
            let (pending, active) = {
                let mut inner = self.inner.lock().await;
                let pending_key = inner.pending.iter().find_map(|(key, pending)| {
                    (pending.owner.conn_id == conn_id
                        && pending.owner.principal == principal
                        && pending.owner.request_id == request_id
                        && close
                            .terminal_id
                            .as_ref()
                            .is_none_or(|terminal_id| terminal_id == &pending.terminal_id))
                    .then(|| key.clone())
                });
                let pending = pending_key.and_then(|key| inner.pending.remove(&key));
                let active_key = inner.active.iter().find_map(|(terminal_id, owner)| {
                    (owner.conn_id == conn_id
                        && owner.principal == principal
                        && owner.request_id == request_id
                        && close
                            .terminal_id
                            .as_ref()
                            .is_none_or(|expected| expected == terminal_id))
                    .then(|| terminal_id.clone())
                });
                let active = active_key.and_then(|terminal_id| {
                    let owner = inner.active.remove(&terminal_id)?;
                    dec_count(&mut inner.principal_counts, &owner.principal);
                    dec_count(&mut inner.instance_counts, &owner.instance_id);
                    Some((terminal_id, owner))
                });
                (pending, active)
            };
            if let Some(pending) = pending {
                let _ = self
                    .instance
                    .send_terminal_close(
                        &pending.owner.instance_id,
                        &pending.owner.instance_conn,
                        pending.terminal_id,
                    )
                    .await;
            }
            if let Some((terminal_id, owner)) = active {
                let _ = self
                    .instance
                    .send_terminal_close(&owner.instance_id, &owner.instance_conn, terminal_id)
                    .await;
            }
            return;
        }
        let Some(terminal_id) = close.terminal_id else {
            send_error(
                &client_tx,
                terminal_error(
                    None,
                    None,
                    TerminalErrorCode::InvalidRequest,
                    "terminal close requires requestId or terminalId",
                    false,
                ),
            )
            .await;
            return;
        };
        let owner = {
            let mut inner = self.inner.lock().await;
            let Some(owner) = inner.active.get(&terminal_id) else {
                return;
            };
            if owner.conn_id != conn_id || owner.principal != principal {
                return;
            }
            let owner = inner
                .active
                .remove(&terminal_id)
                .expect("validated terminal owner");
            dec_count(&mut inner.principal_counts, &owner.principal);
            dec_count(&mut inner.instance_counts, &owner.instance_id);
            owner
        };
        let _ = self
            .instance
            .send_terminal_close(&owner.instance_id, &owner.instance_conn, terminal_id)
            .await;
    }
}
