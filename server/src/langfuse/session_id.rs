//! Monitor API `sessionId` 校验（上游调用前）。

const MAX_SESSION_ID_LEN: usize = 200;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionIdError {
    Missing,
    Invalid,
}

pub fn validate_session_id(raw: Option<&str>) -> Result<String, SessionIdError> {
    let Some(value) = raw.map(str::trim).filter(|value| !value.is_empty()) else {
        return Err(SessionIdError::Missing);
    };
    if value.len() > MAX_SESSION_ID_LEN {
        return Err(SessionIdError::Invalid);
    }
    if !value.bytes().all(is_allowed_session_id_byte) {
        return Err(SessionIdError::Invalid);
    }
    Ok(value.to_string())
}

fn is_allowed_session_id_byte(byte: u8) -> bool {
    (0x20..=0x7e).contains(&byte) && byte != b'&' && byte != b'#'
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_printable_ascii_without_query_breakers() {
        assert_eq!(
            validate_session_id(Some("acp-session-1")).unwrap(),
            "acp-session-1"
        );
    }

    #[test]
    fn rejects_missing_empty_and_invalid() {
        assert_eq!(validate_session_id(None), Err(SessionIdError::Missing));
        assert_eq!(validate_session_id(Some("")), Err(SessionIdError::Missing));
        assert_eq!(validate_session_id(Some("a&b")), Err(SessionIdError::Invalid));
        assert_eq!(validate_session_id(Some("a#b")), Err(SessionIdError::Invalid));
        assert_eq!(
            validate_session_id(Some(&"x".repeat(201))),
            Err(SessionIdError::Invalid)
        );
    }
}
