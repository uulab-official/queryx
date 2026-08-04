use async_trait::async_trait;
use uuid::Uuid;

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
    fn is_read_only(&self) -> bool {
        false
    }
    fn capabilities(&self) -> Vec<DriverCapability>;
    async fn prepare(&self, _query_id: Uuid) -> Result<(), AppError> {
        Ok(())
    }
    async fn execute(
        &self,
        query_id: Uuid,
        sql: &str,
        mode: ExecutionMode,
    ) -> Result<QueryResult, AppError>;
    async fn execute_batch(
        &self,
        _query_id: Uuid,
        _statements: &[String],
        _expected_rows: u64,
    ) -> Result<QueryResult, AppError> {
        Err(AppError::UnsupportedDriver("edit batches".into()))
    }
    async fn cancel(&self, query_id: Uuid) -> Result<bool, AppError>;
    async fn metadata(&self) -> Result<DatabaseMetadata, AppError>;
    async fn disconnect(&self) -> Result<(), AppError>;
}
