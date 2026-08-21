//! TokenStore 单测（T1–T8）：生成/校验/
//! 旋转/原子写/重载/角色映射/常量时间比较/脱敏与审计。

use std::time::{Duration, SystemTime};

use base64::Engine as _;
use futures::executor::block_on;
use tempfile::tempdir;

use crate::auth::{audit::audit, AuthError, AuthService, TokenRole, TokenStore};
use peri_studio_proto::whitelist::Role;

use super::test_util::*;

// ---------------------------------------------------------------------------
#[test]
fn t1_generate() {
    let dir = tempdir().unwrap();
    let mut store = new_store(dir.path());
    assert!(store.is_empty());

    let rec = store.generate(TokenRole::Instance, "desktop-01").unwrap();
    assert_eq!(rec.token.len(), 44, "32B→base64 应为 44 字符");
    assert!(!rec.revoked);
    assert!(!rec.id.is_empty());
    assert_eq!(rec.role, TokenRole::Instance);
    assert_eq!(rec.name, "desktop-01");

    let rec2 = store.generate(TokenRole::Full, "tui").unwrap();
    assert_ne!(rec.token, rec2.token, "两次生成必须不同");
    assert_eq!(store.len(), 2);

    // 落盘 → 重载一致
    let reloaded = TokenStore::load(&dir.path().join("tokens.toml")).unwrap();
    assert_eq!(reloaded.len(), 2);
    let reloaded_rec = reloaded
        .list()
        .into_iter()
        .find(|i| i.id == rec.id)
        .unwrap();
    assert_eq!(reloaded_rec.role, TokenRole::Instance);
    assert_eq!(reloaded_rec.name, "desktop-01");
}

