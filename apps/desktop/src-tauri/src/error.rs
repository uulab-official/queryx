use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("connection not found: {0}")]
    ConnectionNotFound(String),
    #[error("invalid SQLite path: {0}")]
    InvalidPath(String),
    #[error("invalid PostgreSQL configuration: {0}")]
    InvalidPostgresConfig(String),
    #[error("invalid MySQL configuration: {0}")]
    InvalidMysqlConfig(String),
    #[error("driver is not implemented yet: {0}")]
    UnsupportedDriver(String),
    #[error("invalid query id: {0}")]
    InvalidQueryId(String),
    #[error("query cancellation is not supported by the {0} driver")]
    CancellationUnsupported(String),
    #[error("query was cancelled")]
    QueryCancelled,
    #[error("query id is already active: {0}")]
    DuplicateQueryId(String),
    #[error("optimistic edit conflict: expected {expected} row updates, but matched {actual}")]
    EditConflict { expected: u64, actual: u64 },
    #[error("read-only connection rejects this statement")]
    ReadOnlyViolation,
    #[error("a transaction is already active")]
    TransactionAlreadyActive,
    #[error("no active transaction")]
    TransactionNotActive,
    #[error("OS keychain error: {0}")]
    Keychain(String),
    #[error("SSH tunnel error: {0}")]
    SshTunnel(String),
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
