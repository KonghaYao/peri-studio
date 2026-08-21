//! AuthService 握手单测（H1–H10）：
//! 成功路径（独立重算 MAC）/ 未知 token / nonce 重放与过期 / 角色与版本
//! 绑定 / 失败计数。

use std::time::Duration;

use base64::Engine as _;
use futures::executor::block_on;
use tempfile::tempdir;

use peri_studio_proto::conn::Auth;
use peri_studio_proto::hmac::{compute_mac, derive_mac_key, mac_input, verify_mac, NONCE_TTL};
use peri_studio_proto::version::PROTOCOL_VERSION;
use peri_studio_proto::whitelist::Role;

use crate::auth::{AuthError, AuthService, TokenRole, UNKNOWN_TOKEN_ID};

use super::test_util::*;

#[tokio::test]
async fn failure_audit_carries_total_snapshot() {
    let dir = tempdir().unwrap();
    let mut svc = AuthService::new(new_store(dir.path()));
    let (_, log) = with_capture(|| {
        block_on(svc.authenticate_instance(
            &make_hello("totally-unknown-token-value", &new_nonce_b64()),
            peer(),
        ))
    });
    assert!(
        log.contains("auth_failed_total"),
        "失败审计应携带快照: {log}"
    );
    let v: serde_json::Value = serde_json::from_str(log.lines().next().unwrap()).unwrap();
    let fields = v["fields"].as_object().unwrap();
    assert_eq!(fields["auth_failed_total"].as_u64(), Some(1));
}

// ---------------------------------------------------------------------------
// H1 成功路径：独立重算 MAC 验证
// ---------------------------------------------------------------------------
#[tokio::test]
async fn h1_success_path() {
    let dir = tempdir().unwrap();
    let mut svc = AuthService::new(new_store(dir.path()));
    let rec = svc.store_mut().generate(TokenRole::Instance, "m1").unwrap();
    let nonce_b64 = new_nonce_b64();

    let ok = svc
        .authenticate_instance(&make_hello(&rec.token, &nonce_b64), peer())
        .await
        .unwrap();

    // 独立重算（proto 原语）
    let token_bytes: [u8; 32] = base64::engine::general_purpose::STANDARD
        .decode(&rec.token)
        .unwrap()
        .try_into()
        .unwrap();
    let nonce_bytes: [u8; 32] = base64::engine::general_purpose::STANDARD
        .decode(&nonce_b64)
        .unwrap()
        .try_into()
        .unwrap();
    let ctx_bytes: [u8; 32] = base64::engine::general_purpose::STANDARD
        .decode(&ok.response.connection_context)
        .unwrap()
        .try_into()
        .unwrap();

    let key = derive_mac_key(&token_bytes, "instance");
    let input = mac_input(
        &nonce_bytes,
        &ctx_bytes,
        &PROTOCOL_VERSION.to_string(),
        "instance",
    );
    let expected = base64::engine::general_purpose::STANDARD.encode(compute_mac(&key, &input));
    assert_eq!(
        ok.response.hmac, expected,
        "auth_response.hmac 与独立重算一致"
    );
    assert!(
        verify_mac(&key, &input, &ok.response.hmac).is_ok(),
        "verify_mac 常量时间路径通过"
    );

    // ctx 绑定信息
    assert_eq!(ok.ctx.token_id, rec.id);
    assert_eq!(ok.ctx.role, TokenRole::Instance);
    assert_eq!(ok.ctx.hostname.as_deref(), Some("test-host"));
    assert_eq!(ok.ctx.peer, peer());
    assert_eq!(ok.ctx.wire_role(), Role::Instance);
    assert!(ok.ctx.can_send_action());
}

// ---------------------------------------------------------------------------
// H2 错误 token：UnknownToken + 审计 failed + 计数（全局与 <unknown>）
// ---------------------------------------------------------------------------
#[tokio::test]
async fn h2_unknown_token() {
    let dir = tempdir().unwrap();
    let mut svc = AuthService::new(new_store(dir.path()));
    let (result, log) = with_capture(|| {
        block_on(svc.authenticate_instance(
            &make_hello("totally-unknown-token-value", &new_nonce_b64()),
            peer(),
        ))
    });
    assert!(matches!(result, Err(AuthError::UnknownToken)));
    assert_audit_redacted(&log, &[]);
    assert!(log.contains("auth.instance"), "应有 auth.instance 审计");
    assert!(log.contains("unknown_token"));
    assert_eq!(svc.stats().total_failures(), 1);
    assert_eq!(svc.stats().failures_for(UNKNOWN_TOKEN_ID), 1);
}

