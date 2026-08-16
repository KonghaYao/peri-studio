//! buffer 单测：分桶（T3）、分类丢弃（T4）、磁盘溢出（T5）、drain/commit/
//! rollback 补推语义、环形滑窗、水位。

use super::*;
use std::fs;
use std::path::Path;

/// 事件类帧（无 id）。
fn event_frame(n: u64) -> serde_json::Value {
    serde_json::json!({"type": "session/update", "payload": {"sessionId": "s1", "n": n}})
}

/// 控制类帧（JSON-RPC 含 id）。
fn control_frame(n: u64) -> serde_json::Value {
    serde_json::json!({"jsonrpc": "2.0", "id": n, "method": "session/prompt"})
}

/// 小预算缓冲池（测试用）。
fn small_buffer(dir: &Path) -> Buffer {
    Buffer::new(
        200,    // mem_bytes_limit（小）
        1000,   // mem_frames_limit
        400,    // total_bytes_limit（小，触发丢弃）
        1000,   // total_frames_limit
        10_000, // max_frame_bytes
        dir.join("buffer"),
    )
}

fn setup() -> tempfile::TempDir {
    tempfile::tempdir().unwrap()
}

// ---------------------------------------------------------------------------
// 分桶（T3）
// ---------------------------------------------------------------------------

#[test]
fn test_buckets_are_isolated() {
    let dir = setup();
    let mut buf = small_buffer(dir.path());
    buf.push("s1", 1, event_frame(1));
    buf.push("s2", 1, event_frame(1));
    buf.push("s1", 2, event_frame(2));

    assert!(buf.has_pending("s1"));
    assert!(buf.has_pending("s2"));
    let (from, frames) = buf.drain_batch("s1", 10, 1 << 20).unwrap();
    assert_eq!(from, 1);
    assert_eq!(frames.iter().map(|f| f.seq).collect::<Vec<_>>(), vec![1, 2]);
    assert!(
        buf.has_pending("s1"),
        "drain 是 peek 语义：未 commit 仍视为 pending"
    );
    assert!(buf.has_pending("s2"), "s2 不受 s1 影响");
}

// ---------------------------------------------------------------------------
// 分类丢弃（T4）
// ---------------------------------------------------------------------------

#[test]
fn test_classify_frame() {
    assert_eq!(classify_frame(&event_frame(1)), FrameKind::Event);
    assert_eq!(classify_frame(&control_frame(1)), FrameKind::Control);
    // 通知（jsonrpc 无 id）→ 事件类。
    assert_eq!(
        classify_frame(&serde_json::json!({"jsonrpc": "2.0", "method": "m"})),
        FrameKind::Event
    );
}

#[test]
fn test_evict_prefers_event_frames() {
    let dir = setup();
    // total_bytes_limit=400：控制帧(约80B) + 事件帧×N，超预算时事件帧先被丢。
    let mut buf = Buffer::new(
        10_000,
        10_000,
        200,
        10_000,
        10_000,
        dir.path().join("buffer"),
    );
    // C1(控制) 入列。
    buf.push("s1", 1, control_frame(1));
    let budget_used = buf.water_level().0;
    // E1..E5 事件帧：逐步超预算。
    for i in 1..=5u64 {
        buf.push("s1", i + 1, event_frame(i));
    }
    // 控制类保留到最后：事件帧全部被优先丢弃（预算 200B：C1~45B + 5×事件
    // ~65B 持续超限 → 每帧触发一次事件丢弃；仅最后入列的事件帧存活）。
    assert!(buf.has_pending("s1"));
    let (_, frames) = buf.drain_batch("s1", 100, 1 << 20).unwrap();
    let kinds: Vec<FrameKind> = frames.iter().map(|f| classify_frame(&f.frame)).collect();
    assert!(
        kinds
            .iter()
            .take(frames.len() - 1)
            .all(|k| *k == FrameKind::Control),
        "超预算时事件帧优先丢弃，控制帧最后丢弃；剩余: {kinds:?}"
    );
    assert!(budget_used > 0);
    let (e, c, o) = buf.dropped_stats();
    assert_eq!(e, 4, "4 个事件帧被优先丢弃");
    assert_eq!(c, 0, "控制帧不得先于事件帧被丢弃");
    assert_eq!(o, 0);
}

