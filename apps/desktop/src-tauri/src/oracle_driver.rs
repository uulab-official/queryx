use std::{collections::BTreeMap, sync::Arc, time::Instant};

use async_trait::async_trait;
use oracle_rs::{Config, Connection, TlsConfig, TlsMode, Value as OracleValue};
use serde_json::{json, Value};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::{
    driver::{DatabaseDriver, ExecutionMode, QueryChunkHandler},
    error::AppError,
    models::{
        ColumnMetadata, DatabaseMetadata, DriverCapability, DriverKind, QueryChunk, QueryColumn,
        QueryResult, TableMetadata, ViewMetadata,
    },
};

const FETCH_SIZE: u32 = 256;

pub struct OracleDriver {
    database: String,
    read_only: bool,
    connection: Arc<Connection>,
    transaction_active: Mutex<bool>,
}

impl OracleDriver {
    pub async fn connect(config: &crate::models::ConnectionConfig) -> Result<Self, AppError> {
        let host = config.host.as_deref().unwrap_or("localhost").trim();
        let username = config.username.as_deref().unwrap_or("system").trim();
        let service = config.database.trim();
        if host.is_empty() {
            return Err(AppError::InvalidOracleConfig("host cannot be blank".into()));
        }
        if username.is_empty() {
            return Err(AppError::InvalidOracleConfig(
                "username cannot be blank".into(),
            ));
        }
        if service.is_empty() {
            return Err(AppError::InvalidOracleConfig(
                "service name cannot be blank".into(),
            ));
        }

        let mut native = Config::new(
            host,
            config.port.unwrap_or(1521),
            service,
            username,
            config.password.as_deref().unwrap_or(""),
        )
        .with_statement_cache_size(32);
        if !matches!(config.ssl_mode, Some(crate::models::SslMode::Disable)) {
            let mut tls = TlsConfig::new().with_server_name(host);
            if let Some(ca_path) = config
                .ssl_root_cert
                .as_deref()
                .filter(|path| !path.trim().is_empty())
            {
                tls = tls.with_ca_cert(ca_path.trim());
            }
            if let (Some(cert), Some(key)) = (
                config.ssl_client_cert.as_deref(),
                config.ssl_client_key.as_deref(),
            ) {
                tls = tls.with_client_cert(cert.trim(), key.trim());
            }
            native = native.tls_config(tls);
        } else {
            native = native.tls(TlsMode::Disable);
        }

        let connection = Connection::connect_with_config(native)
            .await
            .map_err(|error| AppError::Oracle(error.to_string()))?;
        Ok(Self {
            database: service.to_string(),
            read_only: config.read_only,
            connection: Arc::new(connection),
            transaction_active: Mutex::new(false),
        })
    }

    async fn query_rows(
        &self,
        sql: &str,
        query_id: Uuid,
        stream: Option<QueryChunkHandler>,
    ) -> Result<QueryResult, AppError> {
        if self.read_only && !is_read_only_statement(sql) {
            return Err(AppError::ReadOnlyViolation);
        }
        let started = Instant::now();
        let mut result = self
            .connection
            .query(sql, &[])
            .await
            .map_err(|error| AppError::Oracle(error.to_string()))?;
        let mut columns = to_query_columns(&result.columns);
        let mut rows = Vec::new();
        let mut chunk_rows = Vec::new();
        let mut row_offset = 0u64;
        loop {
            if columns.is_empty() {
                columns = to_query_columns(&result.columns);
            }
            for row in result.rows {
                let mapped = oracle_row_to_json(&row, &columns);
                if stream.is_some() {
                    chunk_rows.push(mapped);
                    if chunk_rows.len() >= FETCH_SIZE as usize {
                        emit_chunk(&stream, query_id, row_offset, &columns, &mut chunk_rows);
                        row_offset += FETCH_SIZE as u64;
                    }
                } else {
                    rows.push(mapped);
                }
            }
            if !result.has_more_rows {
                break;
            }
            let cursor_id = result.cursor_id;
            let fetch_columns = result.columns.clone();
            result = self
                .connection
                .fetch_more(cursor_id, &fetch_columns, FETCH_SIZE)
                .await
                .map_err(|error| AppError::Oracle(error.to_string()))?;
        }
        if stream.is_some() && !chunk_rows.is_empty() {
            emit_chunk(&stream, query_id, row_offset, &columns, &mut chunk_rows);
        }
        Ok(QueryResult {
            columns,
            rows,
            execution_time: started.elapsed().as_millis(),
            affected_rows: 0,
            warnings: Vec::new(),
            error: None,
        })
    }

