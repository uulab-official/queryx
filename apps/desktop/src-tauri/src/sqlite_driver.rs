use std::{collections::HashMap, str::FromStr, time::Instant};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde_json::Value;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions, SqliteRow},
    Column, Row, SqlitePool, TypeInfo, ValueRef,
};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::{
    error::AppError,
    models::{
        ColumnMetadata, ConnectionSummary, DatabaseMetadata, QueryColumn, QueryResult,
        SqliteConnectionConfig, TableMetadata,
    },
};

pub struct SqliteDriverRegistry {
    connections: RwLock<HashMap<Uuid, SqliteConnection>>,
}

#[derive(Clone)]
struct SqliteConnection {
    path: String,
    pool: SqlitePool,
}

impl Default for SqliteDriverRegistry {
    fn default() -> Self {
        Self {
            connections: RwLock::new(HashMap::new()),
        }
    }
}

impl SqliteDriverRegistry {
    pub async fn connect(
        &self,
        config: SqliteConnectionConfig,
    ) -> Result<ConnectionSummary, AppError> {
        let database_url = sqlite_url(&config.path)?;
        let options = SqliteConnectOptions::from_str(&database_url)?.create_if_missing(true);
        let max_connections = if config.path == ":memory:" { 1 } else { 5 };
        let pool = SqlitePoolOptions::new()
            .max_connections(max_connections)
            .connect_with(options)
            .await?;

        if config.path == ":memory:" {
            seed_demo_database(&pool).await?;
        }

        let id = Uuid::new_v4();
        self.connections.write().await.insert(
            id,
            SqliteConnection {
                path: config.path.clone(),
                pool,
            },
        );

        Ok(ConnectionSummary {
            id: id.to_string(),
            driver: "sqlite",
            database: config.path,
        })
    }

    pub async fn execute(&self, connection_id: &str, sql: &str) -> Result<QueryResult, AppError> {
        let connection = self.connection(connection_id).await?;
        execute_on_pool(&connection.pool, sql, false).await
    }

    pub async fn execute_transaction(
        &self,
        connection_id: &str,
        sql: &str,
    ) -> Result<QueryResult, AppError> {
        let connection = self.connection(connection_id).await?;
        execute_on_pool(&connection.pool, sql, true).await
    }

    pub async fn metadata(&self, connection_id: &str) -> Result<DatabaseMetadata, AppError> {
        let connection = self.connection(connection_id).await?;
        let table_rows = sqlx::query(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .fetch_all(&connection.pool)
        .await?;

        let mut tables = Vec::with_capacity(table_rows.len());
        for table_row in table_rows {
            let name: String = table_row.try_get("name")?;
            let escaped_name = name.replace('"', "\"\"");
            let pragma = format!("PRAGMA table_info(\"{escaped_name}\")");
            let column_rows = sqlx::query(&pragma).fetch_all(&connection.pool).await?;
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
            databases: vec![connection.path],
            schemas: vec!["main".into()],
            tables,
        })
    }

    pub async fn disconnect(&self, connection_id: &str) -> Result<(), AppError> {
        let id = parse_connection_id(connection_id)?;
        let connection = self
            .connections
            .write()
            .await
            .remove(&id)
            .ok_or_else(|| AppError::ConnectionNotFound(connection_id.into()))?;
        connection.pool.close().await;
        Ok(())
    }

    async fn connection(&self, connection_id: &str) -> Result<SqliteConnection, AppError> {
        let id = parse_connection_id(connection_id)?;
        self.connections
            .read()
            .await
            .get(&id)
            .cloned()
            .ok_or_else(|| AppError::ConnectionNotFound(connection_id.into()))
    }
}

fn parse_connection_id(connection_id: &str) -> Result<Uuid, AppError> {
    Uuid::parse_str(connection_id).map_err(|_| AppError::ConnectionNotFound(connection_id.into()))
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
    async fn connects_executes_and_reads_metadata() {
        let registry = SqliteDriverRegistry::default();
        let connection = registry
            .connect(SqliteConnectionConfig {
                path: ":memory:".into(),
            })
            .await
            .expect("connect sqlite memory database");

        let result = registry
            .execute(&connection.id, "SELECT COUNT(*) AS orders FROM orders")
            .await
            .expect("execute query");
        let metadata = registry
            .metadata(&connection.id)
            .await
            .expect("read metadata");

        assert_eq!(result.rows[0]["orders"], Value::from(10));
        assert!(metadata.tables.iter().any(|table| table.name == "orders"));
        registry
            .disconnect(&connection.id)
            .await
            .expect("disconnect sqlite database");
    }

    #[tokio::test]
    async fn reports_affected_rows_inside_a_transaction() {
        let registry = SqliteDriverRegistry::default();
        let connection = registry
            .connect(SqliteConnectionConfig {
                path: ":memory:".into(),
            })
            .await
            .expect("connect sqlite memory database");

        let result = registry
            .execute_transaction(
                &connection.id,
                "UPDATE orders SET status = 'review' WHERE id = 1",
            )
            .await
            .expect("execute transaction");

        assert_eq!(result.affected_rows, 1);
    }
}
