use std::{
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::Value;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
    Row, SqlitePool,
};
use tauri::{AppHandle, Manager};

use crate::error::AppError;

const CURRENT_SCHEMA_VERSION: i64 = 1;
const DATABASE_FILE: &str = "workspace.sqlite";

async fn open_pool(app: &AppHandle) -> Result<SqlitePool, AppError> {
    let app_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| AppError::Workspace(error.to_string()))?;
    tokio::fs::create_dir_all(&app_dir)
        .await
        .map_err(|error| AppError::Workspace(error.to_string()))?;
    let database_path = app_dir.join(DATABASE_FILE);
    open_pool_at(&database_path).await
}

async fn open_pool_at(path: &Path) -> Result<SqlitePool, AppError> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|error| AppError::Workspace(error.to_string()))?;
    migrate(&pool).await?;
    Ok(pool)
}

async fn migrate(pool: &SqlitePool) -> Result<(), AppError> {
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| AppError::Workspace(error.to_string()))?;
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS workspace_schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        )",
    )
    .execute(&mut *transaction)
    .await
    .map_err(|error| AppError::Workspace(error.to_string()))?;
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS workspace_snapshots (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            schema_version INTEGER NOT NULL,
            snapshot_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
    )
    .execute(&mut *transaction)
    .await
    .map_err(|error| AppError::Workspace(error.to_string()))?;
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS workspace_connection_profiles (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            schema_version INTEGER NOT NULL,
            profiles_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
    )
    .execute(&mut *transaction)
    .await
    .map_err(|error| AppError::Workspace(error.to_string()))?;
    sqlx::query(
        "INSERT OR IGNORE INTO workspace_schema_migrations (version, applied_at)
         VALUES (?, ?)",
    )
    .bind(CURRENT_SCHEMA_VERSION)
    .bind(timestamp())
    .execute(&mut *transaction)
    .await
    .map_err(|error| AppError::Workspace(error.to_string()))?;
    transaction
        .commit()
        .await
        .map_err(|error| AppError::Workspace(error.to_string()))
}

fn timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".into())
}

fn serialize(value: &Value) -> Result<String, AppError> {
    serde_json::to_string(value).map_err(|error| AppError::Workspace(error.to_string()))
}

fn parse(value: String) -> Result<Value, AppError> {
    serde_json::from_str(&value).map_err(|error| AppError::Workspace(error.to_string()))
}

fn ensure_secret_free(value: &Value) -> Result<(), AppError> {
    let contains_secret_key = match value {
        Value::Object(object) => object.iter().any(|(key, value)| {
            matches!(
                key.to_ascii_lowercase().as_str(),
                "password" | "passphrase" | "secret" | "token"
            ) || ensure_secret_free(value).is_err()
        }),
        Value::Array(values) => values
            .iter()
            .any(|value| ensure_secret_free(value).is_err()),
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => false,
    };
    if contains_secret_key {
        return Err(AppError::Workspace(
            "secret-bearing fields are not allowed in native workspace storage".into(),
        ));
    }
    Ok(())
}

async fn load_json(
    pool: &SqlitePool,
    table: &str,
    column: &str,
) -> Result<Option<Value>, AppError> {
    let query = format!("SELECT {column} FROM {table} WHERE id = 1 AND schema_version <= ?");
    let row = sqlx::query(&query)
        .bind(CURRENT_SCHEMA_VERSION)
        .fetch_optional(pool)
        .await
        .map_err(|error| AppError::Workspace(error.to_string()))?;
    row.map(|row| {
        parse(
            row.try_get::<String, _>(column)
                .map_err(|error| AppError::Workspace(error.to_string()))?,
        )
    })
    .transpose()
}

