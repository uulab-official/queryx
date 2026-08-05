use std::{
    collections::{BTreeMap, HashMap},
    time::Instant,
};

use async_trait::async_trait;
use futures_util::TryStreamExt;
use serde_json::{json, Value};
use tiberius::{AuthMethod, Client, ColumnData, Config, EncryptionLevel, QueryItem, Row};
use tokio::{net::TcpStream, sync::Mutex};
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};
use uuid::Uuid;

use crate::{
    driver::{DatabaseDriver, ExecutionMode, QueryChunkHandler},
    error::AppError,
    models::{
        ColumnMetadata, DatabaseMetadata, DriverCapability, DriverKind, ForeignKeyMetadata,
        QueryChunk, QueryColumn, QueryResult, TableMetadata, ViewMetadata,
    },
};

type SqlServerClient = Client<Compat<TcpStream>>;

pub struct SqlServerDriver {
    database: String,
    read_only: bool,
    client: Mutex<SqlServerClient>,
}

impl SqlServerDriver {
    pub async fn connect(config: &crate::models::ConnectionConfig) -> Result<Self, AppError> {
        let host = config.host.as_deref().unwrap_or("localhost").trim();
        let username = config.username.as_deref().unwrap_or("sa").trim();
        if host.is_empty() {
            return Err(AppError::InvalidSqlServerConfig(
                "host cannot be blank".into(),
            ));
        }
        if username.is_empty() {
            return Err(AppError::InvalidSqlServerConfig(
                "username cannot be blank".into(),
            ));
        }

        let mut native = Config::new();
        native.host(host);
        native.port(config.port.unwrap_or(1433));
        native.database(if config.database.trim().is_empty() {
            "master"
        } else {
            config.database.trim()
        });
        native.application_name("QueryX");
        native.authentication(AuthMethod::sql_server(
            username,
            config.password.as_deref().unwrap_or(""),
        ));
        match config.ssl_mode {
            Some(crate::models::SslMode::Disable) => {
                native.encryption(EncryptionLevel::NotSupported)
            }
            _ => native.encryption(EncryptionLevel::Required),
        }
        if let Some(root_cert) = config
            .ssl_root_cert
            .as_deref()
            .filter(|path| !path.trim().is_empty())
        {
            native.trust_cert_ca(root_cert.trim());
        }

        let tcp = TcpStream::connect(native.get_addr())
            .await
            .map_err(|error| {
                AppError::SqlServer(format!("could not connect to {host}: {error}"))
            })?;
        tcp.set_nodelay(true).map_err(|error| {
            AppError::SqlServer(format!("could not configure TCP connection: {error}"))
        })?;
        let client = Client::connect(native, tcp.compat_write())
            .await
            .map_err(|error| AppError::SqlServer(error.to_string()))?;

        Ok(Self {
            database: config.database.trim().to_string(),
            read_only: config.read_only,
            client: Mutex::new(client),
        })
    }

