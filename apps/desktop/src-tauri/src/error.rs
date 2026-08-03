use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("connection not found: {0}")]
    ConnectionNotFound(String),
    #[error("invalid SQLite path: {0}")]
    InvalidPath(String),
    #[error("driver is not implemented yet: {0}")]
    UnsupportedDriver(String),
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
