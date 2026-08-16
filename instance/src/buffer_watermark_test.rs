//! 水位（§4.4.3）单测：roundtrip/损坏 fail-open/legacy 身份/epoch 单调。

use super::*;
use std::fs;

fn setup() -> tempfile::TempDir {
    tempfile::tempdir().unwrap()
}

#[test]
fn test_watermark_roundtrip() {
    let dir = setup();
    let mut wm = Watermark::load(dir.path()).unwrap();
    assert_eq!(wm.epoch_of("s1"), None);
    let fingerprint = ProcessFingerprint {
        platform: "test-v1".into(),
        birth: "123".into(),
    };
    wm.record("s1", 2, 137, 4321, Some(fingerprint.clone()))
        .unwrap();
    wm.record("s2", 1, 5, 900, None).unwrap();

    let wm2 = Watermark::load(dir.path()).unwrap();
    assert_eq!(wm2.epoch_of("s1"), Some(2));
    assert_eq!(wm2.epoch_of("s2"), Some(1));
    assert_eq!(wm2.epoch_of("nope"), None);
    let mut records = wm2.runtime_records();
    records.sort_by_key(|record| record.0);
    assert_eq!(records, vec![(900, None), (4321, Some(fingerprint))]);

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(dir.path().join("watermark.json"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600, "水位文件必须 0600");
    }
}

#[test]
fn test_watermark_corrupt_file_falls_back_empty() {
    let dir = setup();
    fs::write(dir.path().join("watermark.json"), "{corrupt json").unwrap();
    let wm = Watermark::load(dir.path()).unwrap();
    assert_eq!(
        wm.epoch_of("s1"),
        None,
        "损坏水位按空水位处理（不阻塞启动）"
    );
}

#[test]
fn test_watermark_legacy_runtime_identity_is_untrusted() {
    let dir = setup();
    fs::write(
        dir.path().join("watermark.json"),
        r#"{
      "chats": {"s1": {"epoch": 3, "lastSeq": 8, "pgid": 4321}}
    }"#,
    )
    .unwrap();
    let wm = Watermark::load(dir.path()).unwrap();
    assert_eq!(wm.epoch_of("s1"), Some(3));
    assert_eq!(wm.data_dir_identity(), None);
    assert_eq!(wm.runtime_records(), vec![(4321, None)]);
}

#[test]
fn test_watermark_epoch_monotonic() {
    // epoch 跨重启单调：record 后 epoch_of 返回记录值，调用方负责 +1。
    let dir = setup();
    let mut wm = Watermark::load(dir.path()).unwrap();
    wm.record("s1", 1, 0, 10, None).unwrap();
    let next = wm.epoch_of("s1").map_or(1, |e| e + 1);
    assert_eq!(next, 2);
}
