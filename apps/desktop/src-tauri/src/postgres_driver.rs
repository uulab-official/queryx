use std::{collections::HashMap, time::Duration, time::Instant};

use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use bigdecimal::BigDecimal;
use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use serde_json::Value;
use sqlx::{
    postgres::{PgConnectOptions, PgPoolOptions, PgRow, PgSslMode},
    Column, PgPool, Postgres, Row, TypeInfo, ValueRef,
};

use crate::{
    driver::{DatabaseDriver, ExecutionMode},
    error::AppError,
    models::{
        ColumnMetadata, ConnectionConfig, DatabaseMetadata, DriverCapability, DriverKind,
        QueryColumn, QueryResult, SslMode, TableMetadata,
    },
};

pub struct PostgresDriver {
    database: String,
    pool: PgPool,
}

impl PostgresDriver {
    pub async fn connect(config: &ConnectionConfig) -> Result<Self, AppError> {
        let database = required_value(&config.database, "database")?;
        let host = config.host.as_deref().unwrap_or("localhost");
        let username = config.username.as_deref().unwrap_or("postgres");
        let ssl_mode = match config.ssl_mode.unwrap_or(SslMode::Prefer) {
            SslMode::Disable => PgSslMode::Disable,
            SslMode::Prefer => PgSslMode::Prefer,
            SslMode::Require => PgSslMode::Require,
        };
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

        let pool = PgPoolOptions::new()
            .max_connections(5)
            .acquire_timeout(Duration::from_secs(10))
            .connect_with(options)
            .await?;

        Ok(Self {
            database: database.to_string(),
            pool,
        })
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

    fn capabilities(&self) -> Vec<DriverCapability> {
        vec![DriverCapability::Transactions, DriverCapability::Explain]
    }

    async fn execute(&self, sql: &str, mode: ExecutionMode) -> Result<QueryResult, AppError> {
        execute_on_pool(&self.pool, sql, mode == ExecutionMode::Transaction).await
    }

    async fn metadata(&self) -> Result<DatabaseMetadata, AppError> {
        load_metadata(&self.pool).await
    }

    async fn disconnect(&self) -> Result<(), AppError> {
        self.pool.close().await;
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

async fn execute_on_pool(
    pool: &PgPool,
    sql: &str,
    in_transaction: bool,
) -> Result<QueryResult, AppError> {
    let started = Instant::now();
    let is_query = is_row_returning_query(sql);

    if in_transaction {
        let mut transaction = pool.begin().await?;
        let result = execute_with_executor(&mut *transaction, sql, is_query, started).await?;
        transaction.commit().await?;
        return Ok(result);
    }

    execute_with_executor(pool, sql, is_query, started).await
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

    let tables = table_rows
        .into_iter()
        .map(|row| {
            let schema: String = row.try_get("table_schema")?;
            let name: String = row.try_get("table_name")?;
            let columns = columns_by_table
                .remove(&(schema.clone(), name.clone()))
                .unwrap_or_default();
            Ok(TableMetadata {
                schema,
                name,
                row_count: row.try_get::<i64, _>("row_count")?.max(0) as u64,
                columns,
            })
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()?;

    Ok(DatabaseMetadata {
        databases,
        schemas,
        tables,
    })
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
        }
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
        let result = driver
            .execute(
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
}
