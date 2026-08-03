use async_trait::async_trait;

use crate::{
    error::AppError,
    models::{DatabaseMetadata, DriverCapability, DriverKind, QueryResult},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExecutionMode {
    Direct,
    Transaction,
}

#[async_trait]
pub trait DatabaseDriver: Send + Sync {
    fn kind(&self) -> DriverKind;
    fn database(&self) -> &str;
    fn capabilities(&self) -> Vec<DriverCapability>;
    async fn execute(&self, sql: &str, mode: ExecutionMode) -> Result<QueryResult, AppError>;
    async fn metadata(&self) -> Result<DatabaseMetadata, AppError>;
    async fn disconnect(&self) -> Result<(), AppError>;
}
