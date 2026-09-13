use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("audio: {0}")]
    Audio(String),

    #[error("voice session: {0}")]
    Session(String),

    #[error("websocket: {0}")]
    Ws(String),

    #[error("missing realtime voice url (set --url or PERI_REALTIME_VOICE_URL)")]
    MissingUrl,

    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, Error>;
