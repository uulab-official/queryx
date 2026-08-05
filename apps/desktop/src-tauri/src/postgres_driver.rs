use std::{collections::HashMap, sync::Arc, time::Duration, time::Instant};

use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use bigdecimal::BigDecimal;
use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use futures_util::TryStreamExt;
use serde_json::Value;
use sqlx::{
    pool::PoolConnection,
    postgres::{PgConnectOptions, PgPoolOptions, PgRow, PgSslMode},
    Column, Connection, PgConnection, PgPool, Postgres, Row, TypeInfo, ValueRef,
};
use tokio::sync::{Mutex, Notify, RwLock};
use uuid::Uuid;

use crate::{
    driver::{DatabaseDriver, ExecutionMode, QueryChunkHandler},
    error::AppError,
    models::{
        AggregateKind, AggregateMetadata, ColumnMetadata, ConnectionConfig, DatabaseMetadata,
        DatabaseObjectKind, DatabaseObjectRef, DependencyKind, DependencyMetadata,
        DriverCapability, DriverKind, EventTriggerEvent, EventTriggerMetadata,
        ForeignKeyColumnPair, ForeignKeyMetadata, IndexMetadata, QueryChunk, QueryColumn,
        QueryResult, RelationRef, RoutineKind, RoutineMetadata, SslMode, TableMetadata,
        TriggerEvent, TriggerMetadata, TriggerOrientation, TriggerRelationKind, TriggerRelationRef,
        TriggerStatus, TriggerTiming, ViewMetadata,
    },
};

pub struct PostgresDriver {
    database: String,
    pool: PgPool,
    cancellation_pool: PgPool,
    explicit_transaction: Mutex<Option<PoolConnection<Postgres>>>,
    active_queries: RwLock<HashMap<Uuid, Arc<ActiveQuery>>>,
    read_only: bool,
}

fn map_ssl_mode(mode: SslMode) -> PgSslMode {
    match mode {
        SslMode::Disable => PgSslMode::Disable,
        SslMode::Prefer => PgSslMode::Prefer,
        SslMode::Require => PgSslMode::Require,
        SslMode::VerifyCa => PgSslMode::VerifyCa,
        SslMode::VerifyFull => PgSslMode::VerifyFull,
    }
}

#[derive(Debug)]
enum ActiveQueryState {
    Pending,
    Running(i32),
    Cancelling,
    Cancelled,
    CancellationComplete(bool),
    Finished,
}

#[derive(Debug)]
struct ActiveQuery {
    state: Mutex<ActiveQueryState>,
    cancellation_complete: Notify,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CancelAction {
    BeforeStart,
    Send(i32),
    AlreadyRequested,
    TooLate,
}

impl ActiveQuery {
    fn pending() -> Self {
        Self {
            state: Mutex::new(ActiveQueryState::Pending),
            cancellation_complete: Notify::new(),
        }
    }

    async fn activate(&self, process_id: i32) -> bool {
        let mut state = self.state.lock().await;
        match *state {
            ActiveQueryState::Pending => {
                *state = ActiveQueryState::Running(process_id);
                true
            }
            ActiveQueryState::Cancelled => false,
            _ => false,
        }
    }

    async fn request_cancel(&self) -> CancelAction {
        let mut state = self.state.lock().await;
        match *state {
            ActiveQueryState::Pending => {
                *state = ActiveQueryState::Cancelled;
                CancelAction::BeforeStart
            }
            ActiveQueryState::Running(process_id) => {
                *state = ActiveQueryState::Cancelling;
                CancelAction::Send(process_id)
            }
            ActiveQueryState::Cancelling
            | ActiveQueryState::Cancelled
            | ActiveQueryState::CancellationComplete(true) => CancelAction::AlreadyRequested,
            ActiveQueryState::CancellationComplete(false) | ActiveQueryState::Finished => {
                CancelAction::TooLate
            }
        }
    }

    async fn complete_cancellation(&self, cancelled: bool) {
        *self.state.lock().await = ActiveQueryState::CancellationComplete(cancelled);
        self.cancellation_complete.notify_waiters();
    }

    async fn finish_execution(&self) -> bool {
        loop {
            let notified = self.cancellation_complete.notified();
            let mut state = self.state.lock().await;
            match *state {
                ActiveQueryState::Pending | ActiveQueryState::Running(_) => {
                    *state = ActiveQueryState::Finished;
                    return false;
                }
                ActiveQueryState::Cancelled => {
                    *state = ActiveQueryState::Finished;
                    return true;
                }
                ActiveQueryState::CancellationComplete(cancelled) => {
                    *state = ActiveQueryState::Finished;
                    return cancelled;
                }
                ActiveQueryState::Finished => return false,
                ActiveQueryState::Cancelling => {
                    drop(state);
                    notified.await;
                }
            }
        }
    }
}

impl PostgresDriver {
    pub async fn connect(config: &ConnectionConfig) -> Result<Self, AppError> {
        let database = required_value(&config.database, "database")?;
        let host = config.host.as_deref().unwrap_or("localhost");
        let username = config.username.as_deref().unwrap_or("postgres");
        let ssl_mode = map_ssl_mode(config.ssl_mode.unwrap_or(SslMode::Prefer));
        let mut options = PgConnectOptions::new()
            .host(host)
            .port(config.port.unwrap_or(5432))
            .username(username)
            .database(database)
            .ssl_mode(ssl_mode)
            .application_name("QueryX");
        if let Some(password) = config.password.as_deref() {
            options = options.password(password);
        }
        if let Some(path) = config.ssl_root_cert.as_deref() {
            options = options.ssl_root_cert(path);
        }
        if let Some(path) = config.ssl_client_cert.as_deref() {
            options = options.ssl_client_cert(path);
        }
        if let Some(path) = config.ssl_client_key.as_deref() {
            options = options.ssl_client_key(path);
        }
        if config.read_only {
            options = options.options([("default_transaction_read_only", "on")]);
        }

        let cancellation_pool = PgPoolOptions::new()
            .max_connections(1)
            .acquire_timeout(Duration::from_secs(10))
            .connect_lazy_with(options.clone());
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .acquire_timeout(Duration::from_secs(10))
            .connect_with(options)
            .await?;

        Ok(Self {
            database: database.to_string(),
            pool,
            cancellation_pool,
            explicit_transaction: Mutex::new(None),
            active_queries: RwLock::new(HashMap::new()),
            read_only: config.read_only,
        })
    }

    async fn execute_active(
        &self,
        active: &ActiveQuery,
        sql: &str,
        mode: ExecutionMode,
    ) -> Result<QueryResult, AppError> {
        let mut explicit_transaction = self.explicit_transaction.lock().await;
        if let Some(connection) = explicit_transaction.as_mut() {
            let process_id = sqlx::query_scalar::<_, i32>("SELECT pg_backend_pid()")
                .fetch_one(&mut **connection)
                .await?;
            if !active.activate(process_id).await {
                active.finish_execution().await;
                return Err(AppError::QueryCancelled);
            }
            let result = execute_on_connection(connection, sql, false).await;
            let was_cancelled = active.finish_execution().await;
            return if was_cancelled {
                Err(AppError::QueryCancelled)
            } else {
                result
            };
        }
        drop(explicit_transaction);
        let mut connection = match self.pool.acquire().await {
            Ok(connection) => connection,
            Err(error) => {
                active.finish_execution().await;
                return Err(error.into());
            }
        };
        let process_id = match sqlx::query_scalar::<_, i32>("SELECT pg_backend_pid()")
            .fetch_one(&mut *connection)
            .await
        {
            Ok(process_id) => process_id,
            Err(error) => {
                active.finish_execution().await;
                return Err(error.into());
            }
        };
        if !active.activate(process_id).await {
            active.finish_execution().await;
            return Err(AppError::QueryCancelled);
        }

        let result =
            execute_on_connection(&mut connection, sql, mode == ExecutionMode::Transaction).await;
        let was_cancelled = active.finish_execution().await;
        drop(connection);

        if was_cancelled {
            Err(AppError::QueryCancelled)
        } else {
            result
        }
    }

    async fn execute_stream_active(
        &self,
        active: &ActiveQuery,
        query_id: Uuid,
        sql: &str,
        mode: ExecutionMode,
        on_chunk: QueryChunkHandler,
    ) -> Result<QueryResult, AppError> {
        let mut explicit_transaction = self.explicit_transaction.lock().await;
        if let Some(connection) = explicit_transaction.as_mut() {
            let process_id = sqlx::query_scalar::<_, i32>("SELECT pg_backend_pid()")
                .fetch_one(&mut **connection)
                .await?;
            if !active.activate(process_id).await {
                active.finish_execution().await;
                return Err(AppError::QueryCancelled);
            }
            let result =
                execute_stream_on_connection(connection, query_id, sql, false, on_chunk).await;
            let was_cancelled = active.finish_execution().await;
            return if was_cancelled {
                Err(AppError::QueryCancelled)
            } else {
                result
            };
        }
        drop(explicit_transaction);
        let mut connection = match self.pool.acquire().await {
            Ok(connection) => connection,
            Err(error) => {
                active.finish_execution().await;
                return Err(error.into());
            }
        };
        let process_id = match sqlx::query_scalar::<_, i32>("SELECT pg_backend_pid()")
            .fetch_one(&mut *connection)
            .await
        {
            Ok(process_id) => process_id,
            Err(error) => {
                active.finish_execution().await;
                return Err(error.into());
            }
        };
        if !active.activate(process_id).await {
            active.finish_execution().await;
            return Err(AppError::QueryCancelled);
        }

        let result = execute_stream_on_connection(
            &mut connection,
            query_id,
            sql,
            mode == ExecutionMode::Transaction,
            on_chunk,
        )
        .await;
        let was_cancelled = active.finish_execution().await;
        drop(connection);

        if was_cancelled {
            Err(AppError::QueryCancelled)
        } else {
            result
        }
    }
}

#[async_trait]
impl DatabaseDriver for PostgresDriver {
    fn kind(&self) -> DriverKind {
        DriverKind::Postgres
    }