// ---------------------------------------------------------------------------
// H3 重放：同 nonce 二次 hello → ReplayNonce
// ---------------------------------------------------------------------------
#[tokio::test]
async fn h3_replay_nonce() {
    let dir = tempdir().unwrap();
    let mut svc = AuthService::new(new_store(dir.path()));
    let rec = svc.store_mut().generate(TokenRole::Instance, "m1").unwrap();
    let nonce_b64 = new_nonce_b64();

    assert!(svc
        .authenticate_instance(&make_hello(&rec.token, &nonce_b64), peer())
        .await
        .is_ok());
    // 同 nonce 二次 hello → 重放拒绝（即使 token 正确）
    let (result, log) = with_capture(|| {
        block_on(svc.authenticate_instance(&make_hello(&rec.token, &nonce_b64), peer()))
    });
    assert!(matches!(result, Err(AuthError::ReplayNonce)));
    assert_audit_redacted(&log, &[]);
    assert!(log.contains("replay_nonce"));
    // 重放 nonce 时 token 未校验 → 计数归 <unknown>
    assert_eq!(svc.stats().failures_for(UNKNOWN_TOKEN_ID), 1);
}

/// H3 补充：认证失败的 nonce 同样登记——坏 token + nonce N 失败后，
/// 同 nonce N + 好 token 依旧被拒（防「失败后重放成功路径」，§4.4）。
#[tokio::test]
async fn h3_failed_nonce_still_registered() {
    let dir = tempdir().unwrap();
    let mut svc = AuthService::new(new_store(dir.path()));
    let rec = svc.store_mut().generate(TokenRole::Instance, "m1").unwrap();
    let nonce_b64 = new_nonce_b64();

    let bad = svc
        .authenticate_instance(&make_hello("wrong-token", &nonce_b64), peer())
        .await;
    assert!(matches!(bad, Err(AuthError::UnknownToken)));

    let replay = svc
        .authenticate_instance(&make_hello(&rec.token, &nonce_b64), peer())
        .await;
    assert!(matches!(replay, Err(AuthError::ReplayNonce)));
}

// ---------------------------------------------------------------------------
// H4 过期 nonce：nonce_test N2 覆盖（窗口语义在 NonceRegistry 单测断言）；
// 此处确认 AuthService 对过期 nonce 重提按新 nonce 接受（sweep 后无残留）。
// ---------------------------------------------------------------------------
#[tokio::test]
async fn h4_expired_nonce_reaccepted() {
    let dir = tempdir().unwrap();
    let mut svc = AuthService::new(new_store(dir.path()));
    let rec = svc.store_mut().generate(TokenRole::Instance, "m1").unwrap();
    let nonce_b64 = new_nonce_b64();
    assert!(svc
        .authenticate_instance(&make_hello(&rec.token, &nonce_b64), peer())
        .await
        .is_ok());

    // 推进窗口：sweep 清空过期条目（等价于 30s 后）
    let t = std::time::Instant::now() + NONCE_TTL + Duration::from_secs(1);
    svc.nonces_mut().sweep(t);
    assert!(svc.nonces_mut().is_empty());

    // 同 nonce 重提 → 按新 nonce 接受（N2 新窗口语义的 AuthService 侧）
    let ok = svc
        .authenticate_instance(&make_hello(&rec.token, &nonce_b64), peer())
        .await;
    assert!(ok.is_ok(), "过期后同 nonce 重提应按新 nonce 接受: {ok:?}");
}

