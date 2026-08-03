use std::{collections::HashMap, str::FromStr, time::Instant};

use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde_json::Value;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions, SqliteRow},
    Column, Row, SqlitePool, TypeInfo, ValueRef,
};

use crate::{
    driver::{DatabaseDriver, ExecutionMode},
    error::AppError,
    models::{
        ColumnMetadata, DatabaseMetadata, DriverCapability, DriverKind, QueryColumn, QueryResult,
        TableMetadata,
    },
};

pub struct SqliteDriver {
    path: String,
    pool: SqlitePool,
}

impl SqliteDriver {
    pub async fn connect(path: &str) -> Result<Self, AppError> {
        let database_url = sqlite_url(path)?;
        let options = SqliteConnectOptions::from_str(&database_url)?.create_if_missing(true);
        let max_connections = if path == ":memory:" { 1 } else { 5 };
        let pool = SqlitePoolOptions::new()
            .max_connections(max_connections)
            .connect_with(options)
            .await?;

        if path == ":memory:" {
            seed_demo_database(&pool).await?;
        }

        Ok(Self {
            path: path.to_string(),
            pool,
        })
    }
}

#[async_trait]
impl DatabaseDriver for SqliteDriver {
    fn kind(&self) -> DriverKind {
        DriverKind::Sqlite
    }

    fn database(&self) -> &str {
        &self.path
    }

    fn capabilities(&self) -> Vec<DriverCapability> {
        vec![DriverCapability::Transactions, DriverCapability::Explain]
    }

    async fn execute(&self, sql: &str, mode: ExecutionMode) -> Result<QueryResult, AppError> {
        execute_on_pool(&self.pool, sql, mode == ExecutionMode::Transaction).await
    }

    async fn metadata(&self) -> Result<DatabaseMetadata, AppError> {
        let table_rows = sqlx::query(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .fetch_all(&self.pool)
        .await?;

        let mut tables = Vec::with_capacity(table_rows.len());
        for table_row in table_rows {
            let name: String = table_row.try_get("name")?;
            let escaped_name = name.replace('"', "\"\"");
            let pragma = format!("PRAGMA table_info(\"{escaped_name}\")");
            let column_rows = sqlx::query(&pragma).fetch_all(&self.pool).await?;
            let columns = column_rows
                .into_iter()
                .map(|row| {
                    Ok(ColumnMetadata {
                        name: row.try_get("name")?,
                        r#type: row.try_get("type")?,
                        nullable: row.try_get::<i64, _>("notnull")? == 0,
                        primary_key: row.try_get::<i64, _>("pk")? > 0,
                    })
                })
                .collect::<Result<Vec<_>, sqlx::Error>>()?;
            tables.push(TableMetadata {
                schema: "main".into(),
                name,
                row_count: 0,
                columns,
            });
        }

        Ok(DatabaseMetadata {
            databases: vec![self.path.clone()],
            schemas: vec!["main".into()],
            tables,
        })
    }

    async fn disconnect(&self) -> Result<(), AppError> {
        self.pool.close().await;
        Ok(())
    }
}

fn sqlite_url(path: &str) -> Result<String, AppError> {
    if path == ":memory:" {
        return Ok("sqlite::memory:".into());
    }
    if path.trim().is_empty() {
        return Err(AppError::InvalidPath("path is empty".into()));
    }
    Ok(format!("sqlite://{path}"))
}

async fn execute_on_pool(
    pool: &SqlitePool,
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
    E: sqlx::Executor<'e, Database = sqlx::Sqlite>,
{
    if is_query {
        let rows = sqlx::query(sql).fetch_all(executor).await?;
        let columns = rows.first().map(columns_from_row).unwrap_or_default();
        let rows = rows
            .iter()
            .map(row_to_json)
            .collect::<Result<Vec<_>, _>>()?;
        return Ok(QueryResult {
            columns,
            rows,
            execution_time: started.elapsed().as_millis(),
            affected_rows: 0,
            warnings: Vec::new(),
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

fn columns_from_row(row: &SqliteRow) -> Vec<QueryColumn> {
    row.columns()
        .iter()
        .map(|column| QueryColumn {
            name: column.name().to_string(),
            r#type: column.type_info().name().to_string(),
            nullable: true,
        })
        .collect()
}

fn row_to_json(row: &SqliteRow) -> Result<HashMap<String, Value>, AppError> {
    row.columns()
        .iter()
        .enumerate()
        .map(|(index, column)| Ok((column.name().to_string(), value_to_json(row, index)?)))
        .collect()
}

fn value_to_json(row: &SqliteRow, index: usize) -> Result<Value, AppError> {
    let raw = row.try_get_raw(index)?;
    if raw.is_null() {
        return Ok(Value::Null);
    }
    let type_name = raw.type_info().name().to_ascii_uppercase();
    if type_name.contains("INT") {
        return Ok(Value::from(row.try_get::<i64, _>(index)?));
    }
    if type_name.contains("REAL") || type_name.contains("FLOAT") || type_name.contains("DOUBLE") {
        return Ok(Value::from(row.try_get::<f64, _>(index)?));
    }
    if type_name.contains("BLOB") {
        return Ok(Value::from(
            BASE64.encode(row.try_get::<Vec<u8>, _>(index)?),
        ));
    }
    Ok(Value::from(row.try_get::<String, _>(index)?))
}

fn is_row_returning_query(sql: &str) -> bool {
    let normalized = sql
        .lines()
        .filter(|line| !line.trim_start().starts_with("--"))
        .collect::<Vec<_>>()
        .join(" ")
        .trim_start()
        .to_ascii_uppercase();
    ["SELECT", "WITH", "PRAGMA", "EXPLAIN"]
        .iter()
        .any(|prefix| normalized.starts_with(prefix))
}

async fn seed_demo_database(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, status TEXT NOT NULL, total_amount REAL NOT NULL, created_at TEXT NOT NULL)",
    )
    .execute(pool)
    .await?;
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM orders")
        .fetch_one(pool)
        .await?;
    if count == 0 {
        for offset in 1..=10 {
            sqlx::query("INSERT INTO orders (status, total_amount, created_at) VALUES ('paid', ?1, datetime('now', ?2))")
                .bind(125.50 + f64::from(offset) * 19.75)
                .bind(format!("-{offset} days"))
                .execute(pool)
                .await?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn reports_affected_rows_inside_a_transaction() {
        let driver = SqliteDriver::connect(":memory:")
            .await
            .expect("connect sqlite memory database");
        let result = driver
            .execute(
                "UPDATE orders SET status = 'review' WHERE id = 1",
                ExecutionMode::Transaction,
            )
            .await
            .expect("execute transaction");

        assert_eq!(result.affected_rows, 1);
    }
}
