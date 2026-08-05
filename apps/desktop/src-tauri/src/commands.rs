use std::sync::Arc;

use tauri::{AppHandle, Emitter, State};

use crate::{
    driver::{ExecutionMode, QueryChunkHandler},
    driver_registry::DriverRegistry,
    error::AppError,
    models::{ConnectionConfig, ConnectionSummary, DatabaseMetadata, QueryResult},
    secret_store,
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
pub async fn execute_query_stream(
    state: State<'_, DriverRegistry>,
    app: AppHandle,
    connection_id: String,
    query_id: String,
    sql: String,
) -> Result<QueryResult, AppError> {
    let event_name = format!("queryx:query-chunk:{query_id}");
    let handler: QueryChunkHandler = Arc::new(move |chunk| {
        let _ = app.emit(&event_name, chunk);
    });
    state
        .execute_stream(&connection_id, &query_id, &sql, handler)
        .await
}

#[tauri::command]
pub async fn begin_transaction(
    state: State<'_, DriverRegistry>,
    connection_id: String,
) -> Result<(), AppError> {
    state.begin_transaction(&connection_id).await
}

#[tauri::command]
pub async fn commit_transaction(
    state: State<'_, DriverRegistry>,
    connection_id: String,
) -> Result<(), AppError> {
    state.commit_transaction(&connection_id).await
}

#[tauri::command]
pub async fn rollback_transaction(
    state: State<'_, DriverRegistry>,
    connection_id: String,
) -> Result<(), AppError> {
    state.rollback_transaction(&connection_id).await
}

#[tauri::command]
pub fn load_connection_password(profile_id: String) -> Result<Option<String>, AppError> {
    secret_store::load_password(&profile_id)
}

#[tauri::command]
pub fn save_connection_password(profile_id: String, password: String) -> Result<(), AppError> {
    secret_store::save_password(&profile_id, &password)
}

#[tauri::command]
pub fn delete_connection_password(profile_id: String) -> Result<(), AppError> {
    secret_store::delete_password(&profile_id)
}

#[tauri::command]
pub async fn execute_edit_batch(
    state: State<'_, DriverRegistry>,
    connection_id: String,
    query_id: String,
    statements: Vec<String>,
    expected_rows: u64,
) -> Result<QueryResult, AppError> {
    state
        .execute_batch(&connection_id, &query_id, &statements, expected_rows)
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
pub async fn database_sessions(
    state: State<'_, DriverRegistry>,
    connection_id: String,
) -> Result<Vec<crate::models::DatabaseSession>, AppError> {
    state.sessions(&connection_id).await
}

#[tauri::command]
pub async fn cancel_database_session(
    state: State<'_, DriverRegistry>,
    connection_id: String,
    session_id: String,
) -> Result<(), AppError> {
    state.cancel_session(&connection_id, &session_id).await
}

#[tauri::command]
pub async fn database_locks(
    state: State<'_, DriverRegistry>,
    connection_id: String,
) -> Result<Vec<crate::models::DatabaseLock>, AppError> {
    state.locks(&connection_id).await
}

#[tauri::command]
pub async fn disconnect_database(
    state: State<'_, DriverRegistry>,
    connection_id: String,
) -> Result<(), AppError> {
    state.disconnect(&connection_id).await
}
