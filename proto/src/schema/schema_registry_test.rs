//! Registry Doc 结构完整性测试（§12.1 可选）：workspaces 镜像 round-trip。

use crate::schema::{RegistryDocRoot, WorkspaceSummary};

use super::util::registry_root;

/// `RegistryDocRoot` 的 `workspaces` 镜像（review 问题 6）：类型镜像必须与
/// server 实际持久化模型一致（`write_workspace` 写入 `workspaces` map）；
/// 缺失该字段的镜像会在未来「读全 doc」路径静默丢弃工作区。
#[test]
fn registry_root_workspaces_roundtrip_and_camel_case_shape() {
    let root = registry_root();
    assert_eq!(root.workspaces.len(), 1, "workspaces 镜像应包含构造条目");

    // camelCase 字段名（§2 序列化约定）
    let value = serde_json::to_value(&root).unwrap();
    assert_eq!(value["workspaces"]["ws1"]["id"], "ws1");
    assert_eq!(value["workspaces"]["ws1"]["name"], "demo-ws");
    assert_eq!(value["workspaces"]["ws1"]["cwd"], "/");

    // 完整 round-trip
    let back: RegistryDocRoot =
        serde_json::from_str(&serde_json::to_string(&root).unwrap()).unwrap();
    assert_eq!(back, root);

    // 旧快照（缺 workspaces 键）解码为空 map（additive，兼容读全 doc 路径）
    let mut legacy = serde_json::to_value(&root).unwrap();
    legacy.as_object_mut().expect("root object").remove("workspaces");
    let decoded: RegistryDocRoot = serde_json::from_value(legacy).unwrap();
    assert!(decoded.workspaces.is_empty());
}

/// `WorkspaceSummary` 是 root `workspaces` map 的值类型（独立于 chat 的
/// 上层概念）；其字段名 camelCase 与 round-trip 一并固化。
#[test]
fn workspace_summary_is_a_registry_map_value() {
    let ws = WorkspaceSummary {
        id: "ws1".into(),
        name: "demo-ws".into(),
        cwd: "/".into(),
        created_at: "2026-08-01T00:00:00Z".into(),
        updated_at: "2026-08-07T00:00:01Z".into(),
    };
    let value = serde_json::to_value(&ws).unwrap();
    assert_eq!(value["createdAt"], "2026-08-01T00:00:00Z");
    assert_eq!(value["updatedAt"], "2026-08-07T00:00:01Z");
    assert_eq!(serde_json::from_value::<WorkspaceSummary>(value).unwrap(), ws);
}
