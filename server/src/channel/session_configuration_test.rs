use peri_studio_proto::schema::{
    SessionConfigCategory, SessionConfigChoiceProjection, SessionConfigOptionProjection,
};

use super::session_configuration::{
    catalog_has_current_value, catalog_selects, validate_identifier,
};

fn option(current_value: &str) -> SessionConfigOptionProjection {
    SessionConfigOptionProjection {
        id: "mode".into(),
        name: "Mode".into(),
        description: None,
        category: Some(SessionConfigCategory::Mode),
        current_value: current_value.into(),
        options: vec![
            SessionConfigChoiceProjection {
                value: "default".into(),
                name: "Default".into(),
                description: None,
            },
            SessionConfigChoiceProjection {
                value: "bypassPermissions".into(),
                name: "Bypass permissions".into(),
                description: Some("Allows tools without individual approval".into()),
            },
        ],
    }
}

#[test]
fn request_validation_uses_the_agent_catalog_but_response_requires_exact_current_value() {
    let catalog = vec![option("default")];
    assert!(catalog_selects(&catalog, "mode", "bypassPermissions"));
    assert!(!catalog_has_current_value(
        &catalog,
        "mode",
        "bypassPermissions"
    ));

    let returned = vec![option("bypassPermissions")];
    assert!(catalog_has_current_value(
        &returned,
        "mode",
        "bypassPermissions"
    ));
}

#[test]
fn identifiers_are_bounded_before_they_reach_the_agent() {
    assert!(validate_identifier("").is_err());
    assert!(validate_identifier(&"x".repeat(129)).is_err());
    assert!(validate_identifier("thinking_effort").is_ok());
}
