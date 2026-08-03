use tauri::State;

use crate::{
    error::AppError,
    models::{ConnectionSummary, DatabaseMetadata, QueryResult, SqliteConnectionConfig},
    sqlite_driver::SqliteDriverRegistry,
};

#[tauri::command]
pub async fn connect_sqlite(
    state: State<'_, SqliteDriverRegistry>,
    config: SqliteConnectionConfig,
) -> Result<ConnectionSummary, AppError> {
    state.connect(config).await
}

#[tauri::command]
pub async fn execute_sqlite(
    state: State<'_, SqliteDriverRegistry>,
    connection_id: String,
    sql: String,
) -> Result<QueryResult, AppError> {
    state.execute(&connection_id, &sql).await
}

#[tauri::command]
pub async fn execute_sqlite_transaction(
    state: State<'_, SqliteDriverRegistry>,
    connection_id: String,
    sql: String,
) -> Result<QueryResult, AppError> {
    state.execute_transaction(&connection_id, &sql).await
}

#[tauri::command]
pub async fn sqlite_metadata(
    state: State<'_, SqliteDriverRegistry>,
    connection_id: String,
) -> Result<DatabaseMetadata, AppError> {
    state.metadata(&connection_id).await
}

#[tauri::command]
pub async fn disconnect_sqlite(
    state: State<'_, SqliteDriverRegistry>,
    connection_id: String,
) -> Result<(), AppError> {
    state.disconnect(&connection_id).await
}