// ---------------------------------------------------------------------------
// H5 nonce 编码
// ---------------------------------------------------------------------------
#[tokio::test]
async fn h5_bad_nonce_encoding() {
    let dir = tempdir().unwrap();
    let mut svc = AuthService::new(new_store(dir.path()));
    let rec = svc.store_mut().generate(TokenRole::Instance, "m1").unwrap();

    // 非 base64
    let bad1 = svc
        .authenticate_instance(&make_hello(&rec.token, "!!!"), peer())
        .await;
    assert!(matches!(bad1, Err(AuthError::BadNonceEncoding)));

    // 非 32B（base64 of 16B）
    let short = base64::engine::general_purpose::STANDARD.encode([0u8; 16]);
    let bad2 = svc
        .authenticate_instance(&make_hello(&rec.token, &short), peer())
        .await;
    assert!(matches!(bad2, Err(AuthError::BadNonceEncoding)));
}

// ---------------------------------------------------------------------------
// H6 错误角色
// ---------------------------------------------------------------------------
#[tokio::test]
async fn h6_role_mismatch() {
    let dir = tempdir().unwrap();
    let mut svc = AuthService::new(new_store(dir.path()));

    // client token 提交 instance/hello → RoleMismatch
    let client = svc.store_mut().generate(TokenRole::Full, "tui").unwrap();
    let (result, log) = with_capture(|| {
        block_on(svc.authenticate_instance(&make_hello(&client.token, &new_nonce_b64()), peer()))
    });
    assert!(matches!(
        result,
        Err(AuthError::RoleMismatch { token_id }) if token_id == client.id
    ));
    assert_audit_redacted(&log, &[]);
    assert_eq!(svc.stats().failures_for(&client.id), 1, "按 token_id 计数");

    // instance token 提交 client 认证 → RoleMismatch
    let instance = svc.store_mut().generate(TokenRole::Instance, "m1").unwrap();
    let result = svc
        .authenticate_client(
            &Auth {
                token: instance.token.clone(),
            },
            peer(),
        )
        .await;
    assert!(matches!(
        result,
        Err(AuthError::RoleMismatch { token_id }) if token_id == instance.id
    ));

    // full token 通过 client 认证（含 read-only）
    let ok = svc
        .authenticate_client(
            &Auth {
                token: client.token.clone(),
            },
            peer(),
        )
        .await
        .unwrap();
    assert_eq!(ok.wire_role(), Role::Client);
    let ro = svc
        .store_mut()
        .generate(TokenRole::ReadOnly, "web")
        .unwrap();
    let ok = svc
        .authenticate_client(&Auth { token: ro.token }, peer())
        .await
        .unwrap();
    assert_eq!(ok.role, TokenRole::ReadOnly);
    assert!(!ok.can_send_action(), "read-only 不可发 action");
}

// ---------------------------------------------------------------------------
// H7 版本绑定：机侧用错误版本重算 → verify_mac 失败（字节级，§4.8 向量 12）
// ---------------------------------------------------------------------------
#[tokio::test]
async fn h7_version_binding() {
    let dir = tempdir().unwrap();
    let mut svc = AuthService::new(new_store(dir.path()));
    let rec = svc.store_mut().generate(TokenRole::Instance, "m1").unwrap();
    let nonce_b64 = new_nonce_b64();

    let ok = svc
        .authenticate_instance(&make_hello(&rec.token, &nonce_b64), peer())
        .await
        .unwrap();

    let token_bytes: [u8; 32] = base64::engine::general_purpose::STANDARD
        .decode(&rec.token)
        .unwrap()
        .try_into()
        .unwrap();
    let nonce_bytes: [u8; 32] = base64::engine::general_purpose::STANDARD
        .decode(&nonce_b64)
        .unwrap()
        .try_into()
        .unwrap();
    let ctx_bytes: [u8; 32] = base64::engine::general_purpose::STANDARD
        .decode(&ok.response.connection_context)
        .unwrap()
        .try_into()
        .unwrap();
    let key = derive_mac_key(&token_bytes, "instance");

    // 正确版本通过
    let input = mac_input(
        &nonce_bytes,
        &ctx_bytes,
        &PROTOCOL_VERSION.to_string(),
        "instance",
    );
    assert!(verify_mac(&key, &input, &ok.response.hmac).is_ok());

    // 错误版本 → Mismatch（版本绑定天然拒绝，§4.5）
    let wrong_input = mac_input(&nonce_bytes, &ctx_bytes, "2", "instance");
    assert!(matches!(
        verify_mac(&key, &wrong_input, &ok.response.hmac),
        Err(peri_studio_proto::hmac::HmacError::Mismatch)
    ));

    // 错误角色 → Mismatch（角色绑定）
    let wrong_role = mac_input(
        &nonce_bytes,
        &ctx_bytes,
        &PROTOCOL_VERSION.to_string(),
        "client",
    );
    assert!(matches!(
        verify_mac(&key, &wrong_role, &ok.response.hmac),
        Err(peri_studio_proto::hmac::HmacError::Mismatch)
    ));
}

