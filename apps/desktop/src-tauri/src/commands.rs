use tauri::State;

use crate::{
    driver::ExecutionMode,
    driver_registry::DriverRegistry,
    error::AppError,
    models::{ConnectionConfig, ConnectionSummary, DatabaseMetadata, QueryResult},
};

#[tauri::command]
pub async fn connect_database(
    state: State<'_, DriverRegistry>,
    config: ConnectionConfig,
) -> Result<ConnectionSummary, AppError> {
    state.connect(config).await
}

#[tauri::command]
pub async fn prepare_query(
    state: State<'_, DriverRegistry>,
    connection_id: String,
    query_id: String,
) -> Result<(), AppError> {
    state.prepare(&connection_id, &query_id).await
}

#[tauri::command]
pub async fn execute_query(
    state: State<'_, DriverRegistry>,
    connection_id: String,
    query_id: String,
    sql: String,
) -> Result<QueryResult, AppError> {
    state
        .execute(&connection_id, &query_id, &sql, ExecutionMode::Direct)
        .await
}

#[tauri::command]
pub async fn execute_query_transaction(
    state: State<'_, DriverRegistry>,
    connection_id: String,
    query_id: String,
    sql: String,
) -> Result<QueryResult, AppError> {
    state
        .execute(&connection_id, &query_id, &sql, ExecutionMode::Transaction)
        .await
}

#[tauri::command]
pub async fn cancel_query(
    state: State<'_, DriverRegistry>,
    connection_id: String,
    query_id: String,
) -> Result<bool, AppError> {
    state.cancel(&connection_id, &query_id).await
}

#[tauri::command]
pub async fn database_metadata(
    state: State<'_, DriverRegistry>,
    connection_id: String,
) -> Result<DatabaseMetadata, AppError> {
    state.metadata(&connection_id).await
}

#[tauri::command]
pub async fn disconnect_database(
    state: State<'_, DriverRegistry>,
    connection_id: String,
) -> Result<(), AppError> {
    state.disconnect(&connection_id).await
}