#[test]
fn test_evict_control_when_no_event_left() {
    let dir = setup();
    let mut buf = Buffer::new(
        10_000,
        10_000,
        1, // 预算 1B：任何帧入列即超限 → 无事件帧可丢 → 丢最旧控制帧
        10_000,
        10_000,
        dir.path().join("buffer"),
    );
    buf.push("s1", 1, control_frame(1));
    buf.push("s1", 2, control_frame(2));
    let (e, c, o) = buf.dropped_stats();
    assert_eq!(e, 0);
    assert!(c >= 1, "无事件帧可丢时必须丢弃最旧控制帧，实际 c={c}");
    assert_eq!(o, 0);
}

#[test]
fn test_oversize_skipped_with_gap_count() {
    // 问题 13：单帧超限的 gap 计数归调用方（hub `oversize_gaps`）单一入口——
    // buffer 只返回 Oversize 结果，不再内计 dropped_oversize（避免双计）。
    let dir = setup();
    let mut buf = Buffer::new(
        10_000,
        10_000,
        1 << 20,
        10_000,
        100,
        dir.path().join("buffer"),
    );
    let big = serde_json::json!({"payload": {"sessionId": "s1", "blob": "x".repeat(200)}});
    assert_eq!(buf.push("s1", 1, big), PushOutcome::Oversize);
    assert!(!buf.has_pending("s1"), "超限帧不入缓冲");
    let (e, c, d) = buf.dropped_stats();
    assert_eq!((e, c, d), (0, 0, 0), "超限不计入 buffer 丢弃分类");
    // 后续正常帧不受影响。
    assert_eq!(buf.push("s1", 2, event_frame(2)), PushOutcome::Buffered);
}

#[test]
fn test_frames_limit_eviction() {
    let dir = setup();
    let mut buf = Buffer::new(
        10_000,
        10_000,
        1 << 20,
        3,
        10_000,
        dir.path().join("buffer"),
    );
    for i in 1..=5u64 {
        buf.push("s1", i, event_frame(i));
    }
    // 上限 3 条：第 4/5 帧触发丢弃（最旧事件帧）。
    let (_, frames) = buf.drain_batch("s1", 100, 1 << 20).unwrap();
    assert!(frames.len() <= 3);
    let (e, _, _) = buf.dropped_stats();
    assert_eq!(e, 2);
}

// ---------------------------------------------------------------------------
// 磁盘溢出（T5）
// ---------------------------------------------------------------------------

#[test]
fn test_disk_spill_and_drain_order() {
    let dir = setup();
    let mut buf = Buffer::new(
        120, // mem 预算极小 → 第 2 帧起写盘
        10_000,
        1 << 20,
        10_000,
        10_000,
        dir.path().join("buffer"),
    );
    for i in 1..=6u64 {
        assert_eq!(buf.push("s1", i, event_frame(i)), PushOutcome::Buffered);
    }
    let (from, frames) = buf.drain_batch("s1", 100, 1 << 20).unwrap();
    assert_eq!(from, 1);
    assert_eq!(
        frames.iter().map(|f| f.seq).collect::<Vec<_>>(),
        vec![1, 2, 3, 4, 5, 6],
        "内存 + 磁盘段 drain 顺序必须一致（seq 升序）"
    );

    // 磁盘文件存在且 0600。
    let file = dir.path().join("buffer").join("s1.buf");
    assert!(file.exists(), "溢出帧应落盘");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(&file).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "缓冲文件必须 0600（§8.5）");
    }
}

#[test]
fn test_remove_deletes_files() {
    let dir = setup();
    let mut buf = Buffer::new(
        1, // 全部写盘
        10_000,
        1 << 20,
        10_000,
        10_000,
        dir.path().join("buffer"),
    );
    buf.push("s1", 1, event_frame(1));
    let file = dir.path().join("buffer").join("s1.buf");
    assert!(file.exists());
    buf.remove("s1");
    assert!(!file.exists(), "session 清理必须删除缓冲文件（§8.5）");
    assert!(!buf.has_pending("s1"));
}

#[test]
fn test_clear_all_on_startup() {
    let dir = setup();
    let mut buf = Buffer::new(
        1,
        10_000,
        1 << 20,
        10_000,
        10_000,
        dir.path().join("buffer"),
    );
    buf.push("s1", 1, event_frame(1));
    assert!(dir.path().join("buffer").exists());
    buf.clear_all();
    assert!(
        !dir.path().join("buffer").exists(),
        "启动清理删除 buffer/ 目录（§3.3）"
    );
    assert!(!buf.has_any_pending());
}

