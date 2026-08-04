use std::{collections::HashMap, time::Instant};

use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use bigdecimal::BigDecimal;
use chrono::{NaiveDate, NaiveDateTime, NaiveTime};
use serde_json::Value;
use sqlx::{
    mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlRow, MySqlSslMode},
    Column, MySql, MySqlPool, Row, TypeInfo, ValueRef,
};
use uuid::Uuid;

use crate::{
    driver::{DatabaseDriver, ExecutionMode},
    error::AppError,
    models::{
        ColumnMetadata, DatabaseMetadata, DriverCapability, DriverKind, IndexMetadata, QueryColumn,
        QueryResult, SslMode, TableMetadata, ViewMetadata,
    },
};

/// MySQL/MariaDB support intentionally starts with the common IDE workflow:
/// connect, inspect relations, run SQL, browse rows, and edit through SQL.
/// Vendor-specific routines, events, and cancellation are separate capability
/// work and are not advertised here.
pub struct MysqlDriver {
    database: String,
    pool: MySqlPool,
    read_only: bool,
}

impl MysqlDriver {
    pub async fn connect(config: &crate::models::ConnectionConfig) -> Result<Self, AppError> {
        let database = required_value(&config.database, "database")?;
        let host = config.host.as_deref().unwrap_or("localhost");
        let username = config.username.as_deref().unwrap_or("root");
        let ssl_mode = match config.ssl_mode.unwrap_or(SslMode::Prefer) {
            SslMode::Disable => MySqlSslMode::Disabled,
            SslMode::Prefer => MySqlSslMode::Preferred,
            SslMode::Require => MySqlSslMode::Required,
        };
        let mut options = MySqlConnectOptions::new()
            .host(host)
            .port(config.port.unwrap_or(3306))
            .username(username)
            .database(database)
            .ssl_mode(ssl_mode);
        if let Some(password) = config.password.as_deref() {
            options = options.password(password);
        }

        let read_only = config.read_only;
        let mut pool_options = MySqlPoolOptions::new().max_connections(5);
        if read_only {
            pool_options = pool_options.after_connect(|connection, _| {
                Box::pin(async move {
                    sqlx::query("SET SESSION TRANSACTION READ ONLY")
                        .execute(connection)
                        .await?;
                    Ok(())
                })
            });
        }
        let pool = pool_options.connect_with(options).await?;

        Ok(Self {
            database: database.to_string(),
            pool,
            read_only,
        })
    }
}

#[async_trait]
impl DatabaseDriver for MysqlDriver {
    fn kind(&self) -> DriverKind {
        DriverKind::Mysql
    }

    fn database(&self) -> &str {
        &self.database
    }

    fn is_read_only(&self) -> bool {
        self.read_only
    }

    fn capabilities(&self) -> Vec<DriverCapability> {
        let mut capabilities = vec![DriverCapability::Transactions, DriverCapability::Explain];
        if !self.read_only {
            capabilities.push(DriverCapability::Editing);
        }
        capabilities
    }

    async fn execute(
        &self,
        _query_id: Uuid,
        sql: &str,
        mode: ExecutionMode,
    ) -> Result<QueryResult, AppError> {
        if self.read_only && !is_read_only_statement(sql) {
            return Err(AppError::ReadOnlyViolation);
        }
        execute_on_pool(&self.pool, sql, mode == ExecutionMode::Transaction).await
    }

    async fn execute_batch(
        &self,
        _query_id: Uuid,
        statements: &[String],
        expected_rows: u64,
    ) -> Result<QueryResult, AppError> {
        if self.read_only {
            return Err(AppError::ReadOnlyViolation);
        }
        execute_edit_batch_on_pool(&self.pool, statements, expected_rows).await
    }

    async fn cancel(&self, _query_id: Uuid) -> Result<bool, AppError> {
        Err(AppError::CancellationUnsupported(self.kind().to_string()))
    }

