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
        ColumnMetadata, DatabaseLock, DatabaseMetadata, DatabaseObjectKind, DatabaseObjectRef,
        DatabaseSession, DatabaseSessionState, DependencyKind, DependencyMetadata,
        DriverCapability, DriverKind, ForeignKeyColumnPair, ForeignKeyMetadata, IndexMetadata,
        QueryChunk, QueryColumn, QueryResult, RelationRef, RoutineKind, RoutineMetadata,
        TableMetadata, TriggerEvent, TriggerMetadata, TriggerOrientation, TriggerRelationKind,
        TriggerRelationRef, TriggerStatus, TriggerTiming, ViewMetadata,
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
            DriverCapability::Sessions,
            DriverCapability::Locks,
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

    async fn sessions(&self) -> Result<Vec<DatabaseSession>, AppError> {
        let rows = self
            .metadata_query(
                r#"
                SELECT
                    CAST(s.session_id AS nvarchar(20)) AS id,
                    s.login_name AS user_name,
                    DB_NAME(CASE WHEN r.database_id IS NULL THEN s.database_id ELSE r.database_id END) AS database_name,
                    s.host_name AS client_address,
                    s.program_name AS application_name,
                    CASE
                        WHEN r.session_id IS NULL THEN s.status
                        WHEN r.wait_type IS NOT NULL THEN 'waiting'
                        ELSE r.status
                    END AS state,
                    query_text.text AS query_text,
                    CONVERT(nvarchar(33), r.start_time, 126) AS started_at,
                    CASE WHEN r.start_time IS NULL THEN NULL
                         ELSE DATEDIFF_BIG(millisecond, r.start_time, SYSDATETIME())
                    END AS duration_ms,
                    COALESCE(r.wait_type, r.wait_resource) AS wait_event
                FROM sys.dm_exec_sessions AS s
                LEFT JOIN sys.dm_exec_requests AS r
                  ON r.session_id = s.session_id
                OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) AS query_text
                WHERE s.is_user_process = 1
                ORDER BY r.start_time DESC, s.session_id
                "#,
            )
            .await?
            .rows;
        Ok(rows
            .into_iter()
            .filter_map(|row| {
                let id = string_value(&row, "id")?;
                Some(DatabaseSession {
                    id,
                    user: string_value(&row, "user_name"),
                    database: string_value(&row, "database_name"),
                    client_address: string_value(&row, "client_address"),
                    application_name: string_value(&row, "application_name"),
                    state: map_sql_server_session_state(string_value(&row, "state").as_deref()),
                    query: string_value(&row, "query_text"),
                    started_at: string_value(&row, "started_at"),
                    duration_ms: row.get("duration_ms").and_then(Value::as_i64),
                    wait_event: string_value(&row, "wait_event"),
                    can_cancel: false,
                })
            })
            .collect())
    }

    async fn locks(&self) -> Result<Vec<DatabaseLock>, AppError> {
        let rows = self
            .metadata_query(
                r#"
                SELECT
                    CAST(waiting.session_id AS nvarchar(20)) AS blocked_session_id,
                    CAST(waiting.blocking_session_id AS nvarchar(20)) AS blocking_session_id,
                    COALESCE(waiting.resource_description, 'unknown resource') AS resource,
                    waiting.wait_type AS lock_type,
                    CAST(NULL AS nvarchar(60)) AS blocked_mode,
                    CAST(NULL AS nvarchar(60)) AS blocking_mode,
                    waiting.wait_duration_ms AS blocked_duration_ms,
                    blocked_text.text AS blocked_query,
                    blocking_text.text AS blocking_query
                FROM sys.dm_os_waiting_tasks AS waiting
                OUTER APPLY (
                    SELECT TOP (1) request.sql_handle
                    FROM sys.dm_exec_requests AS request
                    WHERE request.session_id = waiting.session_id
                ) AS blocked_request
                OUTER APPLY sys.dm_exec_sql_text(blocked_request.sql_handle) AS blocked_text
                OUTER APPLY (
                    SELECT TOP (1) request.sql_handle
                    FROM sys.dm_exec_requests AS request
                    WHERE request.session_id = waiting.blocking_session_id
                ) AS blocking_request
                OUTER APPLY sys.dm_exec_sql_text(blocking_request.sql_handle) AS blocking_text
                WHERE waiting.blocking_session_id > 0
                ORDER BY waiting.wait_duration_ms DESC,
                         waiting.session_id, waiting.blocking_session_id
                "#,
            )
            .await?
            .rows;
        Ok(rows
            .into_iter()
            .filter_map(|row| {
                let blocked_session_id = string_value(&row, "blocked_session_id")?;
                let blocking_session_id = string_value(&row, "blocking_session_id")?;
                let resource =
                    string_value(&row, "resource").unwrap_or_else(|| "unknown resource".into());
                let lock_type = string_value(&row, "lock_type").unwrap_or_else(|| "wait".into());
                let blocked_mode = string_value(&row, "blocked_mode");
                let blocking_mode = string_value(&row, "blocking_mode");
                Some(DatabaseLock {
                    id: sql_server_lock_identity(
                        &blocked_session_id,
                        &blocking_session_id,
                        &lock_type,
                        &resource,
                        blocked_mode.as_deref(),
                        blocking_mode.as_deref(),
                    ),
                    blocked_session_id,
                    blocking_session_id,
                    resource,
                    lock_type,
                    blocked_mode,
                    blocking_mode,
                    blocked_duration_ms: row.get("blocked_duration_ms").and_then(Value::as_i64),
                    blocked_query: string_value(&row, "blocked_query"),
                    blocking_query: string_value(&row, "blocking_query"),
                    blocking_can_cancel: false,
                })
            })
            .collect())
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
                "SELECT s.name AS schema_name, t.name AS relation_name,
                        c.name AS column_name, ty.name AS data_type,
                        c.is_nullable, CASE WHEN pkc.column_id IS NULL THEN 0 ELSE 1 END AS is_primary_key,
                        c.column_id
                 FROM sys.tables t
                 JOIN sys.schemas s ON s.schema_id = t.schema_id
                 JOIN sys.columns c ON c.object_id = t.object_id
                 JOIN sys.types ty ON ty.user_type_id = c.user_type_id
                 LEFT JOIN sys.indexes pk ON pk.object_id = t.object_id AND pk.is_primary_key = 1
                 LEFT JOIN sys.index_columns pkc ON pkc.object_id = t.object_id
                    AND pkc.index_id = pk.index_id AND pkc.column_id = c.column_id
                 ORDER BY s.name, t.name, c.column_id",
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
                    nullable: bool_value(&row, "is_nullable").unwrap_or_default(),
                    primary_key: bool_value(&row, "is_primary_key").unwrap_or_default(),
                });
        }
        let index_rows = self
            .metadata_query(
                "SELECT s.name AS schema_name, t.name AS table_name, i.name AS index_name,
                        i.is_unique, i.is_primary_key, i.type_desc, ic.key_ordinal,
                        c.name AS column_name
                 FROM sys.indexes i
                 JOIN sys.tables t ON t.object_id = i.object_id
                 JOIN sys.schemas s ON s.schema_id = t.schema_id
                 JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
                 JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                 WHERE i.name IS NOT NULL AND ic.key_ordinal > 0
                 ORDER BY s.name, t.name, i.index_id, ic.key_ordinal",
            )
            .await?
            .rows;
        let mut indexes: BTreeMap<(String, String, String), IndexMetadata> = BTreeMap::new();
        for row in index_rows {
            let (Some(schema), Some(table), Some(name)) = (
                string_value(&row, "schema_name"),
                string_value(&row, "table_name"),
                string_value(&row, "index_name"),
            ) else {
                continue;
            };
            let entry = indexes
                .entry((schema, table, name.clone()))
                .or_insert_with(|| IndexMetadata {
                    name,
                    columns: Vec::new(),
                    unique: bool_value(&row, "is_unique").unwrap_or_default(),
                    primary: bool_value(&row, "is_primary_key").unwrap_or_default(),
                    r#type: string_value(&row, "type_desc").unwrap_or_else(|| "UNKNOWN".into()),
                    definition: None,
                });
            if let Some(column) = string_value(&row, "column_name") {
                entry.columns.push(column);
            }
        }
        let foreign_key_rows = self
            .metadata_query(
                "SELECT fk.object_id AS foreign_key_id, fk.name AS foreign_key_name,
                        source_schema.name AS schema_name, source_table.name AS table_name,
                        source_column.name AS source_column, reference_schema.name AS referenced_schema,
                        reference_table.name AS referenced_table, reference_column.name AS referenced_column,
                        fkc.constraint_column_id AS ordinal,
                        fk.update_referential_action_desc AS on_update,
                        fk.delete_referential_action_desc AS on_delete
                 FROM sys.foreign_keys fk
                 JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
                 JOIN sys.tables source_table ON source_table.object_id = fk.parent_object_id
                 JOIN sys.schemas source_schema ON source_schema.schema_id = source_table.schema_id
                 JOIN sys.columns source_column ON source_column.object_id = fkc.parent_object_id
                    AND source_column.column_id = fkc.parent_column_id
                 JOIN sys.tables reference_table ON reference_table.object_id = fk.referenced_object_id
                 JOIN sys.schemas reference_schema ON reference_schema.schema_id = reference_table.schema_id
                 JOIN sys.columns reference_column ON reference_column.object_id = fkc.referenced_object_id
                    AND reference_column.column_id = fkc.referenced_column_id
                 ORDER BY source_schema.name, source_table.name, fk.object_id, fkc.constraint_column_id",
            )
            .await?
            .rows;
        let mut foreign_keys: BTreeMap<(String, String, String), ForeignKeyMetadata> =
            BTreeMap::new();
        for row in foreign_key_rows {
            let (
                Some(schema),
                Some(table),
                Some(foreign_key_id),
                Some(referenced_schema),
                Some(referenced_table),
            ) = (
                string_value(&row, "schema_name"),
                string_value(&row, "table_name"),
                string_value(&row, "foreign_key_id"),
                string_value(&row, "referenced_schema"),
                string_value(&row, "referenced_table"),
            )
            else {
                continue;
            };
            let entry = foreign_keys
                .entry((schema, table, foreign_key_id.clone()))
                .or_insert_with(|| ForeignKeyMetadata {
                    id: format!("sqlserver:foreign-key:{foreign_key_id}"),
                    name: string_value(&row, "foreign_key_name"),
                    columns: Vec::new(),
                    referenced_relation: RelationRef {
                        schema: referenced_schema,
                        name: referenced_table,
                    },
                    on_update: string_value(&row, "on_update")
                        .unwrap_or_else(|| "NO_ACTION".into()),
                    on_delete: string_value(&row, "on_delete")
                        .unwrap_or_else(|| "NO_ACTION".into()),
                    r#match: None,
                    deferrable: Some(false),
                    initially_deferred: Some(false),
                });
            if let (Some(source_column), Some(referenced_column)) = (
                string_value(&row, "source_column"),
                string_value(&row, "referenced_column"),
            ) {
                entry.columns.push(ForeignKeyColumnPair {
                    ordinal: row
                        .get("ordinal")
                        .and_then(Value::as_u64)
                        .unwrap_or(entry.columns.len() as u64 + 1)
                        as u32,
                    source_column,
                    referenced_column: Some(referenced_column),
                });
            }
        }
        let tables: Vec<TableMetadata> = table_rows
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
                let table_indexes = indexes
                    .iter()
                    .filter(|((index_schema, index_table, _), _)| {
                        index_schema == &schema && index_table == &name
                    })
                    .map(|(_, index)| index.clone())
                    .collect();
                let table_foreign_keys = foreign_keys
                    .iter()
                    .filter(|((fk_schema, fk_table, _), _)| {
                        fk_schema == &schema && fk_table == &name
                    })
                    .map(|(_, foreign_key)| foreign_key.clone())
                    .collect();
                Some(TableMetadata {
                    schema,
                    name,
                    row_count,
                    columns: table_columns,
                    indexes: table_indexes,
                    foreign_keys: table_foreign_keys,
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
        let routine_rows = self
            .metadata_query(
                "SELECT s.name AS schema_name, o.object_id AS routine_id, o.name AS routine_name,
                        o.type AS routine_type, m.definition, p.parameter_id,
                        p.name AS parameter_name, TYPE_NAME(p.user_type_id) AS parameter_type,
                        p.is_output, CASE WHEN p.parameter_id = 0 THEN TYPE_NAME(p.user_type_id)
                                          ELSE NULL END AS return_type
                 FROM sys.objects o
                 JOIN sys.schemas s ON s.schema_id = o.schema_id
                 LEFT JOIN sys.sql_modules m ON m.object_id = o.object_id
                 LEFT JOIN sys.parameters p ON p.object_id = o.object_id
                 WHERE o.type IN ('P', 'FN', 'IF', 'TF', 'FS', 'FT')
                 ORDER BY s.name, o.name, o.object_id, p.parameter_id",
            )
            .await?
            .rows;
        let mut routine_map: BTreeMap<String, RoutineMetadata> = BTreeMap::new();
        for row in routine_rows {
            let (Some(schema), Some(raw_id), Some(name)) = (
                string_value(&row, "schema_name"),
                string_value(&row, "routine_id"),
                string_value(&row, "routine_name"),
            ) else {
                continue;
            };
            let id = format!("sqlserver:routine:{schema}:{raw_id}");
            let routine_type = string_value(&row, "routine_type").unwrap_or_default();
            let entry = routine_map
                .entry(id.clone())
                .or_insert_with(|| RoutineMetadata {
                    id,
                    schema,
                    name,
                    kind: sql_server_routine_kind(&routine_type),
                    identity_arguments: String::new(),
                    return_type: None,
                    language: "T-SQL".into(),
                    definition: string_value(&row, "definition"),
                    aggregate: None,
                });
            let parameter_id = u64_value(&row, "parameter_id");
            if parameter_id == 0 {
                entry.return_type = string_value(&row, "return_type");
                continue;
            }
            let parameter_type =
                string_value(&row, "parameter_type").unwrap_or_else(|| "sql_variant".into());
            let parameter_name = string_value(&row, "parameter_name")
                .unwrap_or_else(|| format!("@arg{parameter_id}"));
            let mut argument = format!("{parameter_name} {parameter_type}");
            if bool_value(&row, "is_output").unwrap_or_default() {
                argument.push_str(" OUTPUT");
            }
            if !entry.identity_arguments.is_empty() {
                entry.identity_arguments.push_str(", ");
            }
            entry.identity_arguments.push_str(&argument);
        }
        let routines = routine_map.into_values().collect::<Vec<_>>();
        let trigger_rows = self
            .metadata_query(
                "SELECT s.name AS schema_name, tr.object_id AS trigger_id, tr.name AS trigger_name,
                        parent.name AS relation_name, parent.type AS relation_type,
                        tr.is_disabled, tr.is_instead_of_trigger, m.definition,
                        te.type_desc AS event_type
                 FROM sys.triggers tr
                 JOIN sys.objects parent ON parent.object_id = tr.parent_id
                 JOIN sys.schemas s ON s.schema_id = parent.schema_id
                 LEFT JOIN sys.sql_modules m ON m.object_id = tr.object_id
                 LEFT JOIN sys.trigger_events te ON te.object_id = tr.object_id
                 WHERE tr.parent_class = 1 AND parent.type IN ('U', 'V')
                 ORDER BY s.name, parent.name, tr.name, te.type_desc",
            )
            .await?
            .rows;
        let mut trigger_map: BTreeMap<String, TriggerMetadata> = BTreeMap::new();
        for row in trigger_rows {
            let (Some(schema), Some(raw_id), Some(name), Some(relation_name)) = (
                string_value(&row, "schema_name"),
                string_value(&row, "trigger_id"),
                string_value(&row, "trigger_name"),
                string_value(&row, "relation_name"),
            ) else {
                continue;
            };
            let id = format!("sqlserver:trigger:{schema}:{raw_id}");
            let relation_kind = if string_value(&row, "relation_type").as_deref() == Some("V") {
                TriggerRelationKind::View
            } else {
                TriggerRelationKind::Table
            };
            let entry = trigger_map
                .entry(id.clone())
                .or_insert_with(|| TriggerMetadata {
                    id,
                    schema: schema.clone(),
                    name,
                    relation: TriggerRelationRef {
                        schema: schema.clone(),
                        name: relation_name,
                        kind: relation_kind,
                    },
                    timing: if bool_value(&row, "is_instead_of_trigger").unwrap_or_default() {
                        TriggerTiming::InsteadOf
                    } else {
                        TriggerTiming::After
                    },
                    events: Vec::new(),
                    update_columns: None,
                    orientation: TriggerOrientation::Statement,
                    status: if bool_value(&row, "is_disabled").unwrap_or_default() {
                        TriggerStatus::Disabled
                    } else {
                        TriggerStatus::Enabled
                    },
                    condition: None,
                    definition: string_value(&row, "definition"),
                });
            let event = string_value(&row, "event_type")
                .as_deref()
                .and_then(map_sql_server_trigger_event);
            if let Some(event) = event {
                if !entry.events.contains(&event) {
                    entry.events.push(event);
                }
            }
        }
        let triggers = trigger_map.into_values().collect::<Vec<_>>();
        let mut dependencies = Vec::new();
        for table in &tables {
            for foreign_key in &table.foreign_keys {
                dependencies.push(DependencyMetadata {
                    id: format!("sqlserver:dependency:foreign-key:{}", foreign_key.id),
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
                id: format!("sqlserver:dependency:trigger-owner:{}", trigger.id),
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
        dependencies.sort_by(|left, right| left.id.cmp(&right.id));
        Ok(DatabaseMetadata {
            databases,
            schemas,
            tables,
            views: views.into_values().collect(),
            routines,
            triggers,
            event_triggers: Vec::new(),
            dependencies,
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

fn relation_object_ref(kind: DatabaseObjectKind, schema: &str, name: &str) -> DatabaseObjectRef {
    DatabaseObjectRef {
        kind,
        id: None,
        schema: Some(schema.to_string()),
        name: name.to_string(),
        identity_arguments: None,
    }
}

fn bool_value(row: &HashMap<String, Value>, key: &str) -> Option<bool> {
    row.get(key).and_then(|value| match value {
        Value::Bool(value) => Some(*value),
        Value::String(value) => match value.to_ascii_lowercase().as_str() {
            "1" | "true" | "yes" => Some(true),
            "0" | "false" | "no" => Some(false),
            _ => None,
        },
        Value::Number(value) => value.as_i64().map(|number| number != 0),
        _ => None,
    })
}

fn u64_value(row: &HashMap<String, Value>, key: &str) -> u64 {
    row.get(key)
        .and_then(|value| {
            value
                .as_u64()
                .or_else(|| value.as_i64().and_then(|number| u64::try_from(number).ok()))
                .or_else(|| value.as_str().and_then(|text| text.parse().ok()))
        })
        .unwrap_or_default()
}

fn map_sql_server_session_state(state: Option<&str>) -> DatabaseSessionState {
    match state.unwrap_or_default().to_ascii_lowercase().as_str() {
        "running" | "runnable" => DatabaseSessionState::Active,
        "waiting" | "suspended" => DatabaseSessionState::Waiting,
        "sleeping" | "dormant" => DatabaseSessionState::Idle,
        _ => DatabaseSessionState::Unknown,
    }
}

fn sql_server_lock_identity(
    blocked_session_id: &str,
    blocking_session_id: &str,
    lock_type: &str,
    resource: &str,
    blocked_mode: Option<&str>,
    blocking_mode: Option<&str>,
) -> String {
    format!(
        "{blocked_session_id}:{blocking_session_id}:{lock_type}:{resource}:{}:{}",
        blocked_mode.unwrap_or_default(),
        blocking_mode.unwrap_or_default()
    )
}

fn sql_server_routine_kind(routine_type: &str) -> RoutineKind {
    match routine_type {
        "P" => RoutineKind::Procedure,
        _ => RoutineKind::Function,
    }
}

fn map_sql_server_trigger_event(event: &str) -> Option<TriggerEvent> {
    match event.to_ascii_uppercase().as_str() {
        "INSERT" => Some(TriggerEvent::Insert),
        "UPDATE" => Some(TriggerEvent::Update),
        "DELETE" => Some(TriggerEvent::Delete),
        "TRUNCATE" => Some(TriggerEvent::Truncate),
        _ => None,
    }
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
    use super::{
        bool_value, is_read_only_statement, map_sql_server_session_state,
        map_sql_server_trigger_event, returns_rows, sql_server_lock_identity,
        sql_server_routine_kind,
    };
    use crate::models::{DatabaseSessionState, RoutineKind, TriggerEvent};
    use serde_json::json;
    use std::collections::HashMap;

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

    #[test]
    fn maps_sql_server_activity_states() {
        assert_eq!(
            map_sql_server_session_state(Some("running")),
            DatabaseSessionState::Active
        );
        assert_eq!(
            map_sql_server_session_state(Some("suspended")),
            DatabaseSessionState::Waiting
        );
        assert_eq!(
            map_sql_server_session_state(Some("sleeping")),
            DatabaseSessionState::Idle
        );
        assert_eq!(
            map_sql_server_session_state(Some("new-state")),
            DatabaseSessionState::Unknown
        );
    }

    #[test]
    fn creates_stable_sql_server_lock_identity() {
        assert_eq!(
            sql_server_lock_identity("51", "52", "LCK_M_X", "key:7", None, Some("X")),
            "51:52:LCK_M_X:key:7::X"
        );
    }

    #[test]
    fn normalizes_sql_server_catalog_booleans() {
        let row = HashMap::from([
            ("native_true".into(), json!(true)),
            ("numeric_false".into(), json!(0)),
            ("text_true".into(), json!("YES")),
        ]);
        assert_eq!(bool_value(&row, "native_true"), Some(true));
        assert_eq!(bool_value(&row, "numeric_false"), Some(false));
        assert_eq!(bool_value(&row, "text_true"), Some(true));
    }

    #[test]
    fn maps_sql_server_object_kinds() {
        assert_eq!(sql_server_routine_kind("P"), RoutineKind::Procedure);
        assert_eq!(sql_server_routine_kind("FN"), RoutineKind::Function);
        assert_eq!(
            map_sql_server_trigger_event("INSERT"),
            Some(TriggerEvent::Insert)
        );
        assert_eq!(
            map_sql_server_trigger_event("UPDATE"),
            Some(TriggerEvent::Update)
        );
        assert_eq!(map_sql_server_trigger_event("ALTER_TABLE"), None);
    }
}