    fn database(&self) -> &str {
        &self.database
    }

    fn is_read_only(&self) -> bool {
        self.read_only
    }

    fn capabilities(&self) -> Vec<DriverCapability> {
        let mut capabilities = vec![
            DriverCapability::Transactions,
            DriverCapability::Explain,
            DriverCapability::Cancel,
            DriverCapability::Streaming,
        ];
        if !self.read_only {
            capabilities.push(DriverCapability::Editing);
        }
        capabilities
    }

    async fn prepare(&self, query_id: Uuid) -> Result<(), AppError> {
        let mut active_queries = self.active_queries.write().await;
        if active_queries.contains_key(&query_id) {
            return Err(AppError::DuplicateQueryId(query_id.to_string()));
        }
        active_queries.insert(query_id, Arc::new(ActiveQuery::pending()));
        Ok(())
    }

    async fn execute(
        &self,
        query_id: Uuid,
        sql: &str,
        mode: ExecutionMode,
    ) -> Result<QueryResult, AppError> {
        let active = self
            .active_queries
            .read()
            .await
            .get(&query_id)
            .cloned()
            .ok_or_else(|| AppError::InvalidQueryId(query_id.to_string()))?;
        let result = self.execute_active(&active, sql, mode).await;
        self.active_queries.write().await.remove(&query_id);
        result
    }

    async fn execute_stream(
        &self,
        query_id: Uuid,
        sql: &str,
        mode: ExecutionMode,
        on_chunk: QueryChunkHandler,
    ) -> Result<QueryResult, AppError> {
        let active = self
            .active_queries
            .read()
            .await
            .get(&query_id)
            .cloned()
            .ok_or_else(|| AppError::InvalidQueryId(query_id.to_string()))?;
        let result = self
            .execute_stream_active(&active, query_id, sql, mode, on_chunk)
            .await;
        self.active_queries.write().await.remove(&query_id);
        result
    }

    async fn execute_batch(
        &self,
        _query_id: Uuid,
        statements: &[String],
        expected_rows: u64,
    ) -> Result<QueryResult, AppError> {
        let mut explicit_transaction = self.explicit_transaction.lock().await;
        if let Some(connection) = explicit_transaction.as_mut() {
            return execute_edit_batch_on_connection(connection, statements, expected_rows).await;
        }
        drop(explicit_transaction);
        let mut connection = self.pool.acquire().await?;
        execute_edit_batch_on_connection(&mut connection, statements, expected_rows).await
    }

    async fn begin_transaction(&self) -> Result<(), AppError> {
        let mut explicit_transaction = self.explicit_transaction.lock().await;
        if explicit_transaction.is_some() {
            return Err(AppError::TransactionAlreadyActive);
        }
        let mut connection = self.pool.acquire().await?;
        sqlx::query("BEGIN").execute(&mut *connection).await?;
        *explicit_transaction = Some(connection);
        Ok(())
    }

    async fn commit_transaction(&self) -> Result<(), AppError> {
        let mut explicit_transaction = self.explicit_transaction.lock().await;
        let Some(mut connection) = explicit_transaction.take() else {
            return Err(AppError::TransactionNotActive);
        };
        let result = sqlx::query("COMMIT").execute(&mut *connection).await;
        if result.is_err() {
            let _ = sqlx::query("ROLLBACK").execute(&mut *connection).await;
        }
        result.map(|_| ()).map_err(AppError::from)
    }

    async fn rollback_transaction(&self) -> Result<(), AppError> {
        let mut explicit_transaction = self.explicit_transaction.lock().await;
        let Some(mut connection) = explicit_transaction.take() else {
            return Err(AppError::TransactionNotActive);
        };
        sqlx::query("ROLLBACK").execute(&mut *connection).await?;
        Ok(())
    }

    async fn cancel(&self, query_id: Uuid) -> Result<bool, AppError> {
        let Some(active) = self.active_queries.read().await.get(&query_id).cloned() else {
            return Ok(false);
        };
        match active.request_cancel().await {
            CancelAction::BeforeStart => {
                self.active_queries.write().await.remove(&query_id);
                Ok(true)
            }
            CancelAction::Send(process_id) => {
                let cancellation = sqlx::query_scalar::<_, bool>("SELECT pg_cancel_backend($1)")
                    .bind(process_id)
                    .fetch_one(&self.cancellation_pool)
                    .await;
                match cancellation {
                    Ok(cancelled) => {
                        active.complete_cancellation(cancelled).await;
                        Ok(cancelled)
                    }
                    Err(error) => {
                        active.complete_cancellation(false).await;
                        Err(error.into())
                    }
                }
            }
            CancelAction::AlreadyRequested => Ok(true),
            CancelAction::TooLate => Ok(false),
        }
    }

    async fn metadata(&self) -> Result<DatabaseMetadata, AppError> {
        load_metadata(&self.pool).await
    }

    async fn disconnect(&self) -> Result<(), AppError> {
        let _ = self.rollback_transaction().await;
        self.pool.close().await;
        self.cancellation_pool.close().await;
        Ok(())
    }
}

fn required_value<'a>(value: &'a str, field: &str) -> Result<&'a str, AppError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(AppError::InvalidPostgresConfig(format!(
            "{field} is required"
        )));
    }
    Ok(value)
}

async fn execute_on_connection(
    connection: &mut PgConnection,
    sql: &str,
    in_transaction: bool,
) -> Result<QueryResult, AppError> {
    let started = Instant::now();
    let is_query = is_row_returning_query(sql);

    if in_transaction {
        let mut transaction = connection.begin().await?;
        let result = execute_with_executor(&mut *transaction, sql, is_query, started).await?;
        transaction.commit().await?;
        return Ok(result);
    }

    execute_with_executor(connection, sql, is_query, started).await
}

async fn execute_stream_on_connection(
    connection: &mut PgConnection,
    query_id: Uuid,
    sql: &str,
    in_transaction: bool,
    on_chunk: QueryChunkHandler,
) -> Result<QueryResult, AppError> {
    let started = Instant::now();
    if !is_row_returning_query(sql) {
        let result = execute_on_connection(connection, sql, in_transaction).await?;
        on_chunk(QueryChunk {
            query_id: query_id.to_string(),
            row_offset: 0,
            columns: result.columns.clone(),
            rows: Vec::new(),
            warnings: result.warnings.clone(),
        });
        return Ok(result);
    }

    if in_transaction {
        let mut transaction = connection.begin().await?;
        let result =
            execute_stream_with_executor(&mut *transaction, query_id, sql, started, on_chunk)
                .await?;
        transaction.commit().await?;
        return Ok(result);
    }

    execute_stream_with_executor(connection, query_id, sql, started, on_chunk).await
}

async fn execute_stream_with_executor<'e, E>(
    executor: E,
    query_id: Uuid,
    sql: &str,
    started: Instant,
    on_chunk: QueryChunkHandler,
) -> Result<QueryResult, AppError>
where
    E: sqlx::Executor<'e, Database = Postgres>,
{
    let mut rows = sqlx::query(sql).fetch(executor);
    let mut columns = Vec::new();
    let mut warnings = Vec::new();
    let mut chunk_rows = Vec::with_capacity(256);
    let mut row_offset = 0_u64;

    while let Some(row) = rows.try_next().await? {
        if columns.is_empty() {
            columns = columns_from_row(&row);
            warnings = unsupported_type_warnings(&columns);
        }
        chunk_rows.push(row_to_json(&row));
        if chunk_rows.len() >= 256 {
            let chunk_offset = row_offset;
            row_offset += chunk_rows.len() as u64;
            on_chunk(QueryChunk {
                query_id: query_id.to_string(),
                row_offset: chunk_offset,
                columns: columns.clone(),
                rows: std::mem::take(&mut chunk_rows),
                warnings: warnings.clone(),
            });
        }
    }
    if !chunk_rows.is_empty() {
        let chunk_offset = row_offset;
        on_chunk(QueryChunk {
            query_id: query_id.to_string(),
            row_offset: chunk_offset,
            columns: columns.clone(),
            rows: chunk_rows,
            warnings: warnings.clone(),
        });
    }

    Ok(QueryResult {
        columns,
        rows: Vec::new(),
        execution_time: started.elapsed().as_millis(),
        affected_rows: 0,
        warnings,
        error: None,
    })
}

async fn execute_edit_batch_on_connection(
    connection: &mut PgConnection,
    statements: &[String],
    expected_rows: u64,
) -> Result<QueryResult, AppError> {
    let started = Instant::now();
    let mut transaction = connection.begin().await?;
    let mut affected_rows = 0;
    for statement in statements {
        affected_rows += sqlx::query(statement)
            .execute(&mut *transaction)
            .await?
            .rows_affected();
    }
    if affected_rows != expected_rows {
        return Err(AppError::EditConflict {
            expected: expected_rows,
            actual: affected_rows,
        });
    }
    transaction.commit().await?;
    Ok(QueryResult {
        columns: Vec::new(),
        rows: Vec::new(),
        execution_time: started.elapsed().as_millis(),
        affected_rows,
        warnings: Vec::new(),
        error: None,
    })
}