    async fn metadata_query(&self, sql: &str) -> Result<oracle_rs::QueryResult, AppError> {
        let mut result = self
            .connection
            .query(sql, &[])
            .await
            .map_err(|error| AppError::Oracle(error.to_string()))?;
        while result.has_more_rows {
            let cursor_id = result.cursor_id;
            let fetch_columns = result.columns.clone();
            let next = self
                .connection
                .fetch_more(cursor_id, &fetch_columns, FETCH_SIZE)
                .await
                .map_err(|error| AppError::Oracle(error.to_string()))?;
            result.rows.extend(next.rows);
            result.has_more_rows = next.has_more_rows;
            result.cursor_id = next.cursor_id;
        }
        Ok(result)
    }
}

#[async_trait]
impl DatabaseDriver for OracleDriver {
    fn kind(&self) -> DriverKind {
        DriverKind::Oracle
    }

    fn database(&self) -> &str {
        &self.database
    }

    fn is_read_only(&self) -> bool {
        self.read_only
    }

    fn capabilities(&self) -> Vec<DriverCapability> {
        let mut capabilities = vec![DriverCapability::Transactions, DriverCapability::Streaming];
        if !self.read_only {
            capabilities.push(DriverCapability::Editing);
        }
        capabilities
    }

    async fn execute(
        &self,
        _query_id: Uuid,
        sql: &str,
        _mode: ExecutionMode,
    ) -> Result<QueryResult, AppError> {
        if returns_rows(sql) {
            return self.query_rows(sql, Uuid::new_v4(), None).await;
        }
        if self.read_only {
            return Err(AppError::ReadOnlyViolation);
        }
        let started = Instant::now();
        let result = self
            .connection
            .execute_dml_sql(sql, &[])
            .await
            .map_err(|error| AppError::Oracle(error.to_string()))?;
        Ok(QueryResult {
            columns: Vec::new(),
            rows: Vec::new(),
            execution_time: started.elapsed().as_millis(),
            affected_rows: result,
            warnings: Vec::new(),
            error: None,
        })
    }

    async fn execute_stream(
        &self,
        query_id: Uuid,
        sql: &str,
        _mode: ExecutionMode,
        on_chunk: QueryChunkHandler,
    ) -> Result<QueryResult, AppError> {
        if !returns_rows(sql) {
            return self.execute(query_id, sql, ExecutionMode::Direct).await;
        }
        self.query_rows(sql, query_id, Some(on_chunk)).await
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
        let started = Instant::now();
        let explicit_transaction = *self.transaction_active.lock().await;
        let mut affected_rows = 0;
        for statement in statements {
            match self.connection.execute_dml_sql(statement, &[]).await {
                Ok(rows) => affected_rows += rows,
                Err(error) => {
                    if !explicit_transaction {
                        let _ = self.connection.rollback().await;
                    }
                    return Err(AppError::Oracle(error.to_string()));
                }
            }
        }
        if affected_rows != expected_rows {
            if !explicit_transaction {
                let _ = self.connection.rollback().await;
            }
            return Err(AppError::EditConflict {
                expected: expected_rows,
                actual: affected_rows,
            });
        }
        if !explicit_transaction {
            self.connection
                .commit()
                .await
                .map_err(|error| AppError::Oracle(error.to_string()))?;
        }
        Ok(QueryResult {
            columns: Vec::new(),
            rows: Vec::new(),
            execution_time: started.elapsed().as_millis(),
            affected_rows,
            warnings: Vec::new(),
            error: None,
        })
    }

    async fn begin_transaction(&self) -> Result<(), AppError> {
        let mut active = self.transaction_active.lock().await;
        if *active {
            return Err(AppError::TransactionAlreadyActive);
        }
        self.connection
            .execute_dml_sql("SAVEPOINT QUERYX_BEGIN", &[])
            .await
            .map(|_| {
                *active = true;
            })
            .map_err(|error| AppError::Oracle(error.to_string()))
    }

    async fn commit_transaction(&self) -> Result<(), AppError> {
        let mut active = self.transaction_active.lock().await;
        if !*active {
            return Err(AppError::TransactionNotActive);
        }
        let result = self
            .connection
            .commit()
            .await
            .map_err(|error| AppError::Oracle(error.to_string()));
        if result.is_ok() {
            *active = false;
        }
        result
    }