#[test]
fn t1_generate_to_file_is_private_exact_and_no_overwrite() {
    let dir = tempdir().unwrap();
    let output = dir.path().join("instance.token");
    let mut store = new_store(dir.path());

    let rec = store
        .generate_to_file(TokenRole::Instance, "local", &output)
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(&output).unwrap(),
        format!("{}\n", rec.token)
    );
    assert_eq!(store.len(), 1);
    assert_eq!(
        TokenStore::load(&dir.path().join("tokens.toml"))
            .unwrap()
            .list()[0]
            .id,
        rec.id
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        assert_eq!(
            std::fs::metadata(&output).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    let error = store
        .generate_to_file(TokenRole::Instance, "other", &output)
        .unwrap_err();
    assert!(error.to_string().contains("already exists"));
    assert_eq!(
        store.len(),
        1,
        "existing output must fail before store mutation"
    );
    assert_eq!(
        std::fs::read_to_string(&output).unwrap(),
        format!("{}\n", rec.token)
    );
    assert!(std::fs::read_dir(dir.path())
        .unwrap()
        .filter_map(Result::ok)
        .all(|entry| !entry
            .file_name()
            .to_string_lossy()
            .contains(".instance-token.tmp")));
}

#[test]
fn ensured_instance_credential_reuses_token_and_atomically_restricts_output() {
    let dir = tempfile::tempdir().unwrap();
    let store_path = dir.path().join("tokens.toml");
    let output = dir.path().join("instance.token");
    let mut store = TokenStore::load(&store_path).unwrap();

    let first = store
        .ensure_instance_credential_to_file("local", &output)
        .unwrap();
    let first_token = std::fs::read_to_string(&output).unwrap();
    assert!(first.newly_created);
    assert_eq!(first.instance_id, "local");

    // 模拟旧文件内容和过宽权限；再次确保必须原子替换并收紧权限。
    std::fs::write(&output, "stale credential\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(&output, std::fs::Permissions::from_mode(0o666)).unwrap();
    }

    let second = store
        .ensure_instance_credential_to_file("local", &output)
        .unwrap();
    assert!(!second.newly_created);
    assert_eq!(second.token_id, first.token_id);
    assert_eq!(std::fs::read_to_string(&output).unwrap(), first_token);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        assert_eq!(
            std::fs::metadata(&output).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}

#[cfg(unix)]
#[test]
fn t1_generate_to_file_retains_inert_credential_when_store_cannot_commit() {
    use std::os::unix::fs::PermissionsExt as _;

    let dir = tempdir().unwrap();
    let config = dir.path().join("config");
    let data = dir.path().join("data");
    std::fs::create_dir_all(&config).unwrap();
    std::fs::create_dir_all(&data).unwrap();
    let mut store = TokenStore::load(&config.join("tokens.toml")).unwrap();
    std::fs::set_permissions(&config, std::fs::Permissions::from_mode(0o500)).unwrap();

    let output = data.join("instance.token");
    let error = store
        .generate_to_file(TokenRole::Instance, "local", &output)
        .unwrap_err();
    assert!(error.to_string().contains("retain and reconcile"));
    assert!(
        output.is_file(),
        "the only credential copy must be retained"
    );
    assert_eq!(
        store.len(),
        0,
        "failed store commit must roll back memory state"
    );

    std::fs::set_permissions(&config, std::fs::Permissions::from_mode(0o700)).unwrap();
    assert_eq!(
        TokenStore::load(&config.join("tokens.toml")).unwrap().len(),
        0
    );
}

// ---------------------------------------------------------------------------
// T2 校验
// ---------------------------------------------------------------------------
#[test]
fn t2_validate() {
    let dir = tempdir().unwrap();
    let mut store = new_store(dir.path());
    let rec = store.generate(TokenRole::Instance, "m1").unwrap();

    // 正确 token 通过（返回记录）
    let got = store.validate(&rec.token, TokenRole::Instance).unwrap();
    assert_eq!(got.id, rec.id);

    // 未知 → UnknownToken
    assert!(matches!(
        store.validate(
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            TokenRole::Instance
        ),
        Err(AuthError::UnknownToken)
    ));

    // 吊销后 → RevokedToken
    store.revoke(&rec.id).unwrap();
    assert!(matches!(
        store.validate(&rec.token, TokenRole::Instance),
        Err(AuthError::RevokedToken { token_id }) if token_id == rec.id
    ));
}

// ---------------------------------------------------------------------------
// T3 宽限期轮换：新旧并存 → 逐机切换 → 吊销旧
// ---------------------------------------------------------------------------
#[test]
fn t3_grace_period_rotation() {
    let dir = tempdir().unwrap();
    let mut store = new_store(dir.path());
    let old = store.generate(TokenRole::Instance, "old").unwrap();
    // 宽限期：新旧并存均有效
    let new = store.generate(TokenRole::Instance, "new").unwrap();
    assert!(store.validate(&old.token, TokenRole::Instance).is_ok());
    assert!(store.validate(&new.token, TokenRole::Instance).is_ok());
    // 吊销旧 → 旧失效、新有效
    store.revoke(&old.id).unwrap();
    assert!(matches!(
        store.validate(&old.token, TokenRole::Instance),
        Err(AuthError::RevokedToken { .. })
    ));
    assert!(store.validate(&new.token, TokenRole::Instance).is_ok());
}

// ---------------------------------------------------------------------------
// T4 原子写
// ---------------------------------------------------------------------------
#[test]
fn t4_atomic_write() {
    let dir = tempdir().unwrap();
    let mut store = new_store(dir.path());
    store.generate(TokenRole::Instance, "m1").unwrap();
    store.generate(TokenRole::Full, "tui").unwrap();

    // persist 后文件可解析
    let reloaded = TokenStore::load(&dir.path().join("tokens.toml")).unwrap();
    assert_eq!(reloaded.len(), 2);

    // tmp 文件不残留
    let leftovers: Vec<_> = std::fs::read_dir(dir.path())
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().contains(".tmp"))
        .collect();
    assert!(leftovers.is_empty(), "不应残留 tmp 文件");
}

#[cfg(unix)]
#[test]
fn t4_atomic_write_failure_keeps_original() {
    use std::os::unix::fs::PermissionsExt;

    let dir = tempdir().unwrap();
    let path = dir.path().join("tokens.toml");
    let mut store = TokenStore::load(&path).unwrap();
    let rec = store.generate(TokenRole::Instance, "m1").unwrap();

    // 目录只读 → 下次写失败
    std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o500)).unwrap();
    let err = store.generate(TokenRole::Full, "tui").unwrap_err();
    assert!(
        matches!(
            err,
            crate::auth::StoreError::Io(_) | crate::auth::StoreError::Persist(_)
        ),
        "只读目录写失败应报错: {err}"
    );
    std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o700)).unwrap();

    // 原文件完好（无半文件、无脏记录）
    let reloaded = TokenStore::load(&path).unwrap();
    assert_eq!(reloaded.len(), 1);
    assert_eq!(reloaded.list()[0].id, rec.id);
}

// ---------------------------------------------------------------------------
// T5 mtime 重载：外部改写（模拟 CLI revoke）→ 下次 validate 拒绝
// ---------------------------------------------------------------------------
#[test]
fn t5_mtime_reload() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("tokens.toml");
    let mut store = TokenStore::load(&path).unwrap();
    let rec = store.generate(TokenRole::Instance, "m1").unwrap();
    assert!(store.validate(&rec.token, TokenRole::Instance).is_ok());

    // 外部（CLI）改写文件：revoked = true
    let content = format!(
        "version = 1\n\n[[tokens]]\nid = \"{}\"\nrole = \"instance\"\nname = \"m1\"\ntoken = \"{}\"\ncreated_at = \"{}\"\nrevoked = true\n",
        rec.id,
        rec.token,
        rec.created_at.to_rfc3339()
    );
    std::fs::write(&path, content).unwrap();
    // 强制 mtime 前进（部分文件系统时间戳精度低，避免同值漏检）
    let f = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
    f.set_modified(SystemTime::now() + Duration::from_secs(5))
        .unwrap();
    drop(f);

    // 下一次 validate 拒绝被吊销 token（mtime 变化触发重载）
    assert!(matches!(
        store.validate(&rec.token, TokenRole::Instance),
        Err(AuthError::RevokedToken { .. })
    ));
}