/// 显式版本协商先于 credential/nonce；legacy 缺字段（0）得到稳定错误，
/// 且同一 nonce 仍可用于随后正确版本握手。
#[tokio::test]
async fn h7_protocol_version_mismatch_is_explicit_and_does_not_consume_nonce() {
    let dir = tempdir().unwrap();
    let mut svc = AuthService::new(new_store(dir.path()));
    let rec = svc.store_mut().generate(TokenRole::Instance, "m1").unwrap();
    let nonce_b64 = new_nonce_b64();
    let mut legacy = make_hello(&rec.token, &nonce_b64);
    legacy.protocol_version = 0;

    let error = svc
        .authenticate_instance(&legacy, peer())
        .await
        .unwrap_err();
    assert!(matches!(
        error,
        AuthError::ProtocolVersionMismatch {
            received: 0,
            expected: PROTOCOL_VERSION
        }
    ));
    svc.authenticate_instance(&make_hello(&rec.token, &nonce_b64), peer())
        .await
        .expect("version rejection must not consume nonce");
}

// ---------------------------------------------------------------------------
// H8 未知身份（未登记 token）
// ---------------------------------------------------------------------------
#[tokio::test]
async fn h8_unknown_identity() {
    let dir = tempdir().unwrap();
    let mut svc = AuthService::new(new_store(dir.path()));
    let (result, log) = with_capture(|| {
        block_on(svc.authenticate_instance(
            &make_hello("0000000000000000000000000000000000000000", &new_nonce_b64()),
            peer(),
        ))
    });
    assert!(matches!(result, Err(AuthError::UnknownToken)));
    assert_audit_redacted(&log, &[]);
    assert_eq!(svc.stats().failures_for(UNKNOWN_TOKEN_ID), 1);
}

// ---------------------------------------------------------------------------
// H9 失败计数：按 token_id 递增；吊销与未知分开计数
// ---------------------------------------------------------------------------
#[tokio::test]
async fn h9_failure_counting() {
    let dir = tempdir().unwrap();
    let mut svc = AuthService::new(new_store(dir.path()));
    let rec = svc.store_mut().generate(TokenRole::Instance, "m1").unwrap();
    let client = svc.store_mut().generate(TokenRole::Full, "tui").unwrap();

    // 3 次未知 token 失败（instance + client 面）
    for _ in 0..3 {
        let _ = svc
            .authenticate_client(
                &Auth {
                    token: "no-such-token".into(),
                },
                peer(),
            )
            .await;
    }
    assert_eq!(svc.stats().failures_for(UNKNOWN_TOKEN_ID), 3);

    // 角色不匹配（已知 id）
    let _ = svc
        .authenticate_instance(&make_hello(&client.token, &new_nonce_b64()), peer())
        .await;
    assert_eq!(svc.stats().failures_for(&client.id), 1);

    // 吊销后失败（已知 id，与未知分开）
    svc.store_mut().revoke(&rec.id).unwrap();
    let _ = svc
        .authenticate_instance(&make_hello(&rec.token, &new_nonce_b64()), peer())
        .await;
    assert_eq!(svc.stats().failures_for(&rec.id), 1, "吊销与未知分开计数");
    assert_eq!(
        svc.stats().failures_for(UNKNOWN_TOKEN_ID),
        3,
        "未知计数不受影响"
    );
    assert_eq!(svc.stats().total_failures(), 5);
}

// ---------------------------------------------------------------------------
// H10 关闭码：认证失败映射 CLOSE_CONFIG_FATAL(4502)
// ---------------------------------------------------------------------------
