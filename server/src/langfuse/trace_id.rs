//! Monitor API `traceId` 校验（上游调用前）。

const MAX_TRACE_ID_LEN: usize = 128;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TraceIdError {
    Missing,
    Invalid,
}

pub fn validate_trace_id(raw: Option<&str>) -> Result<String, TraceIdError> {
    let Some(value) = raw.map(str::trim).filter(|value| !value.is_empty()) else {
        return Err(TraceIdError::Missing);
    };
    if value.len() > MAX_TRACE_ID_LEN {
        return Err(TraceIdError::Invalid);
    }
    if !value.bytes().all(is_allowed_trace_id_byte) {
        return Err(TraceIdError::Invalid);
    }
    Ok(value.to_string())
}

fn is_allowed_trace_id_byte(byte: u8) -> bool {
    (0x20..=0x7e).contains(&byte) && byte != b'&' && byte != b'#'
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_printable_ascii_without_query_breakers() {
        assert_eq!(
            validate_trace_id(Some("trace-uuid-1")).unwrap(),
            "trace-uuid-1"
        );
    }

    #[test]
    fn rejects_missing_empty_and_invalid() {
        assert_eq!(validate_trace_id(None), Err(TraceIdError::Missing));
        assert_eq!(validate_trace_id(Some("")), Err(TraceIdError::Missing));
        assert_eq!(validate_trace_id(Some("a&b")), Err(TraceIdError::Invalid));
        assert_eq!(
            validate_trace_id(Some(&"x".repeat(129))),
            Err(TraceIdError::Invalid)
        );
    }
}