/// T5 补充：外部把文件改坏 → 保持旧内存态（不挂服务），旧 token 仍有效。
#[test]
fn t5_mtime_reload_bad_file_keeps_old_state() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("tokens.toml");
    let mut store = TokenStore::load(&path).unwrap();
    let rec = store.generate(TokenRole::Instance, "m1").unwrap();

    std::fs::write(&path, "not valid toml {{{").unwrap();
    let f = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
    f.set_modified(SystemTime::now() + Duration::from_secs(5))
        .unwrap();
    drop(f);

    assert!(
        store.validate(&rec.token, TokenRole::Instance).is_ok(),
        "坏文件不应导致服务中断"
    );
}

// ---------------------------------------------------------------------------
// T6 角色映射全组合
// ---------------------------------------------------------------------------
#[test]
fn t6_role_mapping() {
    let cases = [
        (TokenRole::Instance, Role::Instance, true),
        (TokenRole::Full, Role::Client, true),
        (TokenRole::ReadOnly, Role::Client, false),
    ];
    for (role, wire, can_send) in cases {
        assert_eq!(role.wire_role(), wire, "{role:?} 线级角色");
        assert_eq!(role.can_send_action(), can_send, "{role:?} 可发 action");
        assert_eq!(role.as_str(), role.to_string());
    }
}

// ---------------------------------------------------------------------------
// T7 常量时间比较（功能正确性）
// ---------------------------------------------------------------------------
#[test]
fn t7_constant_time_compare_semantics() {
    let dir = tempdir().unwrap();
    let mut store = new_store(dir.path());
    let rec = store.generate(TokenRole::Instance, "m1").unwrap();

    // 同 token 匹配
    assert!(store.validate(&rec.token, TokenRole::Instance).is_ok());
    // 异 token 不匹配（44 字符合法 base64，未登记）
    let foreign = base64::engine::general_purpose::STANDARD.encode([7u8; 32]);
    assert!(matches!(
        store.validate(&foreign, TokenRole::Instance),
        Err(AuthError::UnknownToken)
    ));
    // 等长前缀差异不匹配（改最后一个字符）
    let (head, last) = rec.token.split_at(rec.token.len() - 1);
    let mutated = format!("{head}{}", if last == "A" { "B" } else { "A" });
    assert!(matches!(
        store.validate(&mutated, TokenRole::Instance),
        Err(AuthError::UnknownToken)
    ));
}

/// T7 长度防御：加载时非 44 字符 → Err（拒绝启动）。
#[test]
fn t7_bad_token_length_rejected_on_load() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("tokens.toml");
    std::fs::write(
        &path,
        "version = 1\n\n[[tokens]]\nid = \"x\"\nrole = \"instance\"\nname = \"bad\"\ntoken = \"short\"\ncreated_at = \"2026-08-07T00:00:00Z\"\nrevoked = false\n",
    )
    .unwrap();
    assert!(matches!(
        TokenStore::load(&path),
        Err(crate::auth::StoreError::BadTokenLength)
    ));
}

// ---------------------------------------------------------------------------
// T8 脱敏
// ---------------------------------------------------------------------------
#[test]
fn t8_redaction() {
    let dir = tempdir().unwrap();
    let mut store = new_store(dir.path());
    let rec = store.generate(TokenRole::Full, "tui").unwrap();
    let token = rec.token.clone();

    // 1. TokenInfo 无 token 字段（结构保证）：Debug 输出不含 token 本体
    let info = &store.list()[0];
    assert!(
        !format!("{info:?}").contains(&token),
        "TokenInfo 泄露 token"
    );
    assert!(
        !info.to_string().contains(&token),
        "TokenInfo Display 泄露 token"
    );

    // 2. AuthError Display 不含凭证材料
    let err = store.validate(&token, TokenRole::Instance).unwrap_err();
    assert!(
        !err.to_string().contains(&token),
        "AuthError Display 泄露 token"
    );

    // 3. 审计事件（认证失败路径）字段 ⊆ 白名单且不含 token
    let mut svc = AuthService::new(store);
    let (result, log) = with_capture(|| {
        block_on(svc.authenticate_instance(
            &make_hello("totally-unknown-token-value", &new_nonce_b64()),
            peer(),
        ))
    });
    assert!(matches!(result, Err(AuthError::UnknownToken)));
    assert_audit_redacted(&log, &[&token]);

    // 4. audit() 直接调用（成功路径）字段 ⊆ 白名单
    let (_, log) = with_capture(|| {
        audit(
            "auth.client",
            Some("cmd-1"),
            Some(&rec.id),
            "ok",
            Duration::from_millis(3),
            None,
        )
    });
    assert_audit_redacted(&log, &[&token]);
}