async fn execute_with_executor<'e, E>(
    executor: E,
    sql: &str,
    is_query: bool,
    started: Instant,
) -> Result<QueryResult, AppError>
where
    E: sqlx::Executor<'e, Database = Postgres>,
{
    if is_query {
        let rows = sqlx::query(sql).fetch_all(executor).await?;
        let columns = rows.first().map(columns_from_row).unwrap_or_default();
        let warnings = unsupported_type_warnings(&columns);
        let rows = rows.iter().map(row_to_json).collect::<Vec<_>>();
        return Ok(QueryResult {
            columns,
            rows,
            execution_time: started.elapsed().as_millis(),
            affected_rows: 0,
            warnings,
            error: None,
        });
    }

    let result = sqlx::query(sql).execute(executor).await?;
    Ok(QueryResult {
        columns: Vec::new(),
        rows: Vec::new(),
        execution_time: started.elapsed().as_millis(),
        affected_rows: result.rows_affected(),
        warnings: Vec::new(),
        error: None,
    })
}

fn columns_from_row(row: &PgRow) -> Vec<QueryColumn> {
    row.columns()
        .iter()
        .map(|column| QueryColumn {
            name: column.name().to_string(),
            r#type: column.type_info().name().to_string(),
            nullable: true,
        })
        .collect()
}

fn row_to_json(row: &PgRow) -> HashMap<String, Value> {
    row.columns()
        .iter()
        .enumerate()
        .map(|(index, column)| (column.name().to_string(), value_to_json(row, index)))
        .collect()
}

fn value_to_json(row: &PgRow, index: usize) -> Value {
    let Ok(raw) = row.try_get_raw(index) else {
        return Value::Null;
    };
    if raw.is_null() {
        return Value::Null;
    }
    let type_name = raw.type_info().name().to_ascii_uppercase();
    match type_name.as_str() {
        "BOOL" => row.try_get::<bool, _>(index).map(Value::from),
        "INT2" => row
            .try_get::<i16, _>(index)
            .map(|value| Value::from(i64::from(value))),
        "INT4" => row
            .try_get::<i32, _>(index)
            .map(|value| Value::from(i64::from(value))),
        "INT8" => row.try_get::<i64, _>(index).map(Value::from),
        "FLOAT4" => row
            .try_get::<f32, _>(index)
            .map(|value| Value::from(f64::from(value))),
        "FLOAT8" => row.try_get::<f64, _>(index).map(Value::from),
        "NUMERIC" => row
            .try_get::<BigDecimal, _>(index)
            .map(|value| Value::from(value.to_string())),
        "JSON" | "JSONB" => row.try_get::<Value, _>(index),
        "UUID" => row
            .try_get::<uuid::Uuid, _>(index)
            .map(|value| Value::from(value.to_string())),
        "DATE" => row
            .try_get::<NaiveDate, _>(index)
            .map(|value| Value::from(value.to_string())),
        "TIME" => row
            .try_get::<NaiveTime, _>(index)
            .map(|value| Value::from(value.to_string())),
        "TIMESTAMP" => row
            .try_get::<NaiveDateTime, _>(index)
            .map(|value| Value::from(value.to_string())),
        "TIMESTAMPTZ" => row
            .try_get::<DateTime<Utc>, _>(index)
            .map(|value| Value::from(value.to_rfc3339())),
        "BYTEA" => row
            .try_get::<Vec<u8>, _>(index)
            .map(|value| Value::from(BASE64.encode(value))),
        "BOOL[]" => row
            .try_get::<Vec<bool>, _>(index)
            .and_then(json_array_value),
        "INT2[]" => row.try_get::<Vec<i16>, _>(index).and_then(json_array_value),
        "INT4[]" => row.try_get::<Vec<i32>, _>(index).and_then(json_array_value),
        "INT8[]" => row.try_get::<Vec<i64>, _>(index).and_then(json_array_value),
        "TEXT[]" | "VARCHAR[]" => row
            .try_get::<Vec<String>, _>(index)
            .and_then(json_array_value),
        _ => row.try_get::<String, _>(index).map(Value::from),
    }
    .unwrap_or_else(|_| Value::String(format!("<{type_name}>")))
}

fn json_array_value<T: serde::Serialize>(values: Vec<T>) -> Result<Value, sqlx::Error> {
    serde_json::to_value(values).map_err(|error| sqlx::Error::Decode(Box::new(error)))
}

