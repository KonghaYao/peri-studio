//! bootstrap（§4.3.4）与关闭码映射（§6.4 H10）单测。

use std::time::Duration;

use tempfile::tempdir;

use peri_studio_proto::conn::Auth;
use peri_studio_proto::whitelist::Role;

use crate::auth::{AuthService, ConnectionCtx, TokenRole, TokenStore};

use super::test_util::*;

#[test]
fn h10_close_code() {
    assert_eq!(peri_studio_proto::conn::CLOSE_CONFIG_FATAL, 4502);
    // 非回环拒绝用 1011（§5 决策），与认证失败码区分。
    assert_ne!(
        peri_studio_proto::conn::CLOSE_CONFIG_FATAL,
        peri_studio_proto::conn::CLOSE_GENERIC_FAILURE
    );
}

// ---------------------------------------------------------------------------
// 补充：bootstrap（§4.3.4）
// ---------------------------------------------------------------------------
#[test]
fn bootstrap_instance_token() {
    let dir = tempdir().unwrap();
    let mut store = new_store(dir.path());
    // 空 store → 生成 bootstrap instance token（name = 本机缺省 id "local"，
    // 与 channel::DEFAULT_INSTANCE_ID 一致，§4.3 P5 缺省路由才可命中本机）
    let rec = store.ensure_instance_token().unwrap().expect("应生成");
    assert_eq!(rec.name, crate::channel::DEFAULT_INSTANCE_ID);
    assert_eq!(rec.name, "local");
    assert_eq!(rec.role, TokenRole::Instance);
    // 已存在 instance token → 不再生成
    assert!(store.ensure_instance_token().unwrap().is_none());
    // 只有 client token 时 → 仍生成 instance token
    let mut store2 = new_store(&dir.path().join("sub"));
    std::fs::create_dir_all(dir.path().join("sub")).unwrap();
    store2.generate(TokenRole::Full, "tui").unwrap();
    let rec2 = store2
        .ensure_instance_token()
        .unwrap()
        .expect("应生成 instance token");
    assert_eq!(rec2.role, TokenRole::Instance);
}

#[test]
fn bootstrap_browser_token_is_managed_without_undoing_revocation() {
    let dir = tempdir().unwrap();
    let mut store = new_store(dir.path());
    let first = store
        .ensure_initial_browser_token()
        .unwrap()
        .expect("首次启动应生成 browser token");
    assert_eq!(first.role, TokenRole::Full);
    assert_eq!(first.name, crate::auth::BOOTSTRAP_BROWSER_NAME);

    let mut reopened = TokenStore::load(&dir.path().join("tokens.toml")).unwrap();
    assert!(
        reopened.ensure_initial_browser_token().unwrap().is_none(),
        "重启后不得重新开放 bootstrap"
    );

    store.revoke(&first.id).unwrap();
    assert!(store.ensure_initial_browser_token().unwrap().is_none());
}

#[test]
fn browser_bootstrap_session_is_single_use() {
    let dir = tempdir().unwrap();
    let mut store = new_store(dir.path());
    let record = store
        .ensure_initial_browser_token()
        .unwrap()
        .expect("应生成 browser token");
    let mut service = AuthService::new(store);
    service.set_initial_browser_token(Some(record.token));

    let (_, context) = service
        .create_initial_browser_session()
        .unwrap()
        .expect("首次交换应成功");
    assert_eq!(context.role, TokenRole::Full);
    assert!(service.create_initial_browser_session().unwrap().is_none());
}

// ---------------------------------------------------------------------------
// 补充：client 认证上下文
// ---------------------------------------------------------------------------
#[tokio::test]
async fn client_ctx_fields() {
    let dir = tempdir().unwrap();
    let mut svc = AuthService::new(new_store(dir.path()));
    let rec = svc
        .store_mut()
        .generate(TokenRole::Full, "桌面 TUI")
        .unwrap();
    let ctx = svc
        .authenticate_client(&Auth { token: rec.token }, peer())
        .await
        .unwrap();
    assert_eq!(ctx.token_id, rec.id);
    assert_eq!(ctx.name, "桌面 TUI");
    assert_eq!(ctx.hostname, None);
    assert_eq!(ctx.peer, peer());
    assert_eq!(ctx.wire_role(), Role::Client);
    assert!(ctx.can_send_action());
}

/// ConnectionCtx 类型级：wire_role/can_send_action 委托 TokenRole 映射。
#[test]
fn ctx_delegates_to_role() {
    let ctx = |role: TokenRole| ConnectionCtx {
        token_id: "id".into(),
        role,
        name: "n".into(),
        peer: peer(),
        hostname: None,
        established_at: chrono::Utc::now(),
    };
    assert_eq!(ctx(TokenRole::Instance).wire_role(), Role::Instance);
    assert!(ctx(TokenRole::Instance).can_send_action());
    assert!(!ctx(TokenRole::ReadOnly).can_send_action());
}

/// TokenRecord 克隆一致性（TokenInfo 转换不丢字段）。
#[test]
fn token_info_from_record() {
    let dir = tempdir().unwrap();
    let mut store = new_store(dir.path());
    let rec = store.generate(TokenRole::ReadOnly, "web").unwrap();
    let info: crate::auth::TokenInfo = (&rec).into();
    assert_eq!(info.id, rec.id);
    assert_eq!(info.role, rec.role);
    assert_eq!(info.name, rec.name);
    assert_eq!(info.created_at, rec.created_at);
    assert_eq!(info.revoked, rec.revoked);
}

#[test]
fn browser_session_is_opaque_logout_and_revocation_aware() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = new_store(dir.path());
    let rec = store.generate(TokenRole::Full, "browser").unwrap();
    let mut svc = AuthService::new(store);
    let (sid, ctx) = svc.create_browser_session(&rec.token).unwrap();
    assert!(sid.len() >= 43 && !sid.contains(&rec.token));
    assert_eq!(ctx.token_id, rec.id);
    assert!(svc
        .validate_browser_session(&sid, "127.0.0.1:1".parse().unwrap())
        .is_ok());
    assert!(svc.delete_browser_session(&sid));
    assert!(svc
        .validate_browser_session(&sid, "127.0.0.1:1".parse().unwrap())
        .is_err());
    let (sid, _) = svc.create_browser_session(&rec.token).unwrap();
    svc.store_mut().revoke(&rec.id).unwrap();
    assert!(svc
        .validate_browser_session(&sid, "127.0.0.1:1".parse().unwrap())
        .is_err());
}

#[test]
fn browser_session_rejects_instance_token() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = new_store(dir.path());
    let rec = store.generate(TokenRole::Instance, "machine").unwrap();
    let mut svc = AuthService::new(store);
    assert!(svc.create_browser_session(&rec.token).is_err());
}

#[test]
fn external_cli_revoke_is_seen_by_open_identity_revalidation() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("tokens.toml");
    let mut external = TokenStore::load(&path).unwrap();
    let rec = external.generate(TokenRole::Full, "browser").unwrap();
    let mut svc = AuthService::new(TokenStore::load(&path).unwrap());
    assert!(svc
        .revalidate_client_identity(&rec.id, TokenRole::Full)
        .is_ok());
    std::thread::sleep(Duration::from_millis(10));
    external.revoke(&rec.id).unwrap();
    assert!(svc
        .revalidate_client_identity(&rec.id, TokenRole::Full)
        .is_err());
}
