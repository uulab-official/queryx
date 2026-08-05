use std::sync::Arc;

use async_trait::async_trait;
use uuid::Uuid;

use crate::{
    error::AppError,
    models::{
        DatabaseLock, DatabaseMetadata, DatabaseSession, DriverCapability, DriverKind, QueryChunk,
        QueryResult,
    },
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExecutionMode {
    Direct,
    Transaction,
}

pub type QueryChunkHandler = Arc<dyn Fn(QueryChunk) + Send + Sync>;

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
    async fn execute_stream(
        &self,
        query_id: Uuid,
        sql: &str,
        mode: ExecutionMode,
        on_chunk: QueryChunkHandler,
    ) -> Result<QueryResult, AppError> {
        let result = self.execute(query_id, sql, mode).await?;
        let QueryResult {
            columns,
            rows,
            execution_time,
            affected_rows,
            warnings,
            error,
        } = result;
        on_chunk(QueryChunk {
            query_id: query_id.to_string(),
            row_offset: 0,
            columns: columns.clone(),
            rows: rows.clone(),
            warnings: warnings.clone(),
        });
        Ok(QueryResult {
            columns,
            rows: Vec::new(),
            execution_time,
            affected_rows,
            warnings,
            error,
        })
    }
    async fn execute_batch(
        &self,
        _query_id: Uuid,
        _statements: &[String],
        _expected_rows: u64,
    ) -> Result<QueryResult, AppError> {
        Err(AppError::UnsupportedDriver("edit batches".into()))
    }
    async fn begin_transaction(&self) -> Result<(), AppError> {
        Err(AppError::UnsupportedDriver("explicit transactions".into()))
    }
    async fn commit_transaction(&self) -> Result<(), AppError> {
        Err(AppError::UnsupportedDriver("explicit transactions".into()))
    }
    async fn rollback_transaction(&self) -> Result<(), AppError> {
        Err(AppError::UnsupportedDriver("explicit transactions".into()))
    }
    async fn cancel(&self, query_id: Uuid) -> Result<bool, AppError>;
    async fn metadata(&self) -> Result<DatabaseMetadata, AppError>;
    async fn sessions(&self) -> Result<Vec<DatabaseSession>, AppError> {
        Err(AppError::UnsupportedDriver("session inspection".into()))
    }
    async fn cancel_session(&self, _session_id: &str) -> Result<(), AppError> {
        Err(AppError::UnsupportedDriver("session cancellation".into()))
    }
    async fn locks(&self) -> Result<Vec<DatabaseLock>, AppError> {
        Err(AppError::UnsupportedDriver("lock graph inspection".into()))
    }
    async fn disconnect(&self) -> Result<(), AppError>;
}
