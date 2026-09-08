//! Control Doc 结构完整性测试（§12.1 可选）：additive 字段 + 有界投影形态。

use super::util::control_root;

#[test]
fn legacy_control_doc_defaults_missing_elicitations() {
    let mut value = serde_json::to_value(control_root()).unwrap();
    value
        .as_object_mut()
        .expect("control root object")
        .remove("pendingElicitations");
    let decoded: crate::schema::SessionDocRoot = serde_json::from_value(value).unwrap();
    assert!(decoded.pending_elicitations.is_empty());
}

#[test]
fn legacy_control_doc_defaults_missing_session_list_loaded() {
    let mut value = serde_json::to_value(control_root()).unwrap();
    value
        .as_object_mut()
        .expect("control root object")
        .remove("sessionListLoaded");
    let decoded: crate::schema::SessionDocRoot = serde_json::from_value(value).unwrap();
    assert!(!decoded.session_list_loaded);
}

#[test]
fn session_config_catalog_roundtrip_uses_bounded_projection_shape() {
    let option = crate::schema::SessionConfigOptionProjection {
        id: "thinking_effort".into(),
        name: "Thinking Effort".into(),
        description: Some("Controls reasoning depth".into()),
        category: Some(crate::schema::SessionConfigCategory::ThoughtLevel),
        current_value: "high".into(),
        options: vec![crate::schema::SessionConfigChoiceProjection {
            value: "max".into(),
            name: "Max".into(),
            description: None,
        }],
    };
    let value = serde_json::to_value(&option).unwrap();
    assert_eq!(value["currentValue"], "high");
    assert_eq!(value["category"], "thought_level");
    assert_eq!(
        serde_json::from_value::<crate::schema::SessionConfigOptionProjection>(value).unwrap(),
        option
    );
}