    async fn execute_rows(
        &self,
        sql: &str,
        query_id: Uuid,
        stream: Option<QueryChunkHandler>,
    ) -> Result<QueryResult, AppError> {
        if self.read_only && !is_read_only_statement(sql) {
            return Err(AppError::ReadOnlyViolation);
        }
        let started = Instant::now();
        let mut client = self.client.lock().await;
        if !returns_rows(sql) {
            let affected_rows = client
                .execute(sql, &[])
                .await
                .map_err(|error| AppError::SqlServer(error.to_string()))?
                .total();
            return Ok(QueryResult {
                columns: Vec::new(),
                rows: Vec::new(),
                execution_time: started.elapsed().as_millis(),
                affected_rows,
                warnings: Vec::new(),
                error: None,
            });
        }

        let mut result_stream = client
            .simple_query(sql)
            .await
            .map_err(|error| AppError::SqlServer(error.to_string()))?;
        let mut columns = Vec::new();
        let mut rows = Vec::new();
        let mut chunk_rows = Vec::new();
        let mut row_offset = 0u64;
        while let Some(item) = result_stream
            .try_next()
            .await
            .map_err(|error| AppError::SqlServer(error.to_string()))?
        {
            match item {
                QueryItem::Metadata(metadata) if columns.is_empty() => {
                    columns = metadata
                        .columns()
                        .iter()
                        .map(|column| QueryColumn {
                            name: column.name().to_string(),
                            r#type: format!("{:?}", column.column_type()),
                            nullable: true,
                        })
                        .collect();
                }
                QueryItem::Row(row) => {
                    let mapped = row_to_json(&row);
                    if stream.is_some() {
                        chunk_rows.push(mapped);
                        if chunk_rows.len() >= 256 {
                            emit_chunk(&stream, query_id, row_offset, &columns, &mut chunk_rows);
                            row_offset += 256;
                        }
                    } else {
                        rows.push(mapped);
                    }
                }
                QueryItem::Metadata(_) => {}
            }
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

    async fn metadata_query(&self, sql: &str) -> Result<QueryResult, AppError> {
        self.execute_rows(sql, Uuid::new_v4(), None).await
    }
}

#[async_trait]
impl DatabaseDriver for SqlServerDriver {
    fn kind(&self) -> DriverKind {
        DriverKind::SqlServer
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
            DriverCapability::Streaming,
        ];
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
        self.execute_rows(sql, Uuid::new_v4(), None).await
    }

    async fn execute_stream(
        &self,
        query_id: Uuid,
        sql: &str,
        _mode: ExecutionMode,
        on_chunk: QueryChunkHandler,
    ) -> Result<QueryResult, AppError> {
        self.execute_rows(sql, query_id, Some(on_chunk)).await
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
        let mut client = self.client.lock().await;
        client
            .execute("BEGIN TRANSACTION", &[])
            .await
            .map_err(|error| AppError::SqlServer(error.to_string()))?;
        let mut affected_rows = 0;
        for statement in statements {
            match client.execute(statement, &[]).await {
                Ok(result) => affected_rows += result.total(),
                Err(error) => {
                    let _ = client.execute("ROLLBACK TRANSACTION", &[]).await;
                    return Err(AppError::SqlServer(error.to_string()));
                }
            }
        }
        if affected_rows != expected_rows {
            let _ = client.execute("ROLLBACK TRANSACTION", &[]).await;
            return Err(AppError::EditConflict {
                expected: expected_rows,
                actual: affected_rows,
            });
        }
        client
            .execute("COMMIT TRANSACTION", &[])
            .await
            .map_err(|error| AppError::SqlServer(error.to_string()))?;
        Ok(QueryResult {
            columns: Vec::new(),
            rows: Vec::new(),
            execution_time: 0,
            affected_rows,
            warnings: Vec::new(),
            error: None,
        })
    }

    async fn begin_transaction(&self) -> Result<(), AppError> {
        let mut client = self.client.lock().await;
        client
            .execute("BEGIN TRANSACTION", &[])
            .await
            .map(|_| ())
            .map_err(|error| AppError::SqlServer(error.to_string()))
    }

    async fn commit_transaction(&self) -> Result<(), AppError> {
        let mut client = self.client.lock().await;
        client
            .execute("COMMIT TRANSACTION", &[])
            .await
            .map(|_| ())
            .map_err(|error| AppError::SqlServer(error.to_string()))
    }

    async fn rollback_transaction(&self) -> Result<(), AppError> {
        let mut client = self.client.lock().await;
        client
            .execute("ROLLBACK TRANSACTION", &[])
            .await
            .map(|_| ())
            .map_err(|error| AppError::SqlServer(error.to_string()))
    }

    async fn cancel(&self, _query_id: Uuid) -> Result<bool, AppError> {
        Err(AppError::CancellationUnsupported("SQL Server".into()))
    }

    async fn metadata(&self) -> Result<DatabaseMetadata, AppError> {
        let databases = self
            .metadata_query("SELECT name FROM sys.databases ORDER BY name")
            .await?
            .rows
            .into_iter()
            .filter_map(|row| row.get("name").and_then(Value::as_str).map(String::from))
            .collect();
        let schemas = self
            .metadata_query("SELECT name FROM sys.schemas WHERE name NOT IN ('sys', 'INFORMATION_SCHEMA') ORDER BY name")
            .await?
            .rows
            .into_iter()
            .filter_map(|row| row.get("name").and_then(Value::as_str).map(String::from))
            .collect();
        let table_rows = self
            .metadata_query(
                "SELECT s.name AS schema_name, o.name AS table_name, COALESCE(SUM(p.rows), 0) AS row_count
                 FROM sys.tables o
                 JOIN sys.schemas s ON s.schema_id = o.schema_id
                 LEFT JOIN sys.partitions p ON p.object_id = o.object_id AND p.index_id IN (0, 1)
                 GROUP BY s.name, o.name ORDER BY s.name, o.name",
            )
            .await?
            .rows;
        let column_rows = self
            .metadata_query(
                "SELECT c.TABLE_SCHEMA AS schema_name, c.TABLE_NAME AS relation_name,
                        c.COLUMN_NAME AS column_name, c.DATA_TYPE AS data_type,
                        c.IS_NULLABLE AS is_nullable
                 FROM INFORMATION_SCHEMA.COLUMNS c
                 JOIN INFORMATION_SCHEMA.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA
                    AND t.TABLE_NAME = c.TABLE_NAME AND t.TABLE_TYPE = 'BASE TABLE'
                 ORDER BY c.ORDINAL_POSITION",
            )
            .await?
            .rows;
        let mut columns: BTreeMap<(String, String), Vec<ColumnMetadata>> = BTreeMap::new();
        for row in column_rows {
            let Some(schema) = string_value(&row, "schema_name") else {
                continue;
            };
            let Some(relation) = string_value(&row, "relation_name") else {
                continue;
            };
            columns
                .entry((schema, relation))
                .or_default()
                .push(ColumnMetadata {
                    name: string_value(&row, "column_name").unwrap_or_default(),
                    r#type: string_value(&row, "data_type").unwrap_or_else(|| "unknown".into()),
                    nullable: string_value(&row, "is_nullable").is_some_and(|value| value == "YES"),
                    primary_key: false,
                });
        }
        let tables = table_rows
            .into_iter()
            .filter_map(|row| {
                let schema = string_value(&row, "schema_name")?;
                let name = string_value(&row, "table_name")?;
                let row_count = row
                    .get("row_count")
                    .and_then(Value::as_u64)
                    .unwrap_or_default();
                let table_columns = columns
                    .remove(&(schema.clone(), name.clone()))
                    .unwrap_or_default();
                Some(TableMetadata {
                    schema,
                    name,
                    row_count,
                    columns: table_columns,
                    indexes: Vec::new(),
                    foreign_keys: Vec::<ForeignKeyMetadata>::new(),
                })
            })
            .collect();
        let view_rows = self
            .metadata_query(
                "SELECT v.TABLE_SCHEMA AS schema_name, v.TABLE_NAME AS relation_name,
                        c.COLUMN_NAME AS column_name, c.DATA_TYPE AS data_type,
                        c.IS_NULLABLE AS is_nullable, v.VIEW_DEFINITION AS definition
                 FROM INFORMATION_SCHEMA.VIEWS v
                 LEFT JOIN INFORMATION_SCHEMA.COLUMNS c ON c.TABLE_SCHEMA = v.TABLE_SCHEMA
                    AND c.TABLE_NAME = v.TABLE_NAME ORDER BY v.TABLE_SCHEMA, v.TABLE_NAME, c.ORDINAL_POSITION",
            )
            .await?
            .rows;
        let mut views: BTreeMap<(String, String), ViewMetadata> = BTreeMap::new();
        for row in view_rows {
            let Some(schema) = string_value(&row, "schema_name") else {
                continue;
            };
            let Some(name) = string_value(&row, "relation_name") else {
                continue;
            };
            let entry = views
                .entry((schema.clone(), name.clone()))
                .or_insert_with(|| ViewMetadata {
                    schema,
                    name,
                    columns: Vec::new(),
                    definition: string_value(&row, "definition"),
                });
            if let Some(column_name) = string_value(&row, "column_name") {
                entry.columns.push(ColumnMetadata {
                    name: column_name,
                    r#type: string_value(&row, "data_type").unwrap_or_else(|| "unknown".into()),
                    nullable: string_value(&row, "is_nullable").is_some_and(|value| value == "YES"),
                    primary_key: false,
                });
            }
        }
        Ok(DatabaseMetadata {
            databases,
            schemas,
            tables,
            views: views.into_values().collect(),
            routines: Vec::new(),
            triggers: Vec::new(),
            event_triggers: Vec::new(),
            dependencies: Vec::new(),
        })
    }

    async fn disconnect(&self) -> Result<(), AppError> {
        Ok(())
    }
}

fn emit_chunk(
    stream: &Option<QueryChunkHandler>,
    query_id: Uuid,
    row_offset: u64,
    columns: &[QueryColumn],
    rows: &mut Vec<HashMap<String, Value>>,
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

fn row_to_json(row: &Row) -> HashMap<String, Value> {
    row.cells()
        .map(|(column, value)| (column.name().to_string(), column_data_to_json(value)))
        .collect()
}

fn column_data_to_json(value: &ColumnData<'static>) -> Value {
    match value {
        ColumnData::U8(value) => json!(value),
        ColumnData::I16(value) => json!(value),
        ColumnData::I32(value) => json!(value),
        ColumnData::I64(value) => json!(value),
        ColumnData::F32(value) => json!(value),
        ColumnData::F64(value) => json!(value),
        ColumnData::Bit(value) => json!(value),
        ColumnData::String(value) => value
            .as_ref()
            .map_or(Value::Null, |value| json!(value.to_string())),
        ColumnData::Guid(value) => value.map_or(Value::Null, |value| json!(value.to_string())),
        ColumnData::Binary(value) => value.as_ref().map_or(Value::Null, |value| {
            json!(base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                value
            ))
        }),
        ColumnData::Numeric(value) => value
            .as_ref()
            .map_or(Value::Null, |value| json!(value.to_string())),
        ColumnData::Xml(value) => value
            .as_ref()
            .map_or(Value::Null, |value| json!(format!("{value:?}"))),
        value => json!(format!("{value:?}")),
    }
}

fn string_value(row: &HashMap<String, Value>, key: &str) -> Option<String> {
    row.get(key).and_then(|value| match value {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    })
}

fn returns_rows(sql: &str) -> bool {
    let keyword = sql
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    matches!(
        keyword.as_str(),
        "select" | "with" | "values" | "exec" | "execute"
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
        ]
        .iter()
        .any(|keyword| normalized.contains(keyword))
}

#[cfg(test)]
mod tests {
    use super::{is_read_only_statement, returns_rows};

    #[test]
    fn classifies_sql_server_result_statements() {
        assert!(returns_rows("  SELECT TOP 10 * FROM dbo.users"));
        assert!(returns_rows(
            "WITH recent AS (SELECT 1) SELECT * FROM recent"
        ));
        assert!(!returns_rows("UPDATE dbo.users SET active = 0"));
    }

    #[test]
    fn read_only_guard_rejects_mutating_cte_and_ddl() {
        assert!(is_read_only_statement("SELECT id FROM dbo.users"));
        assert!(!is_read_only_statement(
            "WITH changed AS (SELECT id FROM dbo.users) UPDATE dbo.users SET active = 0"
        ));
        assert!(!is_read_only_statement("CREATE TABLE dbo.audit (id int)"));
    }
}