    async fn metadata(&self) -> Result<DatabaseMetadata, AppError> {
        let relation_rows = sqlx::query(
            "SELECT table_name, table_type, table_rows, view_definition FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type IN ('BASE TABLE', 'VIEW') ORDER BY table_type, table_name",
        )
        .fetch_all(&self.pool)
        .await?;
        let column_rows = sqlx::query(
            "SELECT table_name, column_name, column_type, is_nullable, column_key FROM information_schema.columns WHERE table_schema = DATABASE() ORDER BY table_name, ordinal_position",
        )
        .fetch_all(&self.pool)
        .await?;
        let index_rows = sqlx::query(
            "SELECT table_name, index_name, non_unique, index_type, column_name FROM information_schema.statistics WHERE table_schema = DATABASE() ORDER BY table_name, index_name, seq_in_index",
        )
        .fetch_all(&self.pool)
        .await?;

        let mut columns_by_relation: HashMap<String, Vec<ColumnMetadata>> = HashMap::new();
        for row in column_rows {
            columns_by_relation
                .entry(row.try_get("table_name")?)
                .or_default()
                .push(ColumnMetadata {
                    name: row.try_get("column_name")?,
                    r#type: row.try_get("column_type")?,
                    nullable: row.try_get::<String, _>("is_nullable")? == "YES",
                    primary_key: row.try_get::<String, _>("column_key")? == "PRI",
                });
        }

        let mut indexes_by_key: HashMap<(String, String), IndexMetadata> = HashMap::new();
        for row in index_rows {
            let table_name: String = row.try_get("table_name")?;
            let index_name: String = row.try_get("index_name")?;
            let column_name: Option<String> = row.try_get("column_name")?;
            let Some(column_name) = column_name else {
                continue;
            };
            indexes_by_key
                .entry((table_name, index_name.clone()))
                .and_modify(|index| index.columns.push(column_name.clone()))
                .or_insert(IndexMetadata {
                    name: index_name.clone(),
                    columns: vec![column_name],
                    unique: row.try_get::<i64, _>("non_unique")? == 0,
                    primary: index_name == "PRIMARY",
                    r#type: row.try_get("index_type")?,
                    definition: None,
                });
        }

        let mut indexes_by_table: HashMap<String, Vec<IndexMetadata>> = HashMap::new();
        for ((table_name, _), index) in indexes_by_key {
            indexes_by_table.entry(table_name).or_default().push(index);
        }
        for indexes in indexes_by_table.values_mut() {
            indexes.sort_by(|left, right| left.name.cmp(&right.name));
        }

        let mut tables = Vec::new();
        let mut views = Vec::new();
        for row in relation_rows {
            let name: String = row.try_get("table_name")?;
            let relation_type: String = row.try_get("table_type")?;
            let columns = columns_by_relation.remove(&name).unwrap_or_default();
            if relation_type == "VIEW" {
                views.push(ViewMetadata {
                    schema: self.database.clone(),
                    name,
                    columns,
                    definition: row.try_get("view_definition")?,
                });
            } else {
                tables.push(TableMetadata {
                    schema: self.database.clone(),
                    name: name.clone(),
                    row_count: row.try_get::<Option<i64>, _>("table_rows")?.unwrap_or(0) as u64,
                    columns,
                    indexes: indexes_by_table.remove(&name).unwrap_or_default(),
                    foreign_keys: Vec::new(),
                });
            }
        }

        Ok(DatabaseMetadata {
            databases: vec![self.database.clone()],
            schemas: vec![self.database.clone()],
            tables,
            views,
            routines: Vec::new(),
            triggers: Vec::new(),
            event_triggers: Vec::new(),
            dependencies: Vec::new(),
        })
    }

    async fn disconnect(&self) -> Result<(), AppError> {
        self.pool.close().await;
        Ok(())
    }
}

fn required_value<'a>(value: &'a str, field: &str) -> Result<&'a str, AppError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(AppError::InvalidMysqlConfig(format!("{field} is required")));
    }
    Ok(value)
}