// ---------------------------------------------------------------------------
// P1-7：断线溢盘每帧 flush → 读前一次性 flush
// ---------------------------------------------------------------------------

/// 小数据帧（< BufWriter 8KB 缓冲，保证 append 后数据停留在 writer 缓冲）。
fn tiny_frame(seq: u64) -> Vec<u8> {
    serde_json::to_vec(&BufferedFrame {
        seq,
        frame: event_frame(seq),
    })
    .unwrap()
}

#[test]
fn test_append_no_per_frame_flush_until_drain() {
    // P1-7：append 只写 BufWriter 缓冲不落盘（省每帧 5-50µs flush）；
    // 读路径（ensure_reader）才触发一次性 flush，独立 reader 可见。
    let dir = setup();
    let mut seg = DiskSegment::open(dir.path(), "s1").unwrap();
    let bytes = tiny_frame(1);
    seg.append(&bytes).unwrap();
    // 未触发读前 flush：数据停留在 BufWriter 缓冲，文件尚无内容。
    assert_eq!(
        fs::read(dir.path().join("s1.buf")).unwrap().len(),
        0,
        "append 后不得立即 flush（P1-7）"
    );
    // 读路径触发一次性 flush → 独立 reader 读到完整记录。
    let mut len = 0;
    let bf = seg.peek_one(&mut len).unwrap().expect("应读到首帧");
    assert_eq!(bf.seq, 1);
    assert_eq!(len, 4 + bytes.len());
    assert_eq!(
        fs::read(dir.path().join("s1.buf")).unwrap().len(),
        4 + bytes.len(),
        "读前 flush 一次后记录落盘"
    );
}

#[test]
fn test_append_after_drain_reflushes() {
    // P1-7：读（drain）触发 flush 后再次 append，需再次读前 flush 才可见。
    let dir = setup();
    let mut seg = DiskSegment::open(dir.path(), "s1").unwrap();
    let bytes1 = tiny_frame(1);
    seg.append(&bytes1).unwrap();
    // 第一次读：触发 flush，文件 = 帧 1。
    let mut len1 = 0;
    seg.peek_one(&mut len1).unwrap();
    assert_eq!(fs::read(dir.path().join("s1.buf")).unwrap().len(), len1);
    // 追加帧 2：未触发读，数据停留缓冲，文件长度不变。
    let bytes2 = tiny_frame(2);
    seg.append(&bytes2).unwrap();
    assert_eq!(
        fs::read(dir.path().join("s1.buf")).unwrap().len(),
        len1,
        "drain 后再次 append 不得立即 flush（P1-7）"
    );
    // 消费帧 1 后再读：再次触发 flush，帧 2 落盘且可读。
    let consumed = seg.consume_one().unwrap().expect("消费帧 1");
    assert_eq!(consumed.0.seq, 1);
    let mut len2 = 0;
    let bf = seg.peek_one(&mut len2).unwrap().expect("应读到帧 2");
    assert_eq!(bf.seq, 2);
    assert_eq!(len2, 4 + bytes2.len());
    assert_eq!(
        fs::read(dir.path().join("s1.buf")).unwrap().len(),
        len1 + len2,
        "再次读前 flush 后帧 2 落盘"
    );
}

