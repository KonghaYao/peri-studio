//! Heartbeat 单测（§16 默认 5s 间隔；pong 超时 3×interval）。

use std::time::{Duration, Instant};

use super::*;

#[test]
fn timeout_three_times_interval() {
    let hb = Heartbeat::new(Duration::from_secs(5));
    assert_eq!(hb.timeout, Duration::from_secs(15));
}

#[test]
fn driver_pong_extends_window() {
    let mut d = HeartbeatDriver::new(Duration::from_secs(5), Duration::from_secs(15));
    let t0 = Instant::now();
    // 14s 未 pong：未超时。
    assert!(!d.check_timeout(t0 + Duration::from_secs(14)));
    // 16s：超时。
    assert!(d.check_timeout(t0 + Duration::from_secs(16)));
    // pong 续期后重置。
    d.on_pong();
    assert!(!d.check_timeout(Instant::now()));
    assert!(!d.check_timeout(Instant::now() + Duration::from_secs(14)));
    assert!(d.check_timeout(Instant::now() + Duration::from_secs(16)));
}

#[test]
fn driver_keepalive_period() {
    let mut d = HeartbeatDriver::new(Duration::from_secs(5), Duration::from_secs(15));
    let t0 = Instant::now();
    // 创建即视为到期（last_sent = 创建时刻 - interval）→ 首次检查应发。
    assert!(d.should_send_keepalive(t0));
    d.note_sent();
    // note_sent 后 last_sent = 真实 now（≥ t0）；以真实 now 为基准避免
    // 时钟微差。
    let base = Instant::now();
    assert!(!d.should_send_keepalive(base + Duration::from_secs(4)));
    assert!(d.should_send_keepalive(base + Duration::from_secs(5)));
}