    async fn rollback_transaction(&self) -> Result<(), AppError> {
        let mut active = self.transaction_active.lock().await;
        if !*active {
            return Err(AppError::TransactionNotActive);
        }
        let result = self
            .connection
            .rollback()
            .await
            .map_err(|error| AppError::Oracle(error.to_string()));
        if result.is_ok() {
            *active = false;
        }
        result
    }

    async fn cancel(&self, _query_id: Uuid) -> Result<bool, AppError> {
        Err(AppError::CancellationUnsupported("Oracle".into()))
    }

    async fn metadata(&self) -> Result<DatabaseMetadata, AppError> {
        let schemas = self
            .metadata_query("SELECT username AS name FROM all_users ORDER BY username")
            .await?
            .rows
            .iter()
            .filter_map(|row| row_string(row, "name"))
            .collect();
        let databases = self
            .metadata_query("SELECT SYS_CONTEXT('USERENV', 'DB_NAME') AS name FROM dual")
            .await?
            .rows
            .iter()
            .filter_map(|row| row_string(row, "name"))
            .collect();
        let table_rows = self
            .metadata_query(
                "SELECT owner AS schema_name, table_name, NVL(num_rows, 0) AS row_count
                 FROM all_tables ORDER BY owner, table_name",
            )
            .await?;
        let column_rows = self
            .metadata_query(
                "SELECT owner AS schema_name, table_name AS relation_name, column_name,
                        data_type, nullable, column_id
                 FROM all_tab_columns ORDER BY owner, table_name, column_id",
            )
            .await?;
        let mut columns: BTreeMap<(String, String), Vec<ColumnMetadata>> = BTreeMap::new();
        for row in &column_rows.rows {
            let Some(schema) = row_string(row, "schema_name") else {
                continue;
            };
            let Some(relation) = row_string(row, "relation_name") else {
                continue;
            };
            columns
                .entry((schema, relation))
                .or_default()
                .push(ColumnMetadata {
                    name: row_string(row, "column_name").unwrap_or_default(),
                    r#type: row_string(row, "data_type").unwrap_or_else(|| "UNKNOWN".into()),
                    nullable: row_string(row, "nullable").is_some_and(|value| value == "Y"),
                    primary_key: false,
                });
        }
        let tables = table_rows
            .rows
            .iter()
            .filter_map(|row| {
                let schema = row_string(row, "schema_name")?;
                let name = row_string(row, "table_name")?;
                Some(TableMetadata {
                    schema: schema.clone(),
                    name: name.clone(),
                    row_count: row_u64(row, "row_count"),
                    columns: columns.remove(&(schema, name)).unwrap_or_default(),
                    indexes: Vec::new(),
                    foreign_keys: Vec::new(),
                })
            })
            .collect();
        let view_rows = self
            .metadata_query(
                "SELECT owner AS schema_name, view_name AS relation_name, text AS definition
                 FROM all_views ORDER BY owner, view_name",
            )
            .await?;
        let view_column_rows = self
            .metadata_query(
                "SELECT c.owner AS schema_name, c.table_name AS relation_name, c.column_name,
                        c.data_type, c.nullable, c.column_id
                 FROM all_tab_columns c JOIN all_views v
                   ON v.owner = c.owner AND v.view_name = c.table_name
                 ORDER BY c.owner, c.table_name, c.column_id",
            )
            .await?;
        let mut view_columns: BTreeMap<(String, String), Vec<ColumnMetadata>> = BTreeMap::new();
        for row in &view_column_rows.rows {
            let Some(schema) = row_string(row, "schema_name") else {
                continue;
            };
            let Some(relation) = row_string(row, "relation_name") else {
                continue;
            };
            view_columns
                .entry((schema, relation))
                .or_default()
                .push(ColumnMetadata {
                    name: row_string(row, "column_name").unwrap_or_default(),
                    r#type: row_string(row, "data_type").unwrap_or_else(|| "UNKNOWN".into()),
                    nullable: row_string(row, "nullable").is_some_and(|value| value == "Y"),
                    primary_key: false,
                });
        }
        let views = view_rows
            .rows
            .iter()
            .filter_map(|row| {
                let schema = row_string(row, "schema_name")?;
                let name = row_string(row, "relation_name")?;
                Some(ViewMetadata {
                    schema: schema.clone(),
                    name: name.clone(),
                    columns: view_columns.remove(&(schema, name)).unwrap_or_default(),
                    definition: row_string(row, "definition"),
                })
            })
            .collect();
        Ok(DatabaseMetadata {
            databases,
            schemas,
            tables,
            views,
            routines: Vec::new(),
            triggers: Vec::new(),
            event_triggers: Vec::new(),
            dependencies: Vec::new(),
        })
    }

