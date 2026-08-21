//! Translator 出站帧的参数裁决辅助：option 选档与 cwd 校验（§4.3）。
//!
//! 拆分动机：translator.rs 504 行超阈值（≤500 行要求），将 impl 之外的
//! 私有辅助函数迁至本模块；纯移动，语义零改动。

use serde_json::Value;

use super::{TranslateError, CWD_MAX_BYTES};

/// 第一个 `options[i]` 的 `optionId`（保底选档；options 已在入站解析时
/// 校验为 `{optionId,name,kind}` 对象数组）。
pub(super) fn first_option_id(options: &[Value]) -> Option<String> {
    options.iter().find_map(|v| {
        v.get("optionId")
            .and_then(Value::as_str)
            .map(str::to_string)
    })
}

/// 第一个 `kind` 命中 `kinds`（含 camelCase 别名）的 `optionId`。
pub(super) fn pick_option_id(options: &[Value], kinds: &[&str]) -> Option<String> {
    options.iter().find_map(|v| {
        let obj = v.as_object()?;
        let kind = obj.get("kind").and_then(Value::as_str)?;
        if kinds
            .iter()
            .any(|k| kind == *k || camel_of(k) == Some(kind))
        {
            obj.get("optionId")
                .and_then(Value::as_str)
                .map(str::to_string)
        } else {
            None
        }
    })
}

/// kebab-case → camelCase 别名（`allow_once` → `allowOnce`；`reject_once`
/// 官方无 camel 形态，防御性同兼容——评审 P2-e 先例）。
fn camel_of(kebab: &str) -> Option<&'static str> {
    match kebab {
        "allow_once" => Some("allowOnce"),
        "allow_always" => Some("allowSession"),
        "reject_once" => Some("rejectOnce"),
        "reject_always" => Some("rejectAlways"),
        _ => None,
    }
}

/// cwd 形态校验（§4.3 裁决）：绝对路径 + 无 NUL/控制字符 + ≤ 4KB。
///
/// M1 默认目录 = **server 进程工作目录**（常驻进程由托管系统设定，是「已认证
/// 上下文」可得的唯一稳定目录；ws 无法获取 TUI 本地 cwd）。
pub fn validate_cwd(cwd: &str) -> Result<(), TranslateError> {
    if cwd.is_empty() {
        return Err(TranslateError::MissingCwd);
    }
    if cwd.len() > CWD_MAX_BYTES {
        return Err(TranslateError::BadCwd("too long"));
    }
    if !cwd.starts_with('/') {
        return Err(TranslateError::BadCwd("relative path"));
    }
    if cwd
        .chars()
        .any(|c| c == '\0' || c.is_control() || c == '\n' || c == '\r')
    {
        return Err(TranslateError::BadCwd("control characters"));
    }
    Ok(())
}
