//! SSH destination 与 identity 路径校验（ssh-machine-mount §6.4）。

/// 校验 SSH destination 字符串（不含密码；供 argv `--` 之后使用）。
pub fn validate_ssh_destination(destination: &str) -> Result<(), String> {
    if destination.is_empty() {
        return Err("destination is required".into());
    }
    if destination.len() > 255 {
        return Err("destination is too long".into());
    }
    if destination.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("destination contains invalid characters".into());
    }
    if destination.starts_with('-') {
        return Err("destination must not start with '-'".into());
    }
    if destination.contains("://") {
        return Err("destination must not contain a URL scheme".into());
    }
  if destination.contains('@') {
        let user_part = destination.split('@').next().unwrap_or("");
        if user_part.contains(':') {
            return Err("passwords in destination are not supported".into());
        }
    }
    Ok(())
}

/// 本机 identity 文件路径（可选）；内容不得读入 server 内存。
pub fn validate_identity_file_path(path: Option<&str>) -> Result<(), String> {
    if let Some(path) = path {
        if path.is_empty() {
            return Err("identity file path is empty".into());
        }
        if path.starts_with('-') {
            return Err("identity file path must not start with '-'".into());
        }
        if !path.starts_with('/') && !path.starts_with("./") {
            return Err("identity file must be an absolute path or start with ./".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_password_destination() {
        assert!(validate_ssh_destination("user:pass@host").is_err());
    }

    #[test]
    fn accepts_user_at_host() {
        assert!(validate_ssh_destination("user@host").is_ok());
    }
}
