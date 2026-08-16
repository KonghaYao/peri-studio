//! 关闭码单测：码值稳定性 + 重连策略映射表（§4.7）。

use super::*;

#[test]
fn policy_table() {
    assert_eq!(reconnect_policy(4500), ReconnectPolicy::Stop);
    assert_eq!(reconnect_policy(4501), ReconnectPolicy::ManualOnly);
    assert_eq!(reconnect_policy(4502), ReconnectPolicy::StopPermanent);
    assert_eq!(reconnect_policy(1011), ReconnectPolicy::Backoff);
    assert_eq!(reconnect_policy(1013), ReconnectPolicy::Backoff);
}
