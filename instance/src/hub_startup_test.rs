//! hub startup 清理集成测试（§8 第三层：崩溃路径的进程组所有权验证）。

use super::hub_test_common::*;
use super::*;
use std::fs;

#[tokio::test]
async fn test_startup_cleanup_kills_only_exact_owned_process_group() {
    let dir = tempfile::tempdir().unwrap();
    let (_process, pgid) = spawn_cleanup_target("owned").await;
    prepare_owned_watermark(dir.path(), pgid, crate::child::process_fingerprint(pgid));
    let config = test_config("127.0.0.1:1".parse().unwrap(), dir.path());
    let (watermark, buffer_lost, _lock) = super::startup::startup_cleanup(&config).unwrap();
    assert!(buffer_lost, "持久运行记录必须上报 buffer_lost");
    assert!(wait_group_exit(pgid).await, "精确所有权匹配必须清理进程组");
    assert!(
        watermark.runtime_records().is_empty(),
        "清理权必须一次性消费"
    );
    assert_eq!(
        watermark.epoch_of("cleanup-target"),
        Some(4),
        "epoch 历史必须保留"
    );
    let reopened = Watermark::load(dir.path()).unwrap();
    assert_eq!(
        reopened.data_dir_identity(),
        Some(super::startup::data_dir_identity(dir.path()).unwrap())
    );
    assert!(reopened.runtime_records().is_empty());
}

#[tokio::test]
async fn test_startup_cleanup_skips_copied_directory_identity() {
    let dir = tempfile::tempdir().unwrap();
    let (_process, pgid) = spawn_cleanup_target("copied").await;
    prepare_owned_watermark(dir.path(), pgid, crate::child::process_fingerprint(pgid));
    let original = Watermark::load(dir.path())
        .unwrap()
        .data_dir_identity()
        .unwrap();
    let mut json: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(dir.path().join("watermark.json")).unwrap())
            .unwrap();
    json["dataDirIdentity"]["inode"] = serde_json::json!(original.inode.saturating_add(1));
    fs::write(
        dir.path().join("watermark.json"),
        serde_json::to_vec_pretty(&json).unwrap(),
    )
    .unwrap();
    let config = test_config("127.0.0.1:1".parse().unwrap(), dir.path());
    let (_watermark, buffer_lost, _lock) = super::startup::startup_cleanup(&config).unwrap();
    assert!(buffer_lost);
    assert!(crate::child::sys::kill_group(pgid, 0), "目录副本不得继承清理权");
    crate::child::sys::kill_group(pgid, crate::child::sys::SIGKILL);
    assert!(wait_group_exit(pgid).await);
}

#[tokio::test]
async fn test_startup_cleanup_skips_legacy_unfingerprinted_record() {
    let dir = tempfile::tempdir().unwrap();
    let (_process, pgid) = spawn_cleanup_target("legacy").await;
    prepare_owned_watermark(dir.path(), pgid, None);
    let config = test_config("127.0.0.1:1".parse().unwrap(), dir.path());
    let (_watermark, buffer_lost, _lock) = super::startup::startup_cleanup(&config).unwrap();
    assert!(buffer_lost);
    assert!(
        crate::child::sys::kill_group(pgid, 0),
        "旧格式不能证明所有权，不得发信号"
    );
    crate::child::sys::kill_group(pgid, crate::child::sys::SIGKILL);
    assert!(wait_group_exit(pgid).await);
}

#[tokio::test]
async fn test_startup_cleanup_skips_reused_pgid_with_different_birth_identity() {
    let dir = tempfile::tempdir().unwrap();
    let (_process, pgid) = spawn_cleanup_target("reused-pgid").await;
    let mut fingerprint = crate::child::process_fingerprint(pgid).expect("测试平台应支持出生指纹");
    fingerprint.birth.push_str(":different-process");
    prepare_owned_watermark(dir.path(), pgid, Some(fingerprint));
    let config = test_config("127.0.0.1:1".parse().unwrap(), dir.path());
    let (_watermark, buffer_lost, _lock) = super::startup::startup_cleanup(&config).unwrap();
    assert!(buffer_lost);
    assert!(
        crate::child::sys::kill_group(pgid, 0),
        "相同 PGID 但不同出生身份不得发信号"
    );
    crate::child::sys::kill_group(pgid, crate::child::sys::SIGKILL);
    assert!(wait_group_exit(pgid).await);
}

#[test]
fn test_startup_cleanup_treats_missing_leader_as_already_gone() {
    let dir = tempfile::tempdir().unwrap();
    let missing_pgid = i32::MAX;
    prepare_owned_watermark(
        dir.path(),
        missing_pgid,
        Some(crate::buffer::ProcessFingerprint {
            platform: "missing-test".into(),
            birth: "gone".into(),
        }),
    );
    let config = test_config("127.0.0.1:1".parse().unwrap(), dir.path());
    let (watermark, buffer_lost, _lock) = super::startup::startup_cleanup(&config).unwrap();
    assert!(buffer_lost);
    assert!(
        watermark.runtime_records().is_empty(),
        "不存在的 leader 应安全消费旧清理权"
    );
}

#[test]
fn test_startup_cleanup_rejects_second_daemon_for_same_directory() {
    let dir = tempfile::tempdir().unwrap();
    let config = test_config("127.0.0.1:1".parse().unwrap(), dir.path());
    let (_watermark, _lost, _lock) = super::startup::startup_cleanup(&config).unwrap();
    let error = super::startup::startup_cleanup(&config)
        .err()
        .expect("第二个 daemon 必须被拒绝");
    assert!(
        error.to_string().contains("already owned"),
        "unexpected: {error}"
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(dir.path().join("instance.owner.lock"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600, "owner lock 必须是 0600");
    }
}
