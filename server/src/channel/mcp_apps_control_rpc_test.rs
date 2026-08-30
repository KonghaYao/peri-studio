use super::*;

const RESOURCE_URI: &str = "ui://get-time/mcp-app.html";

#[test]
fn open_result_deserializes_peri_shape() {
    let value = serde_json::json!({
        "envelopeVersion": ENVELOPE_VERSION,
        "appsProtocolVersion": APPS_PROTOCOL_VERSION,
        "mcpProtocolVersion": "2025-03-26",
        "serverId": "official-apps-fixture",
        "appSessionId": "app-session-1",
        "resourceUri": RESOURCE_URI,
    });
    let result: OpenResult = serde_json::from_value(value).unwrap();
    assert_eq!(result.app_session_id, "app-session-1");
    assert_eq!(result.resource_uri, RESOURCE_URI);
}

#[test]
fn resource_result_deserializes_peri_meta_csp() {
    let value = serde_json::json!({
        "envelopeVersion": ENVELOPE_VERSION,
        "appsProtocolVersion": APPS_PROTOCOL_VERSION,
        "mcpProtocolVersion": "2025-03-26",
        "serverId": "official-apps-fixture",
        "resources": [{
            "uri": RESOURCE_URI,
            "mimeType": "text/html;profile=mcp-app",
            "text": "<html><body>MCP App</body></html>",
            "_meta": {
                "ui": {
                    "csp": {
                        "connectDomains": [],
                        "resourceDomains": []
                    }
                }
            }
        }]
    });
    let result: ResourceResult = serde_json::from_value(value).unwrap();
    let (html, mime_type, csp) = pick_html_resource(result.resources, RESOURCE_URI).unwrap();
    assert!(html.contains("MCP App"));
    assert_eq!(mime_type, "text/html;profile=mcp-app");
    assert_eq!(csp, None);
}

#[test]
fn pick_html_resource_synthesizes_csp_from_domain_lists() {
    let resources = vec![ResourceItem {
        uri: RESOURCE_URI.into(),
        mime_type: "text/html;profile=mcp-app".into(),
        text: Some("<html></html>".into()),
        blob: None,
        meta: Some(serde_json::json!({
            "ui": {
                "csp": {
                    "connectDomains": ["https://api.example.com"],
                    "resourceDomains": ["https://cdn.example.com"]
                }
            }
        })),
    }];
    let (_, _, csp) = pick_html_resource(resources, RESOURCE_URI).unwrap();
    let csp = csp.expect("csp");
    assert!(csp.contains("connect-src 'self' https://api.example.com"));
    assert!(csp.contains("img-src 'self' data: https://cdn.example.com"));
}

#[test]
fn pick_html_resource_rejects_oversize_payload() {
    let huge = "x".repeat(HTML_MAX_BYTES + 1);
    let resources = vec![ResourceItem {
        uri: "ui://fixture/app".into(),
        mime_type: "text/html;profile=mcp-app".into(),
        text: Some(huge),
        blob: None,
        meta: None,
    }];
    assert_eq!(
        pick_html_resource(resources, "ui://fixture/app"),
        Err("agent_unavailable")
    );
}