async fn execute_on_pool(
    pool: &MySqlPool,
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

async fn execute_edit_batch_on_pool(
    pool: &MySqlPool,
    statements: &[String],
    expected_rows: u64,
) -> Result<QueryResult, AppError> {
    let started = Instant::now();
    let mut transaction = pool.begin().await?;
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
    E: sqlx::Executor<'e, Database = MySql>,
{
    if is_query {
        let rows = sqlx::query(sql).fetch_all(executor).await?;
        let columns = rows.first().map(columns_from_row).unwrap_or_default();
        let rows = rows.iter().map(row_to_json).collect::<Vec<_>>();
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

fn columns_from_row(row: &MySqlRow) -> Vec<QueryColumn> {
    row.columns()
        .iter()
        .map(|column| QueryColumn {
            name: column.name().to_string(),
            r#type: column.type_info().name().to_string(),
            nullable: true,
        })
        .collect()
}

fn row_to_json(row: &MySqlRow) -> HashMap<String, Value> {
    row.columns()
        .iter()
        .enumerate()
        .map(|(index, column)| (column.name().to_string(), value_to_json(row, index)))
        .collect()
}

fn value_to_json(row: &MySqlRow, index: usize) -> Value {
    let Ok(raw) = row.try_get_raw(index) else {
        return Value::Null;
    };
    if raw.is_null() {
        return Value::Null;
    }
    let type_name = raw.type_info().name().to_ascii_uppercase();
    match type_name.as_str() {
        "TINY" | "SHORT" | "LONG" | "LONGLONG" => row.try_get::<i64, _>(index).map(Value::from),
        "FLOAT" => row
            .try_get::<f32, _>(index)
            .map(|value| Value::from(f64::from(value))),
        "DOUBLE" => row.try_get::<f64, _>(index).map(Value::from),
        "NEWDECIMAL" => row
            .try_get::<BigDecimal, _>(index)
            .map(|value| Value::from(value.to_string())),
        "JSON" => row.try_get::<Value, _>(index),
        "DATE" => row
            .try_get::<NaiveDate, _>(index)
            .map(|value| Value::from(value.to_string())),
        "TIME" => row
            .try_get::<NaiveTime, _>(index)
            .map(|value| Value::from(value.to_string())),
        "DATETIME" | "TIMESTAMP" => row
            .try_get::<NaiveDateTime, _>(index)
            .map(|value| Value::from(value.to_string())),
        "BIT" | "BLOB" | "TINYBLOB" | "MEDIUMBLOB" | "LONGBLOB" => row
            .try_get::<Vec<u8>, _>(index)
            .map(|value| Value::from(BASE64.encode(value))),
        _ => row.try_get::<String, _>(index).map(Value::from),
    }
    .unwrap_or_else(|_| Value::String(format!("<{type_name}>")))
}

fn is_row_returning_query(sql: &str) -> bool {
    let normalized = sql
        .lines()
        .filter(|line| !line.trim_start().starts_with("--"))
        .collect::<Vec<_>>()
        .join(" ")
        .trim_start()
        .to_ascii_uppercase();
    [
        "SELECT", "WITH", "SHOW", "EXPLAIN", "VALUES", "DESCRIBE", "DESC",
    ]
    .iter()
    .any(|prefix| normalized.starts_with(prefix))
        || normalized.contains(" RETURNING ")
}

fn is_read_only_statement(sql: &str) -> bool {
    let normalized = sql
        .lines()
        .filter(|line| !line.trim_start().starts_with("--"))
        .collect::<Vec<_>>()
        .join(" ")
        .trim_start()
        .to_ascii_uppercase();
    [
        "SELECT", "SHOW", "EXPLAIN", "DESCRIBE", "DESC", "VALUES", "TABLE",
    ]
    .iter()
    .any(|prefix| normalized.starts_with(prefix))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_mysql_database_name() {
        let error = required_value("  ", "database").expect_err("blank database");
        assert!(matches!(error, AppError::InvalidMysqlConfig(_)));
    }

    #[test]
    fn read_only_guard_rejects_mutations_and_allows_inspection() {
        assert!(is_read_only_statement("-- comment\nSELECT 1"));
        assert!(is_read_only_statement("SHOW TABLES"));
        assert!(!is_read_only_statement("UPDATE users SET name = 'x'"));
        assert!(!is_read_only_statement("DROP TABLE users"));
    }

    #[test]
    fn recognizes_mysql_result_statements() {
        assert!(is_row_returning_query("DESCRIBE users"));
        assert!(is_row_returning_query("EXPLAIN SELECT 1"));
        assert!(!is_row_returning_query("CREATE TABLE users (id INT)"));
    }

    #[tokio::test]
    async fn mysql_contract_when_test_database_is_available() {
        let Some(database) = std::env::var_os("QUERYX_TEST_MYSQL_DATABASE") else {
            return;
        };
        let config = crate::models::ConnectionConfig {
            kind: DriverKind::Mysql,
            name: "mysql-contract".into(),
            database: database.to_string_lossy().into_owned(),
            read_only: true,
            host: std::env::var("QUERYX_TEST_MYSQL_HOST").ok(),
            port: std::env::var("QUERYX_TEST_MYSQL_PORT")
                .ok()
                .and_then(|value| value.parse().ok()),
            username: std::env::var("QUERYX_TEST_MYSQL_USER").ok(),
            password: std::env::var("QUERYX_TEST_MYSQL_PASSWORD").ok(),
            ssl_mode: None,
        };
        let driver = MysqlDriver::connect(&config)
            .await
            .expect("connect to configured MySQL contract database");
        let result = driver
            .execute(Uuid::new_v4(), "SELECT 1 AS health", ExecutionMode::Direct)
            .await
            .expect("read-only MySQL query");
        assert_eq!(result.columns[0].name, "health");
        assert!(driver.is_read_only());
        assert!(driver
            .execute(
                Uuid::new_v4(),
                "UPDATE queryx_contract SET status = 'blocked'",
                ExecutionMode::Direct,
            )
            .await
            .is_err());
        driver.disconnect().await.expect("disconnect MySQL");
    }
}