async fn save_json(
    pool: &SqlitePool,
    table: &str,
    column: &str,
    value: &Value,
) -> Result<(), AppError> {
    ensure_secret_free(value)?;
    let serialized = serialize(value)?;
    let query = format!(
        "INSERT INTO {table} (id, schema_version, {column}, updated_at)
         VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           schema_version = excluded.schema_version,
           {column} = excluded.{column},
           updated_at = excluded.updated_at"
    );
    sqlx::query(&query)
        .bind(CURRENT_SCHEMA_VERSION)
        .bind(serialized)
        .bind(timestamp())
        .execute(pool)
        .await
        .map_err(|error| AppError::Workspace(error.to_string()))?;
    Ok(())
}

pub async fn load_workspace_snapshot(app: &AppHandle) -> Result<Option<Value>, AppError> {
    let pool = open_pool(app).await?;
    let value = load_json(&pool, "workspace_snapshots", "snapshot_json").await;
    pool.close().await;
    value
}

pub async fn save_workspace_snapshot(app: &AppHandle, snapshot: Value) -> Result<(), AppError> {
    ensure_secret_free(&snapshot)?;
    let pool = open_pool(app).await?;
    let result = save_json(&pool, "workspace_snapshots", "snapshot_json", &snapshot).await;
    pool.close().await;
    result
}

pub async fn load_connection_profiles(app: &AppHandle) -> Result<Option<Value>, AppError> {
    let pool = open_pool(app).await?;
    let value = load_json(&pool, "workspace_connection_profiles", "profiles_json").await;
    pool.close().await;
    value
}

pub async fn save_connection_profiles(app: &AppHandle, profiles: Value) -> Result<(), AppError> {
    ensure_secret_free(&profiles)?;
    let pool = open_pool(app).await?;
    let result = save_json(
        &pool,
        "workspace_connection_profiles",
        "profiles_json",
        &profiles,
    )
    .await;
    pool.close().await;
    result
}

#[cfg(test)]
mod tests {
    use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};

    use super::{load_json, migrate, save_json};

    async fn memory_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("in-memory workspace database");
        migrate(&pool).await.expect("workspace schema migration");
        pool
    }

    #[tokio::test]
    async fn migrates_and_round_trips_workspace_json_atomically() {
        let pool = memory_pool().await;
        let snapshot = serde_json::json!({
            "version": 1,
            "tabs": [{"id": "query-1", "sql": "SELECT 1"}],
            "sql": "SELECT password FROM users"
        });
        save_json(&pool, "workspace_snapshots", "snapshot_json", &snapshot)
            .await
            .expect("save workspace snapshot");
        let loaded = load_json(&pool, "workspace_snapshots", "snapshot_json")
            .await
            .expect("load workspace snapshot")
            .expect("stored snapshot");
        assert_eq!(loaded, snapshot);
        let migration_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM workspace_schema_migrations WHERE version = 1",
        )
        .fetch_one(&pool)
        .await
        .expect("migration row");
        assert_eq!(migration_count, 1);
    }

    #[tokio::test]
    async fn keeps_profile_storage_separate_from_workspace_snapshots() {
        let pool = memory_pool().await;
        let profiles = serde_json::json!([{"id": "profile-1", "kind": "sqlite"}]);
        save_json(
            &pool,
            "workspace_connection_profiles",
            "profiles_json",
            &profiles,
        )
        .await
        .expect("save profiles");
        assert_eq!(
            load_json(&pool, "workspace_connection_profiles", "profiles_json")
                .await
                .expect("load profiles"),
            Some(profiles)
        );
        assert_eq!(
            load_json(&pool, "workspace_snapshots", "snapshot_json")
                .await
                .expect("load workspace"),
            None
        );
    }

    #[tokio::test]
    async fn rejects_secret_fields_before_writing_profiles() {
        let pool = memory_pool().await;
        let profiles = serde_json::json!([{
            "id": "profile-1",
            "kind": "sqlite",
            "password": "must-not-persist"
        }]);
        assert!(save_json(
            &pool,
            "workspace_connection_profiles",
            "profiles_json",
            &profiles,
        )
        .await
        .is_err());
        assert_eq!(
            load_json(&pool, "workspace_connection_profiles", "profiles_json")
                .await
                .expect("load profiles"),
            None
        );
    }
}