#[test]
fn test_evict_from_disk_then_drain() {
    // P1-7：预算丢弃从磁盘段首 evict（读路径一次性 flush），
    // evict 与 drain 交错且无每帧 flush 后，顺序与计数仍正确。
    let dir = setup();
    let mut buf = Buffer::new(
        1,    // mem 预算极小 → 全部写盘
        10_000,
        300,  // total 预算小 → 触发磁盘段首 evict
        10_000,
        10_000,
        dir.path().join("buffer"),
    );
    // 帧加大 payload，保证 6 帧合计必然超 300B 预算。
    for i in 1..=6u64 {
        let frame = serde_json::json!({
            "type": "session/update",
            "payload": {"sessionId": "s1", "n": i, "blob": "x".repeat(24)},
        });
        assert_eq!(buf.push("s1", i, frame), PushOutcome::Buffered);
    }
    let (e, c, o) = buf.dropped_stats();
    assert_eq!(o, 0);
    assert_eq!(c, 0);
    assert!(e >= 1, "磁盘段首事件帧被优先丢弃，实际 e={e}");
    // evict 后 drain：from_seq 与剩余帧顺序 = 存活首帧起（丢弃的是最旧 e 帧）。
    let (from, frames) = buf.drain_batch("s1", 100, 1 << 20).unwrap();
    assert_eq!(from, 1 + e, "from_seq = 存活首帧 seq");
    assert_eq!(frames.len() as u64, 6 - e);
    let seqs: Vec<u64> = frames.iter().map(|f| f.seq).collect();
    assert_eq!(seqs, (1 + e..=6).collect::<Vec<_>>(), "尾部 seq 连续");
    // 全部消费后计数归零。
    buf.commit("s1");
    assert!(!buf.has_pending("s1"));
    assert_eq!(buf.water_level(), (0, 0));
}

// ---------------------------------------------------------------------------
// drain / commit / rollback（§6.1/§6.2 补推语义）
// ---------------------------------------------------------------------------

#[test]
fn test_drain_commit_flow() {
    let dir = setup();
    let mut buf = small_buffer(dir.path());
    for i in 1..=4u64 {
        buf.push("s1", i, event_frame(i));
    }
    let (from, frames) = buf.drain_batch("s1", 2, 1 << 20).unwrap();
    assert_eq!((from, frames.len()), (1, 2));
    assert!(buf.has_pending("s1"), "peek 语义：未 commit 仍为 pending");
    buf.commit("s1");
    assert!(buf.has_pending("s1"), "commit 一批后仍剩余 2 帧");
    let (from2, frames2) = buf.drain_batch("s1", 10, 1 << 20).unwrap();
    assert_eq!((from2, frames2.len()), (3, 2));
    buf.commit("s1");
    assert!(!buf.has_pending("s1"));
    assert!(!buf.has_any_pending());
}

#[test]
fn test_rollback_keeps_order_and_from_seq() {
    let dir = setup();
    let mut buf = small_buffer(dir.path());
    for i in 1..=4u64 {
        buf.push("s1", i, event_frame(i));
    }
    let (from, frames) = buf.drain_batch("s1", 2, 1 << 20).unwrap();
    assert_eq!(from, 1);
    buf.rollback("s1"); // 发送中断（断线）
    let (from2, frames2) = buf.drain_batch("s1", 10, 1 << 20).unwrap();
    assert_eq!(from2, 1, "rollback 后 from_seq 不变（§6.2 重发语义）");
    assert_eq!(frames2.len(), 4);
    assert_eq!(frames[0].seq, 1);
    buf.commit("s1");
    assert!(!buf.has_pending("s1"));
}

#[test]
fn test_new_frames_append_during_pending() {
    // 补推期间新帧追加 pending 尾部（§6.1：随补推续发）。
    let dir = setup();
    let mut buf = small_buffer(dir.path());
    for i in 1..=2u64 {
        buf.push("s1", i, event_frame(i));
    }
    let (from, frames) = buf.drain_batch("s1", 2, 1 << 20).unwrap();
    assert_eq!((from, frames.len()), (1, 2));
    // 补推中（未 commit）新帧到达。
    buf.push("s1", 3, event_frame(3));
    buf.push("s1", 4, event_frame(4));
    let (from2, frames2) = buf.drain_batch("s1", 10, 1 << 20).unwrap();
    assert_eq!(from2, 3, "续发从 pending 首帧（seq 3）起");
    assert_eq!(
        frames2.iter().map(|f| f.seq).collect::<Vec<_>>(),
        vec![3, 4]
    );
}

// ---------------------------------------------------------------------------
// 环形滑窗（§4.4.2）
// ---------------------------------------------------------------------------

#[test]
fn test_ring_buffer_evicts_oldest() {
    let mut ring = RingBuffer::new(3);
    for i in 1..=5u64 {
        ring.push(BufferedFrame {
            seq: i,
            frame: event_frame(i),
        });
    }
    let snap = ring.snapshot();
    assert_eq!(snap.len(), 3);
    assert_eq!(
        snap.iter().map(|f| f.seq).collect::<Vec<_>>(),
        vec![3, 4, 5],
        "满则淘汰最旧"
    );
}


