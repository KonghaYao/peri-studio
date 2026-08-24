//! 权限卡片的公开工具输入摘要。
//!
//! Control Doc 面向浏览器与只读主体，因此这里采用顶层字段白名单，并对命令
//! 仅暴露可执行文件及参数个数。未知字段、嵌套对象、环境变量与凭据一律不进入
//! 投影；摘要还受固定长度约束，避免把完整工具参数复制到控制面。

use serde_json::Value;

const SUMMARY_MAX_CHARS: usize = 512;
const VALUE_MAX_CHARS: usize = 160;

pub(crate) fn summarize_tool_input(arguments: Option<&Value>) -> Option<String> {
    let object = arguments?.as_object()?;
    let mut facts = Vec::new();
    for (key, label) in [
        ("cwd", "Working directory"),
        ("path", "Path"),
        ("url", "Host"),
        ("operation", "Operation"),
        ("action", "Action"),
        ("method", "Method"),
    ] {
        let Some(value) = object.get(key).and_then(Value::as_str) else {
            continue;
        };
        let visible = if key == "url" {
            public_url_origin(value)
        } else {
            sanitize(value)
        };
        if let Some(visible) = visible {
            facts.push(format!("{label}: {visible}"));
        }
    }
    for key in ["cmd", "command"] {
        if let Some(command) = object.get(key).and_then(Value::as_str) {
            if let Some(summary) = summarize_command(command) {
                facts.push(format!("Command: {summary}"));
                break;
            }
        }
    }
    let summary = facts.join(" · ");
    (!summary.is_empty() && summary.chars().count() <= SUMMARY_MAX_CHARS).then_some(summary)
}

fn summarize_command(command: &str) -> Option<String> {
    let words = command
        .split_whitespace()
        .skip_while(|word| is_shell_assignment(word))
        .collect::<Vec<_>>();
    let executable = sanitize(words.first().copied()?)?;
    let arguments = words.len().saturating_sub(1);
    Some(match arguments {
        0 => executable,
        1 => format!("{executable} (+1 argument)"),
        count => format!("{executable} (+{count} arguments)"),
    })
}

fn is_shell_assignment(word: &str) -> bool {
    let Some((name, _)) = word.split_once('=') else {
        return false;
    };
    let mut chars = name.chars();
    chars
        .next()
        .is_some_and(|first| first == '_' || first.is_ascii_alphabetic())
        && chars.all(|ch| ch == '_' || ch.is_ascii_alphanumeric())
}

fn public_url_origin(value: &str) -> Option<String> {
    let parsed = url::Url::parse(value).ok()?;
    let host = parsed.host_str()?;
    let port = parsed
        .port()
        .map(|port| format!(":{port}"))
        .unwrap_or_default();
    Some(format!("{}://{host}{port}", parsed.scheme()))
}

fn sanitize(value: &str) -> Option<String> {
    let normalized = value
        .chars()
        .map(|ch| if ch.is_control() { ' ' } else { ch })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    (!normalized.is_empty() && normalized.chars().count() <= VALUE_MAX_CHARS).then_some(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn exposes_only_allowlisted_public_facts() {
        let summary = summarize_tool_input(Some(&json!({
            "url": "https://example.test/private?token=secret",
            "token": "must-not-escape",
            "nested": { "path": "/private" }
        })))
        .unwrap();
        assert_eq!(summary, "Host: https://example.test");
    }

    #[test]
    fn executable_path_with_equals_never_promotes_an_argument_to_executable() {
        let summary = summarize_tool_input(Some(&json!({
            "cmd": "/tmp/tool=x super-secret"
        })))
        .unwrap();
        assert_eq!(summary, "Command: /tmp/tool=x (+1 argument)");
        assert!(!summary.contains("super-secret"));
    }
}