fn unsupported_type_warnings(columns: &[QueryColumn]) -> Vec<String> {
    let unsupported = columns
        .iter()
        .filter(|column| !is_supported_type(&column.r#type))
        .map(|column| column.r#type.as_str())
        .collect::<std::collections::BTreeSet<_>>();
    if unsupported.is_empty() {
        Vec::new()
    } else {
        vec![format!(
            "Unsupported PostgreSQL values are shown as type markers: {}",
            unsupported.into_iter().collect::<Vec<_>>().join(", ")
        )]
    }
}

fn is_supported_type(type_name: &str) -> bool {
    matches!(
        type_name.to_ascii_uppercase().as_str(),
        "BOOL"
            | "INT2"
            | "INT4"
            | "INT8"
            | "FLOAT4"
            | "FLOAT8"
            | "NUMERIC"
            | "JSON"
            | "JSONB"
            | "UUID"
            | "DATE"
            | "TIME"
            | "TIMESTAMP"
            | "TIMESTAMPTZ"
            | "BYTEA"
            | "BOOL[]"
            | "INT2[]"
            | "INT4[]"
            | "INT8[]"
            | "TEXT[]"
            | "VARCHAR[]"
            | "TEXT"
            | "VARCHAR"
            | "BPCHAR"
            | "NAME"
    )
}

fn is_row_returning_query(sql: &str) -> bool {
    let normalized = sql
        .lines()
        .filter(|line| !line.trim_start().starts_with("--"))
        .collect::<Vec<_>>()
        .join(" ")
        .trim_start()
        .to_ascii_uppercase();
    ["SELECT", "WITH", "SHOW", "EXPLAIN", "VALUES", "TABLE"]
        .iter()
        .any(|prefix| normalized.starts_with(prefix))
        || normalized.contains(" RETURNING ")
}

async fn load_metadata(pool: &PgPool) -> Result<DatabaseMetadata, AppError> {
    let databases = sqlx::query_scalar::<_, String>(
        "SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate ORDER BY datname",
    )
    .fetch_all(pool)
    .await?;
    let schemas = sqlx::query_scalar::<_, String>(
        "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog', 'information_schema') AND schema_name NOT LIKE 'pg_toast%' ORDER BY schema_name",
    )
    .fetch_all(pool)
    .await?;
    let table_rows = sqlx::query(
        "SELECT t.table_schema, t.table_name, GREATEST(c.reltuples, 0)::bigint AS row_count FROM information_schema.tables t JOIN pg_catalog.pg_namespace n ON n.nspname = t.table_schema JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid AND c.relname = t.table_name WHERE t.table_type = 'BASE TABLE' AND t.table_schema NOT IN ('pg_catalog', 'information_schema') AND t.table_schema NOT LIKE 'pg_toast%' ORDER BY t.table_schema, t.table_name",
    )
    .fetch_all(pool)
    .await?;
    let column_rows = sqlx::query(
        "SELECT c.table_schema, c.table_name, c.column_name, c.data_type, c.is_nullable = 'YES' AS nullable, EXISTS (SELECT 1 FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.constraint_schema AND kcu.table_name = tc.table_name WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = c.table_schema AND tc.table_name = c.table_name AND kcu.column_name = c.column_name) AS primary_key FROM information_schema.columns c WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema') AND c.table_schema NOT LIKE 'pg_toast%' ORDER BY c.table_schema, c.table_name, c.ordinal_position",
    )
    .fetch_all(pool)
    .await?;
    let view_rows = sqlx::query(
        "SELECT table_schema, table_name, view_definition FROM information_schema.views WHERE table_schema NOT IN ('pg_catalog', 'information_schema') AND table_schema NOT LIKE 'pg_toast%' ORDER BY table_schema, table_name",
    )
    .fetch_all(pool)
    .await?;
    let index_rows = sqlx::query(
        "SELECT ns.nspname AS table_schema, tbl.relname AS table_name, idx.relname AS index_name, i.indisunique AS is_unique, i.indisprimary AS is_primary, am.amname AS index_type, pg_get_indexdef(i.indexrelid) AS definition, COALESCE(att.attname, pg_get_indexdef(i.indexrelid, ord.ordinality::integer, true), '<expression>') AS column_name FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class tbl ON tbl.oid = i.indrelid JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid JOIN pg_catalog.pg_namespace ns ON ns.oid = tbl.relnamespace JOIN pg_catalog.pg_am am ON am.oid = idx.relam JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS ord(attnum, ordinality) ON true LEFT JOIN pg_catalog.pg_attribute att ON att.attrelid = tbl.oid AND att.attnum = ord.attnum WHERE tbl.relkind IN ('r', 'p') AND ns.nspname NOT IN ('pg_catalog', 'information_schema') AND ns.nspname NOT LIKE 'pg_toast%' ORDER BY ns.nspname, tbl.relname, idx.relname, ord.ordinality",
    )
    .fetch_all(pool)
    .await?;
    let foreign_key_rows = sqlx::query(
        "SELECT con.oid::text AS constraint_id, source_ns.nspname AS source_schema, source_table.relname AS source_table, con.conname AS constraint_name, target_ns.nspname AS referenced_schema, target_table.relname AS referenced_table, source_column.attname AS source_column, target_column.attname AS referenced_column, ordinal.ordinality AS ordinal, CASE con.confupdtype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' ELSE con.confupdtype::text END AS on_update, CASE con.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' ELSE con.confdeltype::text END AS on_delete, CASE con.confmatchtype WHEN 's' THEN 'SIMPLE' WHEN 'f' THEN 'FULL' WHEN 'p' THEN 'PARTIAL' ELSE con.confmatchtype::text END AS match_type, con.condeferrable AS deferrable, con.condeferred AS initially_deferred FROM pg_catalog.pg_constraint con JOIN pg_catalog.pg_class source_table ON source_table.oid = con.conrelid JOIN pg_catalog.pg_namespace source_ns ON source_ns.oid = source_table.relnamespace JOIN pg_catalog.pg_class target_table ON target_table.oid = con.confrelid JOIN pg_catalog.pg_namespace target_ns ON target_ns.oid = target_table.relnamespace JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS ordinal(source_attnum, target_attnum, ordinality) ON true JOIN pg_catalog.pg_attribute source_column ON source_column.attrelid = source_table.oid AND source_column.attnum = ordinal.source_attnum JOIN pg_catalog.pg_attribute target_column ON target_column.attrelid = target_table.oid AND target_column.attnum = ordinal.target_attnum WHERE con.contype = 'f' AND source_ns.nspname NOT IN ('pg_catalog', 'information_schema') AND source_ns.nspname NOT LIKE 'pg_toast%' ORDER BY source_ns.nspname, source_table.relname, con.conname, ordinal.ordinality",
    )
    .fetch_all(pool)
    .await?;
    let routine_rows = sqlx::query(
        "SELECT p.oid::text AS routine_id, ns.nspname AS routine_schema, p.proname AS routine_name, p.prokind::text AS routine_kind, pg_get_function_identity_arguments(p.oid) AS identity_arguments, CASE WHEN p.prokind = 'p' THEN NULL::text ELSE pg_get_function_result(p.oid) END AS return_type, language.lanname AS language, CASE WHEN p.prokind IN ('f', 'p') THEN pg_get_functiondef(p.oid) ELSE NULL::text END AS definition, aggregate.aggkind::text AS aggregate_kind, aggregate.aggnumdirectargs::integer AS aggregate_direct_argument_count FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace ns ON ns.oid = p.pronamespace JOIN pg_catalog.pg_language language ON language.oid = p.prolang LEFT JOIN pg_catalog.pg_aggregate aggregate ON aggregate.aggfnoid = p.oid WHERE p.prokind IN ('f', 'p', 'a', 'w') AND ns.nspname NOT IN ('pg_catalog', 'information_schema') AND ns.nspname NOT LIKE 'pg_toast%' AND ns.nspname NOT LIKE 'pg_temp_%' ORDER BY ns.nspname, p.proname, pg_get_function_identity_arguments(p.oid)",
    )
    .fetch_all(pool)
    .await?;
    let trigger_rows = sqlx::query(
        "SELECT t.oid::text AS trigger_id, ns.nspname AS trigger_schema, t.tgname AS trigger_name, relation.relname AS relation_name, relation.relkind = 'v' AS is_view, t.tgtype::integer AS trigger_type, t.tgenabled::text AS trigger_status, pg_get_triggerdef(t.oid, true) AS definition, ARRAY(SELECT attribute.attname FROM unnest(t.tgattr::smallint[]) WITH ORDINALITY AS trigger_attribute(attnum, ordinality) JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid = t.tgrelid AND attribute.attnum = trigger_attribute.attnum ORDER BY trigger_attribute.ordinality)::text[] AS update_columns, routine.oid::text AS routine_id, routine_ns.nspname AS routine_schema, routine.proname AS routine_name, pg_get_function_identity_arguments(routine.oid) AS routine_identity_arguments FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class relation ON relation.oid = t.tgrelid JOIN pg_catalog.pg_namespace ns ON ns.oid = relation.relnamespace JOIN pg_catalog.pg_proc routine ON routine.oid = t.tgfoid JOIN pg_catalog.pg_namespace routine_ns ON routine_ns.oid = routine.pronamespace WHERE NOT t.tgisinternal AND relation.relkind IN ('r', 'p', 'v') AND relation.relpersistence <> 't' AND ns.nspname NOT IN ('pg_catalog', 'information_schema') AND ns.nspname NOT LIKE 'pg_toast%' AND ns.nspname NOT LIKE 'pg_temp_%' ORDER BY ns.nspname, t.tgname, relation.relname",
    )
    .fetch_all(pool)
    .await?;
    let event_trigger_rows = sqlx::query(
        "SELECT event_trigger.oid::text AS event_trigger_id, event_trigger.evtname AS event_trigger_name, event_trigger.evtevent AS event_name, event_trigger.evtenabled::text AS trigger_status, event_trigger.evttags AS tags, quote_ident(event_trigger.evtname) AS quoted_event_trigger_name, ARRAY(SELECT quote_literal(tag) FROM unnest(COALESCE(event_trigger.evttags, ARRAY[]::text[])) AS tag)::text[] AS quoted_tags, routine.oid::text AS routine_id, routine_ns.nspname AS routine_schema, routine.proname AS routine_name, pg_get_function_identity_arguments(routine.oid) AS routine_identity_arguments, quote_ident(routine_ns.nspname) AS quoted_routine_schema, quote_ident(routine.proname) AS quoted_routine_name FROM pg_catalog.pg_event_trigger event_trigger JOIN pg_catalog.pg_proc routine ON routine.oid = event_trigger.evtfoid JOIN pg_catalog.pg_namespace routine_ns ON routine_ns.oid = routine.pronamespace ORDER BY event_trigger.evtname",
    )
    .fetch_all(pool)
    .await?;
    let view_dependency_rows = sqlx::query(
        "SELECT DISTINCT view_relation.oid::text AS dependent_id, view_ns.nspname AS dependent_schema, view_relation.relname AS dependent_name, referenced_relation.oid::text AS referenced_id, referenced_ns.nspname AS referenced_schema, referenced_relation.relname AS referenced_name, referenced_relation.relkind = 'v' AS referenced_is_view FROM pg_catalog.pg_rewrite rewrite JOIN pg_catalog.pg_class view_relation ON view_relation.oid = rewrite.ev_class JOIN pg_catalog.pg_namespace view_ns ON view_ns.oid = view_relation.relnamespace JOIN pg_catalog.pg_depend dependency ON dependency.classid = 'pg_rewrite'::regclass AND dependency.objid = rewrite.oid AND dependency.refclassid = 'pg_class'::regclass JOIN pg_catalog.pg_class referenced_relation ON referenced_relation.oid = dependency.refobjid JOIN pg_catalog.pg_namespace referenced_ns ON referenced_ns.oid = referenced_relation.relnamespace WHERE rewrite.rulename = '_RETURN' AND view_relation.relkind = 'v' AND referenced_relation.relkind IN ('r', 'p', 'v') AND referenced_relation.oid <> view_relation.oid AND view_ns.nspname NOT IN ('pg_catalog', 'information_schema') AND view_ns.nspname NOT LIKE 'pg_toast%' AND view_ns.nspname NOT LIKE 'pg_temp_%' AND referenced_ns.nspname NOT IN ('pg_catalog', 'information_schema') AND referenced_ns.nspname NOT LIKE 'pg_toast%' AND referenced_ns.nspname NOT LIKE 'pg_temp_%' ORDER BY view_ns.nspname, view_relation.relname, referenced_ns.nspname, referenced_relation.relname",
    )
    .fetch_all(pool)
    .await?;

    let mut columns_by_table: HashMap<(String, String), Vec<ColumnMetadata>> = HashMap::new();
    for row in column_rows {
        let schema: String = row.try_get("table_schema")?;
        let table: String = row.try_get("table_name")?;
        columns_by_table
            .entry((schema, table))
            .or_default()
            .push(ColumnMetadata {
                name: row.try_get("column_name")?,
                r#type: row.try_get("data_type")?,
                nullable: row.try_get("nullable")?,
                primary_key: row.try_get("primary_key")?,
            });
    }

    let mut indexes_by_key: HashMap<(String, String, String), IndexMetadata> = HashMap::new();
    for row in index_rows {
        let schema: String = row.try_get("table_schema")?;
        let table: String = row.try_get("table_name")?;
        let index_name: String = row.try_get("index_name")?;
        let column_name: String = row.try_get("column_name")?;
        indexes_by_key
            .entry((schema, table, index_name.clone()))
            .and_modify(|index| index.columns.push(column_name.clone()))
            .or_insert(IndexMetadata {
                name: index_name,
                columns: vec![column_name],
                unique: row.try_get("is_unique")?,
                primary: row.try_get("is_primary")?,
                r#type: row.try_get("index_type")?,
                definition: Some(row.try_get("definition")?),
            });
    }

    let mut indexes_by_table: HashMap<(String, String), Vec<IndexMetadata>> = HashMap::new();
    for ((schema, table, _), index) in indexes_by_key {
        indexes_by_table
            .entry((schema, table))
            .or_default()
            .push(index);
    }
    for indexes in indexes_by_table.values_mut() {
        indexes.sort_by(|left, right| left.name.cmp(&right.name));
    }

    let mut foreign_keys_by_key: HashMap<(String, String, String), ForeignKeyMetadata> =
        HashMap::new();
    for row in foreign_key_rows {
        let schema: String = row.try_get("source_schema")?;
        let table: String = row.try_get("source_table")?;
        let constraint_id: String = row.try_get("constraint_id")?;
        let pair = ForeignKeyColumnPair {
            ordinal: row.try_get::<i64, _>("ordinal")? as u32,
            source_column: row.try_get("source_column")?,
            referenced_column: Some(row.try_get("referenced_column")?),
        };
        foreign_keys_by_key
            .entry((schema, table, constraint_id.clone()))
            .and_modify(|foreign_key| foreign_key.columns.push(pair.clone()))
            .or_insert(ForeignKeyMetadata {
                id: format!("postgres:{constraint_id}"),
                name: Some(row.try_get("constraint_name")?),
                columns: vec![pair],
                referenced_relation: RelationRef {
                    schema: row.try_get("referenced_schema")?,
                    name: row.try_get("referenced_table")?,
                },
                on_update: row.try_get("on_update")?,
                on_delete: row.try_get("on_delete")?,
                r#match: Some(row.try_get("match_type")?),
                deferrable: Some(row.try_get("deferrable")?),
                initially_deferred: Some(row.try_get("initially_deferred")?),
            });
    }

    let mut foreign_keys_by_table: HashMap<(String, String), Vec<ForeignKeyMetadata>> =
        HashMap::new();
    for ((schema, table, _), mut foreign_key) in foreign_keys_by_key {
        foreign_key
            .columns
            .sort_by_key(|column_pair| column_pair.ordinal);
        foreign_keys_by_table
            .entry((schema, table))
            .or_default()
            .push(foreign_key);
    }
    for foreign_keys in foreign_keys_by_table.values_mut() {
        foreign_keys.sort_by(|left, right| left.id.cmp(&right.id));
    }

    let tables = table_rows
        .into_iter()
        .map(|row| {
            let schema: String = row.try_get("table_schema")?;
            let name: String = row.try_get("table_name")?;
            let columns = columns_by_table
                .remove(&(schema.clone(), name.clone()))
                .unwrap_or_default();
            Ok(TableMetadata {
                indexes: indexes_by_table
                    .remove(&(schema.clone(), name.clone()))
                    .unwrap_or_default(),
                foreign_keys: foreign_keys_by_table
                    .remove(&(schema.clone(), name.clone()))
                    .unwrap_or_default(),
                schema,
                name,
                row_count: row.try_get::<i64, _>("row_count")?.max(0) as u64,
                columns,
            })
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()?;

    let views = view_rows
        .into_iter()
        .map(|row| {
            let schema: String = row.try_get("table_schema")?;
            let name: String = row.try_get("table_name")?;
            Ok(ViewMetadata {
                columns: columns_by_table
                    .remove(&(schema.clone(), name.clone()))
                    .unwrap_or_default(),
                schema,
                name,
                definition: row.try_get("view_definition")?,
            })
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()?;

    let routines = routine_rows
        .into_iter()
        .map(|row| {
            let id: String = row.try_get("routine_id")?;
            Ok(RoutineMetadata {
                id: format!("postgres:routine:{id}"),
                schema: row.try_get("routine_schema")?,
                name: row.try_get("routine_name")?,
                kind: routine_kind_from_catalog(&row.try_get::<String, _>("routine_kind")?),
                identity_arguments: row.try_get("identity_arguments")?,
                return_type: row.try_get("return_type")?,
                language: row.try_get("language")?,
                definition: row.try_get("definition")?,
                aggregate: if row.try_get::<String, _>("routine_kind")? == "a" {
                    Some(AggregateMetadata {
                        kind: aggregate_kind_from_catalog(
                            row.try_get::<Option<String>, _>("aggregate_kind")?
                                .as_deref(),
                        ),
                        direct_argument_count: row
                            .try_get::<Option<i32>, _>("aggregate_direct_argument_count")?
                            .unwrap_or_default()
                            .max(0) as u32,
                    })
                } else {
                    None
                },
            })
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()?;

    let mut triggers = Vec::new();
    let mut dependencies = Vec::new();
    for row in trigger_rows {
        let raw_id: String = row.try_get("trigger_id")?;
        let id = format!("postgres:trigger:{raw_id}");
        let trigger_type: i32 = row.try_get("trigger_type")?;
        let update_columns: Vec<String> = row.try_get("update_columns")?;
        let status: String = row.try_get("trigger_status")?;
        let definition: String = row.try_get("definition")?;
        let schema: String = row.try_get("trigger_schema")?;
        let name: String = row.try_get("trigger_name")?;
        let relation_name: String = row.try_get("relation_name")?;
        let relation_kind = if row.try_get("is_view")? {
            TriggerRelationKind::View
        } else {
            TriggerRelationKind::Table
        };
        let routine_raw_id: String = row.try_get("routine_id")?;
        let routine_schema: String = row.try_get("routine_schema")?;
        let routine_name: String = row.try_get("routine_name")?;
        let routine_identity_arguments: String = row.try_get("routine_identity_arguments")?;
        let mut events = Vec::new();
        if trigger_type & 4 != 0 {
            events.push(TriggerEvent::Insert);
        }
        if trigger_type & 16 != 0 {
            events.push(TriggerEvent::Update);
        }
        if trigger_type & 8 != 0 {
            events.push(TriggerEvent::Delete);
        }
        if trigger_type & 32 != 0 {
            events.push(TriggerEvent::Truncate);
        }
        triggers.push(TriggerMetadata {
            id: id.clone(),
            schema: schema.clone(),
            name: name.clone(),
            relation: TriggerRelationRef {
                schema: schema.clone(),
                name: relation_name,
                kind: relation_kind,
            },
            timing: if trigger_type & 64 != 0 {
                TriggerTiming::InsteadOf
            } else if trigger_type & 2 != 0 {
                TriggerTiming::Before
            } else {
                TriggerTiming::After
            },
            events,
            update_columns: (!update_columns.is_empty()).then_some(update_columns),
            orientation: if trigger_type & 1 != 0 {
                TriggerOrientation::Row
            } else {
                TriggerOrientation::Statement
            },
            status: match status.as_str() {
                "D" => TriggerStatus::Disabled,
                "R" => TriggerStatus::Replica,
                "A" => TriggerStatus::Always,
                _ => TriggerStatus::Origin,
            },
            condition: trigger_condition_from_definition(&definition),
            definition: Some(definition),
        });
        dependencies.push(DependencyMetadata {
            id: format!("postgres:dependency:trigger-function:{raw_id}"),
            kind: DependencyKind::TriggerFunction,
            dependent: DatabaseObjectRef {
                kind: DatabaseObjectKind::Trigger,
                id: Some(id),
                schema: Some(schema),
                name,
                identity_arguments: None,
            },
            referenced: DatabaseObjectRef {
                kind: DatabaseObjectKind::Routine,
                id: Some(format!("postgres:routine:{routine_raw_id}")),
                schema: Some(routine_schema),
                name: routine_name,
                identity_arguments: Some(routine_identity_arguments),
            },
        });
    }

    let mut event_triggers = Vec::new();
    for row in event_trigger_rows {
        let raw_id: String = row.try_get("event_trigger_id")?;
        let id = format!("postgres:event-trigger:{raw_id}");
        let name: String = row.try_get("event_trigger_name")?;
        let event_name: String = row.try_get("event_name")?;
        let status: String = row.try_get("trigger_status")?;
        let tags: Option<Vec<String>> = row.try_get("tags")?;
        let quoted_tags: Vec<String> = row.try_get("quoted_tags")?;
        let routine_raw_id: String = row.try_get("routine_id")?;
        let routine_schema: String = row.try_get("routine_schema")?;
        let routine_name: String = row.try_get("routine_name")?;
        let routine_identity_arguments: String = row.try_get("routine_identity_arguments")?;
        let function = DatabaseObjectRef {
            kind: DatabaseObjectKind::Routine,
            id: Some(format!("postgres:routine:{routine_raw_id}")),
            schema: Some(routine_schema),
            name: routine_name,
            identity_arguments: Some(routine_identity_arguments),
        };
        let tag_clause = if quoted_tags.is_empty() {
            String::new()
        } else {
            format!(" WHEN TAG IN ({})", quoted_tags.join(", "))
        };
        let definition = format!(
            "CREATE EVENT TRIGGER {} ON {}{} EXECUTE FUNCTION {}.{}();",
            row.try_get::<String, _>("quoted_event_trigger_name")?,
            event_name,
            tag_clause,
            row.try_get::<String, _>("quoted_routine_schema")?,
            row.try_get::<String, _>("quoted_routine_name")?,
        );
        event_triggers.push(EventTriggerMetadata {
            id: id.clone(),
            name: name.clone(),
            event: event_trigger_event_from_catalog(&event_name),
            status: trigger_status_from_catalog(&status),
            tags,
            function: function.clone(),
            definition: Some(definition),
        });
        dependencies.push(DependencyMetadata {
            id: format!("postgres:dependency:event-trigger-function:{raw_id}"),
            kind: DependencyKind::EventTriggerFunction,
            dependent: DatabaseObjectRef {
                kind: DatabaseObjectKind::EventTrigger,
                id: Some(id),
                schema: None,
                name,
                identity_arguments: None,
            },
            referenced: function,
        });
    }

    for table in &tables {
        for foreign_key in &table.foreign_keys {
            dependencies.push(DependencyMetadata {
                id: format!("postgres:dependency:foreign-key:{}", foreign_key.id),
                kind: DependencyKind::ForeignKey,
                dependent: relation_object_ref(
                    DatabaseObjectKind::Table,
                    &table.schema,
                    &table.name,
                ),
                referenced: relation_object_ref(
                    DatabaseObjectKind::Table,
                    &foreign_key.referenced_relation.schema,
                    &foreign_key.referenced_relation.name,
                ),
            });
        }
    }
    for trigger in &triggers {
        dependencies.push(DependencyMetadata {
            id: format!("postgres:dependency:trigger-owner:{}", trigger.id),
            kind: DependencyKind::TriggerOwner,
            dependent: DatabaseObjectRef {
                kind: DatabaseObjectKind::Trigger,
                id: Some(trigger.id.clone()),
                schema: Some(trigger.schema.clone()),
                name: trigger.name.clone(),
                identity_arguments: None,
            },
            referenced: relation_object_ref(
                match trigger.relation.kind {
                    TriggerRelationKind::Table => DatabaseObjectKind::Table,
                    TriggerRelationKind::View => DatabaseObjectKind::View,
                },
                &trigger.relation.schema,
                &trigger.relation.name,
            ),
        });
    }
    for row in view_dependency_rows {
        let dependent_id: String = row.try_get("dependent_id")?;
        let referenced_id: String = row.try_get("referenced_id")?;
        let dependent_schema: String = row.try_get("dependent_schema")?;
        let dependent_name: String = row.try_get("dependent_name")?;
        let referenced_schema: String = row.try_get("referenced_schema")?;
        let referenced_name: String = row.try_get("referenced_name")?;
        dependencies.push(DependencyMetadata {
            id: format!("postgres:dependency:view-reference:{dependent_id}:{referenced_id}"),
            kind: DependencyKind::ViewReference,
            dependent: relation_object_ref(
                DatabaseObjectKind::View,
                &dependent_schema,
                &dependent_name,
            ),
            referenced: relation_object_ref(
                if row.try_get("referenced_is_view")? {
                    DatabaseObjectKind::View
                } else {
                    DatabaseObjectKind::Table
                },
                &referenced_schema,
                &referenced_name,
            ),
        });
    }
    dependencies.sort_by(|left, right| left.id.cmp(&right.id));

    Ok(DatabaseMetadata {
        databases,
        schemas,
        tables,
        views,
        routines,
        triggers,
        event_triggers,
        dependencies,
    })
}

fn relation_object_ref(kind: DatabaseObjectKind, schema: &str, name: &str) -> DatabaseObjectRef {
    DatabaseObjectRef {
        kind,
        id: None,
        schema: Some(schema.to_string()),
        name: name.to_string(),
        identity_arguments: None,
    }
}

fn routine_kind_from_catalog(kind: &str) -> RoutineKind {
    match kind {
        "p" => RoutineKind::Procedure,
        "a" => RoutineKind::Aggregate,
        "w" => RoutineKind::Window,
        _ => RoutineKind::Function,
    }
}

fn aggregate_kind_from_catalog(kind: Option<&str>) -> AggregateKind {
    match kind {
        Some("n") => AggregateKind::Normal,
        Some("o") => AggregateKind::OrderedSet,
        Some("h") => AggregateKind::HypotheticalSet,
        _ => AggregateKind::Unknown,
    }
}

fn event_trigger_event_from_catalog(event: &str) -> EventTriggerEvent {
    match event {
        "ddl_command_start" => EventTriggerEvent::DdlCommandStart,
        "ddl_command_end" => EventTriggerEvent::DdlCommandEnd,
        "sql_drop" => EventTriggerEvent::SqlDrop,
        "table_rewrite" => EventTriggerEvent::TableRewrite,
        _ => EventTriggerEvent::Unknown,
    }
}

fn trigger_status_from_catalog(status: &str) -> TriggerStatus {
    match status {
        "D" => TriggerStatus::Disabled,
        "R" => TriggerStatus::Replica,
        "A" => TriggerStatus::Always,
        _ => TriggerStatus::Origin,
    }
}

fn trigger_condition_from_definition(definition: &str) -> Option<String> {
    let start = definition.find(" WHEN (")? + " WHEN (".len();
    let end = definition.rfind(") EXECUTE ")?;
    (end > start).then(|| definition[start..end].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn postgres_config() -> ConnectionConfig {
        ConnectionConfig {
            kind: DriverKind::Postgres,
            name: "postgres-contract".into(),
            database: "queryx_test".into(),
            host: Some("localhost".into()),
            port: Some(5432),
            username: Some("queryx".into()),
            password: None,
            ssl_mode: Some(SslMode::Disable),
            ssl_root_cert: None,
            ssl_client_cert: None,
            ssl_client_key: None,
            read_only: false,
        }
    }

    #[test]
    fn maps_all_postgres_ssl_modes() {
        assert!(matches!(map_ssl_mode(SslMode::Disable), PgSslMode::Disable));
        assert!(matches!(map_ssl_mode(SslMode::Prefer), PgSslMode::Prefer));
        assert!(matches!(map_ssl_mode(SslMode::Require), PgSslMode::Require));
        assert!(matches!(
            map_ssl_mode(SslMode::VerifyCa),
            PgSslMode::VerifyCa
        ));
        assert!(matches!(
            map_ssl_mode(SslMode::VerifyFull),
            PgSslMode::VerifyFull
        ));
    }

    #[test]
    fn validates_required_database_name() {
        let mut config = postgres_config();
        config.database.clear();
        let error =
            required_value(&config.database, "database").expect_err("reject empty database");
        assert!(matches!(error, AppError::InvalidPostgresConfig(_)));
    }

    #[test]
    fn detects_postgres_row_returning_statements() {
        assert!(is_row_returning_query("SELECT 1"));
        assert!(is_row_returning_query(
            "INSERT INTO users DEFAULT VALUES RETURNING id"
        ));
        assert!(!is_row_returning_query("DELETE FROM users WHERE id = 1"));
    }

    #[test]
    fn extracts_trigger_condition_from_database_rendered_ddl() {
        let definition = "CREATE TRIGGER audit BEFORE UPDATE ON public.orders FOR EACH ROW WHEN ((new.status IS NOT NULL)) EXECUTE FUNCTION audit_order()";
        assert_eq!(
            trigger_condition_from_definition(definition).as_deref(),
            Some("(new.status IS NOT NULL)")
        );
    }

    #[test]
    fn normalizes_event_trigger_catalog_values() {
        assert_eq!(
            event_trigger_event_from_catalog("ddl_command_start"),
            EventTriggerEvent::DdlCommandStart
        );
        assert_eq!(
            event_trigger_event_from_catalog("ddl_command_end"),
            EventTriggerEvent::DdlCommandEnd
        );
        assert_eq!(
            event_trigger_event_from_catalog("sql_drop"),
            EventTriggerEvent::SqlDrop
        );
        assert_eq!(
            event_trigger_event_from_catalog("table_rewrite"),
            EventTriggerEvent::TableRewrite
        );
        assert_eq!(
            event_trigger_event_from_catalog("future_event"),
            EventTriggerEvent::Unknown
        );
        assert_eq!(trigger_status_from_catalog("D"), TriggerStatus::Disabled);
        assert_eq!(trigger_status_from_catalog("O"), TriggerStatus::Origin);
    }

    #[test]
    fn normalizes_postgres_routine_and_aggregate_kinds() {
        assert_eq!(routine_kind_from_catalog("f"), RoutineKind::Function);
        assert_eq!(routine_kind_from_catalog("p"), RoutineKind::Procedure);
        assert_eq!(routine_kind_from_catalog("a"), RoutineKind::Aggregate);
        assert_eq!(routine_kind_from_catalog("w"), RoutineKind::Window);
        assert_eq!(routine_kind_from_catalog("future"), RoutineKind::Function);
        assert_eq!(
            aggregate_kind_from_catalog(Some("n")),
            AggregateKind::Normal
        );
        assert_eq!(
            aggregate_kind_from_catalog(Some("o")),
            AggregateKind::OrderedSet
        );
        assert_eq!(
            aggregate_kind_from_catalog(Some("h")),
            AggregateKind::HypotheticalSet
        );
        assert_eq!(aggregate_kind_from_catalog(None), AggregateKind::Unknown);
    }

    #[tokio::test]
    async fn satisfies_contract_when_test_database_is_available() {
        let Ok(database) = std::env::var("QUERYX_TEST_POSTGRES_DATABASE") else {
            return;
        };
        let mut config = postgres_config();
        config.database = database;
        config.host = std::env::var("QUERYX_TEST_POSTGRES_HOST").ok();
        config.port = std::env::var("QUERYX_TEST_POSTGRES_PORT")
            .ok()
            .and_then(|value| value.parse().ok());
        config.username = std::env::var("QUERYX_TEST_POSTGRES_USERNAME").ok();
        config.password = std::env::var("QUERYX_TEST_POSTGRES_PASSWORD").ok();

        let driver = PostgresDriver::connect(&config)
            .await
            .expect("connect postgres test database");
        let query_id = Uuid::new_v4();
        driver
            .prepare(query_id)
            .await
            .expect("prepare postgres contract query");
        let result = driver
            .execute(
                query_id,
                "SELECT 1::int4 AS id, 'QueryX'::text AS product",
                ExecutionMode::Direct,
            )
            .await
            .expect("execute postgres contract query");
        let metadata = driver.metadata().await.expect("load postgres metadata");

        assert_eq!(result.rows[0]["id"], Value::from(1));
        assert_eq!(result.rows[0]["product"], Value::from("QueryX"));
        assert!(metadata.databases.contains(&config.database));
        driver.disconnect().await.expect("disconnect postgres");
    }

    #[tokio::test]
    async fn read_only_rejects_writes_when_test_database_is_available() {
        let Ok(database) = std::env::var("QUERYX_TEST_POSTGRES_DATABASE") else {
            return;
        };
        let mut config = postgres_config();
        config.database = database;
        config.host = std::env::var("QUERYX_TEST_POSTGRES_HOST").ok();
        config.port = std::env::var("QUERYX_TEST_POSTGRES_PORT")
            .ok()
            .and_then(|value| value.parse().ok());
        config.username = std::env::var("QUERYX_TEST_POSTGRES_USERNAME").ok();
        config.password = std::env::var("QUERYX_TEST_POSTGRES_PASSWORD").ok();
        config.read_only = true;

        let driver = PostgresDriver::connect(&config)
            .await
            .expect("connect read-only postgres");
        assert!(driver.is_read_only());
        assert!(!driver.capabilities().contains(&DriverCapability::Editing));
        let query_id = Uuid::new_v4();
        driver.prepare(query_id).await.expect("prepare write probe");
        let error = driver
            .execute(
                query_id,
                "CREATE TEMP TABLE queryx_read_only_probe (id integer)",
                ExecutionMode::Direct,
            )
            .await
            .expect_err("read-only postgres must reject writes");
        assert!(error.to_string().to_lowercase().contains("read-only"));
        driver.disconnect().await.expect("disconnect postgres");
    }

    #[tokio::test]
    async fn loads_composite_foreign_keys_when_test_database_is_available() {
        let Ok(database) = std::env::var("QUERYX_TEST_POSTGRES_DATABASE") else {
            return;
        };
        let mut config = postgres_config();
        config.database = database;
        config.host = std::env::var("QUERYX_TEST_POSTGRES_HOST").ok();
        config.port = std::env::var("QUERYX_TEST_POSTGRES_PORT")
            .ok()
            .and_then(|value| value.parse().ok());
        config.username = std::env::var("QUERYX_TEST_POSTGRES_USERNAME").ok();
        config.password = std::env::var("QUERYX_TEST_POSTGRES_PASSWORD").ok();

        let driver = PostgresDriver::connect(&config)
            .await
            .expect("connect postgres metadata database");
        let schema = format!("queryx_contract_{}", Uuid::new_v4().simple());
        sqlx::query(&format!(r#"CREATE SCHEMA "{schema}""#))
            .execute(&driver.pool)
            .await
            .expect("create contract schema");
        sqlx::query(&format!(
            r#"CREATE TABLE "{schema}".accounts (tenant_id bigint NOT NULL, account_id bigint NOT NULL, PRIMARY KEY (tenant_id, account_id))"#
        ))
        .execute(&driver.pool)
        .await
        .expect("create contract parent");
        sqlx::query(&format!(
            r#"CREATE TABLE "{schema}".invoices (tenant_id bigint NOT NULL, account_id bigint NOT NULL, CONSTRAINT invoices_account_fkey FOREIGN KEY (tenant_id, account_id) REFERENCES "{schema}".accounts (tenant_id, account_id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED)"#
        ))
        .execute(&driver.pool)
        .await
        .expect("create contract child");

        let metadata = driver.metadata().await.expect("load postgres metadata");
        let invoices = metadata
            .tables
            .iter()
            .find(|table| table.schema == schema && table.name == "invoices")
            .expect("invoices metadata");
        let foreign_key = invoices
            .foreign_keys
            .iter()
            .find(|foreign_key| foreign_key.name.as_deref() == Some("invoices_account_fkey"))
            .expect("composite postgres foreign key");

        assert_eq!(foreign_key.referenced_relation.schema, schema);
        assert_eq!(foreign_key.referenced_relation.name, "accounts");
        assert_eq!(foreign_key.columns.len(), 2);
        assert_eq!(foreign_key.columns[0].source_column, "tenant_id");
        assert_eq!(
            foreign_key.columns[0].referenced_column.as_deref(),
            Some("tenant_id")
        );
        assert_eq!(foreign_key.columns[1].source_column, "account_id");
        assert_eq!(
            foreign_key.columns[1].referenced_column.as_deref(),
            Some("account_id")
        );
        assert_eq!(foreign_key.on_update, "CASCADE");
        assert_eq!(foreign_key.on_delete, "RESTRICT");
        assert_eq!(foreign_key.deferrable, Some(true));
        assert_eq!(foreign_key.initially_deferred, Some(true));
        let dependency = metadata
            .dependencies
            .iter()
            .find(|dependency| {
                dependency.kind == DependencyKind::ForeignKey
                    && dependency.dependent.schema.as_deref() == Some(schema.as_str())
                    && dependency.dependent.name == "invoices"
            })
            .expect("postgres foreign key dependency");
        assert_eq!(
            dependency.referenced.schema.as_deref(),
            Some(schema.as_str())
        );
        assert_eq!(dependency.referenced.name, "accounts");

        sqlx::query(&format!(r#"DROP SCHEMA "{schema}" CASCADE"#))
            .execute(&driver.pool)
            .await
            .expect("drop contract schema");
        driver.disconnect().await.expect("disconnect postgres");
    }

    #[tokio::test]
    async fn loads_overload_safe_routine_and_trigger_ddl_when_test_database_is_available() {
        let Ok(database) = std::env::var("QUERYX_TEST_POSTGRES_DATABASE") else {
            return;
        };
        let mut config = postgres_config();
        config.database = database;
        config.host = std::env::var("QUERYX_TEST_POSTGRES_HOST").ok();
        config.port = std::env::var("QUERYX_TEST_POSTGRES_PORT")
            .ok()
            .and_then(|value| value.parse().ok());
        config.username = std::env::var("QUERYX_TEST_POSTGRES_USERNAME").ok();
        config.password = std::env::var("QUERYX_TEST_POSTGRES_PASSWORD").ok();

        let driver = PostgresDriver::connect(&config)
            .await
            .expect("connect postgres routine metadata database");
        let schema = format!("queryx_routines_{}", Uuid::new_v4().simple());
        let event_trigger_name = format!("queryx_event_{}", Uuid::new_v4().simple());
        sqlx::query(&format!(r#"CREATE SCHEMA "{schema}""#))
            .execute(&driver.pool)
            .await
            .expect("create routine contract schema");
        for statement in [
            format!(r#"CREATE TABLE "{schema}".orders (id bigint PRIMARY KEY, status text)"#),
            format!(
                r#"CREATE VIEW "{schema}".active_orders AS SELECT id, status FROM "{schema}".orders WHERE status = 'active'"#
            ),
            format!(
                r#"CREATE FUNCTION "{schema}".calculate_total(amount numeric) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$ SELECT amount $$"#
            ),
            format!(
                r#"CREATE FUNCTION "{schema}".calculate_total(amount integer) RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT amount $$"#
            ),
            format!(
                r#"CREATE FUNCTION "{schema}".order_ids(prefix text DEFAULT '') RETURNS TABLE(order_id bigint) LANGUAGE sql STABLE AS $$ SELECT 1::bigint $$"#
            ),
            format!(
                r#"CREATE PROCEDURE "{schema}".refresh_orders() LANGUAGE sql AS $$ SELECT 1 $$"#
            ),
            format!(
                r#"CREATE FUNCTION "{schema}".audit_order() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$"#
            ),
            format!(
                r#"CREATE FUNCTION "{schema}".enforce_schema_policy() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN NULL; END $$"#
            ),
            format!(
                r#"CREATE FUNCTION "{schema}".sum_numeric(state numeric, value numeric) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$ SELECT COALESCE(state, 0) + value $$"#
            ),
            format!(
                r#"CREATE AGGREGATE "{schema}".total_numeric(numeric) (SFUNC = "{schema}".sum_numeric, STYPE = numeric, INITCOND = '0')"#
            ),
            format!(
                r#"CREATE EVENT TRIGGER "{event_trigger_name}" ON ddl_command_end WHEN TAG IN ('ALTER TABLE', 'CREATE TABLE') EXECUTE FUNCTION "{schema}".enforce_schema_policy()"#
            ),
            format!(r#"ALTER EVENT TRIGGER "{event_trigger_name}" DISABLE"#),
            format!(
                r#"CREATE TRIGGER orders_audit BEFORE INSERT OR UPDATE OF status ON "{schema}".orders FOR EACH ROW WHEN (NEW.status IS NOT NULL) EXECUTE FUNCTION "{schema}".audit_order()"#
            ),
            format!(r#"ALTER TABLE "{schema}".orders ENABLE ALWAYS TRIGGER orders_audit"#),
            format!(
                r#"CREATE TRIGGER orders_truncate AFTER TRUNCATE ON "{schema}".orders FOR EACH STATEMENT EXECUTE FUNCTION "{schema}".audit_order()"#
            ),
            format!(r#"ALTER TABLE "{schema}".orders DISABLE TRIGGER orders_truncate"#),
        ] {
            sqlx::query(&statement)
                .execute(&driver.pool)
                .await
                .expect("create routine contract object");
        }

        let metadata = driver.metadata().await.expect("load routine metadata");
        let overloads = metadata
            .routines
            .iter()
            .filter(|routine| routine.schema == schema && routine.name == "calculate_total")
            .collect::<Vec<_>>();
        let table_function = metadata
            .routines
            .iter()
            .find(|routine| routine.schema == schema && routine.name == "order_ids")
            .expect("table-returning function metadata");
        let procedure = metadata
            .routines
            .iter()
            .find(|routine| routine.schema == schema && routine.name == "refresh_orders")
            .expect("procedure metadata");
        let aggregate = metadata
            .routines
            .iter()
            .find(|routine| routine.schema == schema && routine.name == "total_numeric")
            .expect("aggregate metadata");

        assert_eq!(overloads.len(), 2);
        assert_ne!(overloads[0].id, overloads[1].id);
        assert!(overloads
            .iter()
            .any(|routine| routine.identity_arguments == "amount integer"));
        assert!(overloads
            .iter()
            .any(|routine| routine.identity_arguments == "amount numeric"));
        assert!(overloads.iter().all(|routine| {
            routine.kind == RoutineKind::Function
                && routine.language == "sql"
                && routine
                    .definition
                    .as_deref()
                    .is_some_and(|ddl| ddl.contains("CREATE OR REPLACE FUNCTION"))
        }));
        assert_eq!(table_function.identity_arguments, "prefix text");
        assert!(table_function
            .return_type
            .as_deref()
            .is_some_and(|value| value.starts_with("TABLE(")));
        assert_eq!(procedure.kind, RoutineKind::Procedure);
        assert_eq!(procedure.identity_arguments, "");
        assert_eq!(procedure.return_type, None);
        assert!(procedure
            .definition
            .as_deref()
            .is_some_and(|ddl| ddl.contains("CREATE OR REPLACE PROCEDURE")));
        assert_eq!(aggregate.kind, RoutineKind::Aggregate);
        assert_eq!(aggregate.identity_arguments, "numeric");
        assert_eq!(aggregate.return_type.as_deref(), Some("numeric"));
        assert_eq!(aggregate.language, "internal");
        assert_eq!(aggregate.definition, None);
        assert_eq!(
            aggregate.aggregate.as_ref().map(|value| value.kind),
            Some(AggregateKind::Normal)
        );
        assert_eq!(
            aggregate
                .aggregate
                .as_ref()
                .map(|value| value.direct_argument_count),
            Some(0)
        );
        let audit_trigger = metadata
            .triggers
            .iter()
            .find(|trigger| trigger.schema == schema && trigger.name == "orders_audit")
            .expect("postgres audit trigger metadata");
        assert_eq!(audit_trigger.relation.name, "orders");
        assert_eq!(audit_trigger.timing, TriggerTiming::Before);
        assert_eq!(
            audit_trigger.events,
            [TriggerEvent::Insert, TriggerEvent::Update]
        );
        assert_eq!(
            audit_trigger.update_columns.as_ref(),
            Some(&vec!["status".to_string()])
        );
        assert_eq!(audit_trigger.orientation, TriggerOrientation::Row);
        assert_eq!(audit_trigger.status, TriggerStatus::Always);
        assert!(audit_trigger
            .condition
            .as_deref()
            .is_some_and(|value| value.to_ascii_lowercase().contains("new.status")));
        assert!(audit_trigger
            .definition
            .as_deref()
            .is_some_and(|ddl| ddl.contains("CREATE TRIGGER")));
        let truncate_trigger = metadata
            .triggers
            .iter()
            .find(|trigger| trigger.schema == schema && trigger.name == "orders_truncate")
            .expect("postgres truncate trigger metadata");
        assert_eq!(truncate_trigger.events, [TriggerEvent::Truncate]);
        assert_eq!(truncate_trigger.orientation, TriggerOrientation::Statement);
        assert_eq!(truncate_trigger.status, TriggerStatus::Disabled);
        let trigger_function = metadata
            .dependencies
            .iter()
            .find(|dependency| {
                dependency.kind == DependencyKind::TriggerFunction
                    && dependency.dependent.id.as_deref() == Some(audit_trigger.id.as_str())
            })
            .expect("postgres trigger function dependency");
        assert_eq!(
            trigger_function.referenced.kind,
            DatabaseObjectKind::Routine
        );
        assert_eq!(
            trigger_function.referenced.schema.as_deref(),
            Some(schema.as_str())
        );
        assert_eq!(trigger_function.referenced.name, "audit_order");
        assert_eq!(
            trigger_function.referenced.identity_arguments.as_deref(),
            Some("")
        );
        let trigger_owner = metadata
            .dependencies
            .iter()
            .find(|dependency| {
                dependency.kind == DependencyKind::TriggerOwner
                    && dependency.dependent.id.as_deref() == Some(audit_trigger.id.as_str())
            })
            .expect("postgres trigger owner dependency");
        assert_eq!(trigger_owner.referenced.kind, DatabaseObjectKind::Table);
        assert_eq!(trigger_owner.referenced.name, "orders");
        let view_reference = metadata
            .dependencies
            .iter()
            .find(|dependency| {
                dependency.kind == DependencyKind::ViewReference
                    && dependency.dependent.schema.as_deref() == Some(schema.as_str())
                    && dependency.dependent.name == "active_orders"
                    && dependency.referenced.name == "orders"
            })
            .expect("postgres view relation dependency");
        assert_eq!(view_reference.referenced.kind, DatabaseObjectKind::Table);
        let event_trigger = metadata
            .event_triggers
            .iter()
            .find(|event_trigger| event_trigger.name == event_trigger_name)
            .expect("postgres event trigger metadata");
        assert_eq!(event_trigger.event, EventTriggerEvent::DdlCommandEnd);
        assert_eq!(event_trigger.status, TriggerStatus::Disabled);
        assert_eq!(
            event_trigger.tags.as_ref(),
            Some(&vec!["ALTER TABLE".to_string(), "CREATE TABLE".to_string()])
        );
        assert_eq!(event_trigger.function.kind, DatabaseObjectKind::Routine);
        assert_eq!(
            event_trigger.function.schema.as_deref(),
            Some(schema.as_str())
        );
        assert_eq!(event_trigger.function.name, "enforce_schema_policy");
        assert_eq!(
            event_trigger.function.identity_arguments.as_deref(),
            Some("")
        );
        assert!(event_trigger
            .definition
            .as_deref()
            .is_some_and(|definition| {
                definition.contains("CREATE EVENT TRIGGER")
                    && definition.contains("WHEN TAG IN ('ALTER TABLE', 'CREATE TABLE')")
                    && definition.contains("EXECUTE FUNCTION")
            }));
        let event_trigger_function = metadata
            .dependencies
            .iter()
            .find(|dependency| {
                dependency.kind == DependencyKind::EventTriggerFunction
                    && dependency.dependent.id.as_deref() == Some(event_trigger.id.as_str())
            })
            .expect("postgres event trigger function dependency");
        assert_eq!(event_trigger_function.dependent.schema, None);
        assert_eq!(
            event_trigger_function.referenced.id,
            event_trigger.function.id
        );

        sqlx::query(&format!(r#"DROP EVENT TRIGGER "{event_trigger_name}""#))
            .execute(&driver.pool)
            .await
            .expect("drop event trigger");
        sqlx::query(&format!(r#"DROP SCHEMA "{schema}" CASCADE"#))
            .execute(&driver.pool)
            .await
            .expect("drop routine contract schema");
        driver.disconnect().await.expect("disconnect postgres");
    }

    #[tokio::test]
    async fn cancels_a_live_postgres_query_when_available() {
        let Ok(database) = std::env::var("QUERYX_TEST_POSTGRES_DATABASE") else {
            return;
        };
        let mut config = postgres_config();
        config.database = database;
        config.host = std::env::var("QUERYX_TEST_POSTGRES_HOST").ok();
        config.port = std::env::var("QUERYX_TEST_POSTGRES_PORT")
            .ok()
            .and_then(|value| value.parse().ok());
        config.username = std::env::var("QUERYX_TEST_POSTGRES_USERNAME").ok();
        config.password = std::env::var("QUERYX_TEST_POSTGRES_PASSWORD").ok();

        let driver = Arc::new(
            PostgresDriver::connect(&config)
                .await
                .expect("connect postgres cancellation test database"),
        );
        let query_id = Uuid::new_v4();
        driver
            .prepare(query_id)
            .await
            .expect("prepare cancellable query");
        let execution_driver = Arc::clone(&driver);
        let execution = tokio::spawn(async move {
            execution_driver
                .execute(query_id, "SELECT pg_sleep(10)", ExecutionMode::Direct)
                .await
        });

        let active = driver
            .active_queries
            .read()
            .await
            .get(&query_id)
            .cloned()
            .expect("prepared query is tracked");
        loop {
            if matches!(*active.state.lock().await, ActiveQueryState::Running(_)) {
                break;
            }
            tokio::task::yield_now().await;
        }
        assert!(driver.cancel(query_id).await.expect("cancel live query"));
        let error = tokio::time::timeout(Duration::from_secs(3), execution)
            .await
            .expect("cancelled query should finish quickly")
            .expect("query task should not panic")
            .expect_err("cancelled query should return an error");

        assert!(matches!(error, AppError::QueryCancelled));
        driver.disconnect().await.expect("disconnect postgres");
    }

    #[tokio::test]
    async fn cancellation_before_activation_prevents_execution() {
        let active = ActiveQuery::pending();

        assert_eq!(active.request_cancel().await, CancelAction::BeforeStart);
        assert!(!active.activate(42).await);
        assert!(active.finish_execution().await);
    }

    #[tokio::test]
    async fn duplicate_cancellation_is_idempotent() {
        let active = ActiveQuery::pending();

        assert!(active.activate(42).await);
        assert_eq!(active.request_cancel().await, CancelAction::Send(42));
        assert_eq!(
            active.request_cancel().await,
            CancelAction::AlreadyRequested
        );
        active.complete_cancellation(true).await;
        assert!(active.finish_execution().await);
    }
}