    async fn disconnect(&self) -> Result<(), AppError> {
        if *self.transaction_active.lock().await {
            let _ = self.connection.rollback().await;
        }
        self.connection
            .close()
            .await
            .map_err(|error| AppError::Oracle(error.to_string()))
    }
}

fn emit_chunk(
    stream: &Option<QueryChunkHandler>,
    query_id: Uuid,
    row_offset: u64,
    columns: &[QueryColumn],
    rows: &mut Vec<std::collections::HashMap<String, Value>>,
) {
    if let Some(handler) = stream {
        let chunk_rows = std::mem::take(rows);
        handler(QueryChunk {
            query_id: query_id.to_string(),
            row_offset,
            columns: columns.to_vec(),
            rows: chunk_rows,
            warnings: Vec::new(),
        });
    }
}

fn to_query_columns(columns: &[oracle_rs::ColumnInfo]) -> Vec<QueryColumn> {
    columns
        .iter()
        .map(|column| QueryColumn {
            name: column.name.clone(),
            r#type: format!("{:?}", column.oracle_type),
            nullable: column.nullable,
        })
        .collect()
}

fn oracle_row_to_json(
    row: &oracle_rs::Row,
    columns: &[QueryColumn],
) -> std::collections::HashMap<String, Value> {
    columns
        .iter()
        .enumerate()
        .map(|(index, column)| {
            let value = row
                .get(index)
                .map(oracle_value_to_json)
                .unwrap_or(Value::Null);
            (column.name.clone(), value)
        })
        .collect()
}

fn oracle_value_to_json(value: &OracleValue) -> Value {
    match value {
        OracleValue::Null => Value::Null,
        OracleValue::String(value) => json!(value),
        OracleValue::Bytes(value) => json!(base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            value
        )),
        OracleValue::Integer(value) => json!(value),
        OracleValue::Float(value) => json!(value),
        OracleValue::Number(value) => json!(value.as_str()),
        OracleValue::Boolean(value) => json!(value),
        OracleValue::Json(value) => value.clone(),
        OracleValue::Date(value) => json!(format!(
            "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}",
            value.year, value.month, value.day, value.hour, value.minute, value.second
        )),
        OracleValue::Timestamp(value) => json!(format!(
            "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:06}",
            value.year,
            value.month,
            value.day,
            value.hour,
            value.minute,
            value.second,
            value.microsecond
        )),
        value => json!(format!("{value:?}")),
    }
}

fn row_string(row: &oracle_rs::Row, name: &str) -> Option<String> {
    row.get_by_name(name).and_then(|value| match value {
        OracleValue::String(value) => Some(value.clone()),
        OracleValue::Integer(value) => Some(value.to_string()),
        OracleValue::Number(value) => Some(value.as_str().to_string()),
        OracleValue::Float(value) => Some(value.to_string()),
        OracleValue::Boolean(value) => Some(value.to_string()),
        _ => None,
    })
}

fn row_u64(row: &oracle_rs::Row, name: &str) -> u64 {
    row_string(row, name)
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or_default()
}

fn returns_rows(sql: &str) -> bool {
    matches!(
        sql.split_whitespace()
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str(),
        "select" | "with"
    )
}

fn is_read_only_statement(sql: &str) -> bool {
    let normalized = sql.trim_start().to_ascii_lowercase();
    returns_rows(sql)
        && ![
            "insert ",
            "update ",
            "delete ",
            "merge ",
            "alter ",
            "drop ",
            "create ",
            "truncate ",
            "grant ",
            "revoke ",
        ]
        .iter()
        .any(|keyword| normalized.contains(keyword))
}

#[cfg(test)]
mod tests {
    use super::{is_read_only_statement, returns_rows};

    #[test]
    fn classifies_oracle_queries() {
        assert!(returns_rows("SELECT 1 FROM dual"));
        assert!(returns_rows(
            "WITH recent AS (SELECT 1 FROM dual) SELECT * FROM recent"
        ));
        assert!(!returns_rows("UPDATE employees SET active = 0"));
    }

    #[test]
    fn read_only_guard_rejects_oracle_mutations() {
        assert!(is_read_only_statement("SELECT username FROM all_users"));
        assert!(!is_read_only_statement(
            "CREATE TABLE audit_log (id NUMBER)"
        ));
        assert!(!is_read_only_statement(
            "WITH rows AS (SELECT 1 FROM dual) UPDATE audit_log SET id = 1"
        ));
    }
}
