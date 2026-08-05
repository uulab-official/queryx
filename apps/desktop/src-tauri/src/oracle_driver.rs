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
        ColumnMetadata, DatabaseMetadata, DatabaseObjectKind, DatabaseObjectRef, DependencyKind,
        DependencyMetadata, DriverCapability, DriverKind, ForeignKeyColumnPair, ForeignKeyMetadata,
        IndexMetadata, QueryChunk, QueryColumn, QueryResult, RelationRef, RoutineKind,
        RoutineMetadata, TableMetadata, TriggerEvent, TriggerMetadata, TriggerOrientation,
        TriggerRelationKind, TriggerRelationRef, TriggerStatus, TriggerTiming, ViewMetadata,
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
                        data_type, nullable, column_id,
                        CASE WHEN EXISTS (
                            SELECT 1 FROM all_cons_columns pkc
                            JOIN all_constraints pk ON pk.owner = pkc.owner
                              AND pk.constraint_name = pkc.constraint_name
                              AND pk.constraint_type = 'P'
                            WHERE pkc.owner = c.owner AND pkc.table_name = c.table_name
                              AND pkc.column_name = c.column_name
                        ) THEN 'Y' ELSE 'N' END AS is_primary_key
                 FROM all_tab_columns c ORDER BY owner, table_name, column_id",
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
                    primary_key: row_string(row, "is_primary_key")
                        .is_some_and(|value| value == "Y"),
                });
        }
        let index_rows = self
            .metadata_query(
                "SELECT i.table_owner AS schema_name, i.table_name, i.index_name,
                        i.uniqueness, i.index_type, ic.column_position,
                        COALESCE(ic.column_name, ie.column_expression) AS column_name,
                        CASE WHEN EXISTS (
                            SELECT 1 FROM all_constraints pc
                            WHERE pc.owner = i.table_owner AND pc.table_name = i.table_name
                              AND pc.constraint_type = 'P' AND pc.index_name = i.index_name
                        ) THEN 'Y' ELSE 'N' END AS is_primary
                 FROM all_indexes i
                 JOIN all_ind_columns ic ON ic.index_owner = i.owner
                    AND ic.index_name = i.index_name AND ic.table_owner = i.table_owner
                    AND ic.table_name = i.table_name
                 LEFT JOIN all_ind_expressions ie ON ie.index_owner = ic.index_owner
                    AND ie.index_name = ic.index_name AND ie.table_owner = ic.table_owner
                    AND ie.table_name = ic.table_name AND ie.column_position = ic.column_position
                 ORDER BY i.table_owner, i.table_name, i.index_name, ic.column_position",
            )
            .await?
            .rows;
        let mut indexes: BTreeMap<(String, String, String), IndexMetadata> = BTreeMap::new();
        for row in &index_rows {
            let (Some(schema), Some(table), Some(name)) = (
                row_string(row, "schema_name"),
                row_string(row, "table_name"),
                row_string(row, "index_name"),
            ) else {
                continue;
            };
            let entry = indexes
                .entry((schema, table, name.clone()))
                .or_insert_with(|| IndexMetadata {
                    name,
                    columns: Vec::new(),
                    unique: row_string(row, "uniqueness").is_some_and(|value| value == "UNIQUE"),
                    primary: row_string(row, "is_primary").is_some_and(|value| value == "Y"),
                    r#type: row_string(row, "index_type").unwrap_or_else(|| "UNKNOWN".into()),
                    definition: None,
                });
            if let Some(column) = row_string(row, "column_name") {
                entry.columns.push(column);
            }
        }
        let foreign_key_rows = self
            .metadata_query(
                "SELECT c.owner AS schema_name, c.table_name, c.constraint_name,
                        cc.position AS ordinal, cc.column_name AS source_column,
                        rc.owner AS referenced_schema, rc.table_name AS referenced_table,
                        rcc.column_name AS referenced_column, c.delete_rule,
                        c.deferrable, c.deferred
                 FROM all_constraints c
                 JOIN all_cons_columns cc ON cc.owner = c.owner
                    AND cc.constraint_name = c.constraint_name AND cc.table_name = c.table_name
                 JOIN all_constraints rc ON rc.owner = c.r_owner
                    AND rc.constraint_name = c.r_constraint_name
                    AND rc.constraint_type IN ('P', 'U')
                 JOIN all_cons_columns rcc ON rcc.owner = rc.owner
                    AND rcc.constraint_name = rc.constraint_name AND rcc.table_name = rc.table_name
                    AND rcc.position = cc.position
                 WHERE c.constraint_type = 'R'
                 ORDER BY c.owner, c.table_name, c.constraint_name, cc.position",
            )
            .await?
            .rows;
        let mut foreign_keys: BTreeMap<(String, String, String), ForeignKeyMetadata> =
            BTreeMap::new();
        for row in &foreign_key_rows {
            let (
                Some(schema),
                Some(table),
                Some(constraint_name),
                Some(referenced_schema),
                Some(referenced_table),
            ) = (
                row_string(row, "schema_name"),
                row_string(row, "table_name"),
                row_string(row, "constraint_name"),
                row_string(row, "referenced_schema"),
                row_string(row, "referenced_table"),
            )
            else {
                continue;
            };
            let foreign_key_id = format!("oracle:foreign-key:{schema}:{constraint_name}");
            let entry = foreign_keys
                .entry((schema, table, constraint_name.clone()))
                .or_insert_with(|| ForeignKeyMetadata {
                    id: foreign_key_id,
                    name: Some(constraint_name),
                    columns: Vec::new(),
                    referenced_relation: RelationRef {
                        schema: referenced_schema,
                        name: referenced_table,
                    },
                    on_update: "NO ACTION".into(),
                    on_delete: row_string(row, "delete_rule").unwrap_or_else(|| "NO ACTION".into()),
                    r#match: None,
                    deferrable: row_string(row, "deferrable").map(|value| value == "DEFERRABLE"),
                    initially_deferred: row_string(row, "deferred")
                        .map(|value| value == "DEFERRED"),
                });
            if let (Some(source_column), Some(referenced_column)) = (
                row_string(row, "source_column"),
                row_string(row, "referenced_column"),
            ) {
                entry.columns.push(ForeignKeyColumnPair {
                    ordinal: row_u64(row, "ordinal") as u32,
                    source_column,
                    referenced_column: Some(referenced_column),
                });
            }
        }
        let tables: Vec<TableMetadata> = table_rows
            .rows
            .iter()
            .filter_map(|row| {
                let schema = row_string(row, "schema_name")?;
                let name = row_string(row, "table_name")?;
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
                    schema: schema.clone(),
                    name: name.clone(),
                    row_count: row_u64(row, "row_count"),
                    columns: columns.remove(&(schema, name)).unwrap_or_default(),
                    indexes: table_indexes,
                    foreign_keys: table_foreign_keys,
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
        let routine_rows = self
            .metadata_query(
                "SELECT owner AS schema_name, object_name, procedure_name,
                        object_id, subprogram_id, object_type, overload
                 FROM all_procedures
                 WHERE object_type IN ('FUNCTION', 'PROCEDURE', 'PACKAGE')
                   AND (procedure_name IS NOT NULL OR object_type IN ('FUNCTION', 'PROCEDURE'))
                 ORDER BY owner, object_name, procedure_name, subprogram_id",
            )
            .await?
            .rows;
        let argument_rows = self
            .metadata_query(
                "SELECT owner AS schema_name, object_name, package_name, subprogram_id,
                        argument_name, position, sequence, data_type, in_out, type_name
                 FROM all_arguments
                 WHERE data_level = 0
                 ORDER BY owner, object_name, package_name, subprogram_id, sequence",
            )
            .await?
            .rows;
        let mut routine_map: BTreeMap<String, RoutineMetadata> = BTreeMap::new();
        let mut routine_by_argument_key: BTreeMap<(String, String, u64), String> = BTreeMap::new();
        for row in &routine_rows {
            let (Some(schema), Some(object_name)) = (
                row_string(row, "schema_name"),
                row_string(row, "object_name"),
            ) else {
                continue;
            };
            let object_id = row_u64(row, "object_id");
            let subprogram_id = row_u64(row, "subprogram_id");
            let procedure_name = row_string(row, "procedure_name");
            let name = procedure_name
                .as_ref()
                .map(|procedure| format!("{object_name}.{procedure}"))
                .unwrap_or_else(|| object_name.clone());
            let id = format!("oracle:routine:{schema}:{object_id}:{subprogram_id}");
            let object_type = row_string(row, "object_type").unwrap_or_default();
            routine_map
                .entry(id.clone())
                .or_insert_with(|| RoutineMetadata {
                    id: id.clone(),
                    schema: schema.clone(),
                    name,
                    kind: oracle_routine_kind(&object_type),
                    identity_arguments: String::new(),
                    return_type: None,
                    language: "PL/SQL".into(),
                    definition: None,
                    aggregate: None,
                });
            routine_by_argument_key.insert((schema, object_name, subprogram_id), id);
        }
        for row in &argument_rows {
            let (Some(schema), Some(object_name)) = (
                row_string(row, "schema_name"),
                row_string(row, "object_name"),
            ) else {
                continue;
            };
            let key = (schema, object_name, row_u64(row, "subprogram_id"));
            let Some(routine_id) = routine_by_argument_key.get(&key) else {
                continue;
            };
            let Some(routine) = routine_map.get_mut(routine_id) else {
                continue;
            };
            let data_type = row_string(row, "data_type")
                .or_else(|| row_string(row, "type_name"))
                .unwrap_or_else(|| "UNKNOWN".into());
            let position = row_u64(row, "position");
            if position == 0 {
                routine.kind = RoutineKind::Function;
                routine.return_type = Some(data_type);
                continue;
            }
            let argument_name =
                row_string(row, "argument_name").unwrap_or_else(|| format!("arg{position}"));
            let direction = row_string(row, "in_out").unwrap_or_else(|| "IN".into());
            let argument = format!("{argument_name} {direction} {data_type}");
            if !routine.identity_arguments.is_empty() {
                routine.identity_arguments.push_str(", ");
            }
            routine.identity_arguments.push_str(&argument);
        }
        let routines = routine_map.into_values().collect::<Vec<_>>();
        let trigger_rows = self
            .metadata_query(
                "SELECT owner AS schema_name, trigger_name, table_owner, table_name,
                        base_object_type, trigger_type, triggering_event, when_clause,
                        status, description, trigger_body
                 FROM all_triggers
                 WHERE base_object_type IN ('TABLE', 'VIEW')
                 ORDER BY owner, trigger_name",
            )
            .await?
            .rows;
        let mut trigger_map: BTreeMap<String, TriggerMetadata> = BTreeMap::new();
        for row in &trigger_rows {
            let (Some(schema), Some(name), Some(relation_name)) = (
                row_string(row, "schema_name"),
                row_string(row, "trigger_name"),
                row_string(row, "table_name"),
            ) else {
                continue;
            };
            let id = format!("oracle:trigger:{schema}:{name}");
            let relation_schema = row_string(row, "table_owner").unwrap_or_else(|| schema.clone());
            let relation_kind = if row_string(row, "base_object_type").as_deref() == Some("VIEW") {
                TriggerRelationKind::View
            } else {
                TriggerRelationKind::Table
            };
            let trigger_type = row_string(row, "trigger_type").unwrap_or_default();
            let entry = trigger_map
                .entry(id.clone())
                .or_insert_with(|| TriggerMetadata {
                    id,
                    schema: schema.clone(),
                    name,
                    relation: TriggerRelationRef {
                        schema: relation_schema,
                        name: relation_name,
                        kind: relation_kind,
                    },
                    timing: oracle_trigger_timing(&trigger_type),
                    events: Vec::new(),
                    update_columns: None,
                    orientation: oracle_trigger_orientation(&trigger_type),
                    status: oracle_trigger_status(row_string(row, "status").as_deref()),
                    condition: row_string(row, "when_clause"),
                    definition: oracle_trigger_definition(row),
                });
            for event in oracle_trigger_events(
                row_string(row, "triggering_event")
                    .as_deref()
                    .unwrap_or_default(),
            ) {
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
                    id: format!("oracle:dependency:foreign-key:{}", foreign_key.id),
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
                id: format!("oracle:dependency:trigger-owner:{}", trigger.id),
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
            views,
            routines,
            triggers,
            event_triggers: Vec::new(),
            dependencies,
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

fn relation_object_ref(kind: DatabaseObjectKind, schema: &str, name: &str) -> DatabaseObjectRef {
    DatabaseObjectRef {
        kind,
        id: None,
        schema: Some(schema.to_string()),
        name: name.to_string(),
        identity_arguments: None,
    }
}

fn oracle_routine_kind(object_type: &str) -> RoutineKind {
    if object_type.eq_ignore_ascii_case("FUNCTION") {
        RoutineKind::Function
    } else {
        RoutineKind::Procedure
    }
}

fn oracle_trigger_timing(trigger_type: &str) -> TriggerTiming {
    let normalized = trigger_type.to_ascii_uppercase();
    if normalized.contains("INSTEAD OF") {
        TriggerTiming::InsteadOf
    } else if normalized.contains("BEFORE") {
        TriggerTiming::Before
    } else if normalized.contains("AFTER") {
        TriggerTiming::After
    } else {
        TriggerTiming::Unknown
    }
}

fn oracle_trigger_orientation(trigger_type: &str) -> TriggerOrientation {
    if trigger_type.to_ascii_uppercase().contains("EACH ROW") {
        TriggerOrientation::Row
    } else {
        TriggerOrientation::Statement
    }
}

fn oracle_trigger_events(triggering_event: &str) -> Vec<TriggerEvent> {
    let normalized = triggering_event.to_ascii_uppercase();
    [
        ("INSERT", TriggerEvent::Insert),
        ("UPDATE", TriggerEvent::Update),
        ("DELETE", TriggerEvent::Delete),
        ("TRUNCATE", TriggerEvent::Truncate),
    ]
    .into_iter()
    .filter_map(|(name, event)| normalized.contains(name).then_some(event))
    .collect()
}

fn oracle_trigger_status(status: Option<&str>) -> TriggerStatus {
    if status.is_some_and(|value| value.eq_ignore_ascii_case("DISABLED")) {
        TriggerStatus::Disabled
    } else {
        TriggerStatus::Enabled
    }
}

fn oracle_trigger_definition(row: &oracle_rs::Row) -> Option<String> {
    match (
        row_string(row, "description"),
        row_string(row, "trigger_body"),
    ) {
        (Some(description), Some(body)) => Some(format!("{description}\n{body}")),
        (Some(description), None) => Some(description),
        (None, Some(body)) => Some(body),
        (None, None) => None,
    }
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
    use super::{
        is_read_only_statement, oracle_routine_kind, oracle_trigger_events,
        oracle_trigger_orientation, oracle_trigger_status, oracle_trigger_timing, returns_rows,
    };
    use crate::models::{
        RoutineKind, TriggerEvent, TriggerOrientation, TriggerStatus, TriggerTiming,
    };

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

    #[test]
    fn maps_oracle_routine_catalog_kinds() {
        assert_eq!(oracle_routine_kind("FUNCTION"), RoutineKind::Function);
        assert_eq!(oracle_routine_kind("procedure"), RoutineKind::Procedure);
        assert_eq!(oracle_routine_kind("PACKAGE"), RoutineKind::Procedure);
    }

    #[test]
    fn maps_oracle_trigger_catalog_fields() {
        assert_eq!(
            oracle_trigger_timing("BEFORE EACH ROW"),
            TriggerTiming::Before
        );
        assert_eq!(
            oracle_trigger_timing("INSTEAD OF"),
            TriggerTiming::InsteadOf
        );
        assert_eq!(
            oracle_trigger_orientation("AFTER EACH ROW"),
            TriggerOrientation::Row
        );
        assert_eq!(
            oracle_trigger_orientation("AFTER STATEMENT"),
            TriggerOrientation::Statement
        );
        assert_eq!(
            oracle_trigger_events("INSERT OR UPDATE OR DELETE"),
            [
                TriggerEvent::Insert,
                TriggerEvent::Update,
                TriggerEvent::Delete
            ]
        );
        assert_eq!(
            oracle_trigger_status(Some("DISABLED")),
            TriggerStatus::Disabled
        );
        assert_eq!(
            oracle_trigger_status(Some("ENABLED")),
            TriggerStatus::Enabled
        );
    }

    #[tokio::test]
    async fn oracle_contract_when_test_database_is_available() {
        let Some(service) = std::env::var_os("QUERYX_TEST_ORACLE_SERVICE") else {
            return;
        };
        let config = crate::models::ConnectionConfig {
            kind: crate::models::DriverKind::Oracle,
            name: "oracle-contract".into(),
            database: service.to_string_lossy().into_owned(),
            read_only: true,
            host: std::env::var("QUERYX_TEST_ORACLE_HOST").ok(),
            port: std::env::var("QUERYX_TEST_ORACLE_PORT")
                .ok()
                .and_then(|value| value.parse().ok()),
            username: std::env::var("QUERYX_TEST_ORACLE_USER").ok(),
            password: std::env::var("QUERYX_TEST_ORACLE_PASSWORD").ok(),
            ssl_mode: Some(crate::models::SslMode::Disable),
            ssl_root_cert: None,
            ssl_client_cert: None,
            ssl_client_key: None,
            ssh_tunnel: None,
        };
        let driver = super::OracleDriver::connect(&config)
            .await
            .expect("connect to configured Oracle contract service");
        let result = crate::driver::DatabaseDriver::execute(
            &driver,
            uuid::Uuid::new_v4(),
            "SELECT 1 AS health FROM dual",
            crate::driver::ExecutionMode::Direct,
        )
        .await
        .expect("read-only Oracle query");
        assert_eq!(result.columns[0].name, "HEALTH");
        let metadata = crate::driver::DatabaseDriver::metadata(&driver)
            .await
            .expect("Oracle metadata");
        assert!(!metadata.schemas.is_empty());
        assert!(crate::driver::DatabaseDriver::execute(
            &driver,
            uuid::Uuid::new_v4(),
            "CREATE TABLE queryx_contract (id NUMBER)",
            crate::driver::ExecutionMode::Direct,
        )
        .await
        .is_err());
        crate::driver::DatabaseDriver::disconnect(&driver)
            .await
            .expect("disconnect Oracle");
    }
}
