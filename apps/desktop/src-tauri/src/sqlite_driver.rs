use std::{collections::HashMap, str::FromStr, time::Instant};

use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use futures_util::TryStreamExt;
use serde_json::Value;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions, SqliteRow},
    Column, Row, Sqlite, SqlitePool, TypeInfo, ValueRef,
};
use uuid::Uuid;

use crate::{
    driver::{DatabaseDriver, ExecutionMode, QueryChunkHandler},
    error::AppError,
    models::{
        ColumnMetadata, DatabaseMetadata, DatabaseObjectKind, DatabaseObjectRef, DependencyKind,
        DependencyMetadata, DriverCapability, DriverKind, ForeignKeyColumnPair, ForeignKeyMetadata,
        IndexMetadata, QueryChunk, QueryColumn, QueryResult, RelationRef, TableMetadata,
        TriggerEvent, TriggerMetadata, TriggerOrientation, TriggerRelationKind, TriggerRelationRef,
        TriggerStatus, TriggerTiming, ViewMetadata,
    },
};

pub struct SqliteDriver {
    path: String,
    pool: SqlitePool,
    read_only: bool,
}

impl SqliteDriver {
    pub async fn connect(path: &str, read_only: bool) -> Result<Self, AppError> {
        let database_url = sqlite_url(path)?;
        let options = SqliteConnectOptions::from_str(&database_url)?.create_if_missing(true);
        let max_connections = if path == ":memory:" { 1 } else { 5 };
        let mut pool_options = SqlitePoolOptions::new().max_connections(max_connections);
        if read_only && path != ":memory:" {
            pool_options = pool_options.after_connect(|connection, _| {
                Box::pin(async move {
                    sqlx::query("PRAGMA query_only = ON")
                        .execute(connection)
                        .await?;
                    Ok(())
                })
            });
        }
        let pool = pool_options.connect_with(options).await?;

        if path == ":memory:" {
            seed_demo_database(&pool).await?;
            if read_only {
                sqlx::query("PRAGMA query_only = ON").execute(&pool).await?;
            }
        }

        Ok(Self {
            path: path.to_string(),
            pool,
            read_only,
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
        mode: ExecutionMode,
    ) -> Result<QueryResult, AppError> {
        execute_on_pool(&self.pool, sql, mode == ExecutionMode::Transaction).await
    }

    async fn execute_stream(
        &self,
        query_id: Uuid,
        sql: &str,
        mode: ExecutionMode,
        on_chunk: QueryChunkHandler,
    ) -> Result<QueryResult, AppError> {
        execute_stream_on_pool(
            &self.pool,
            query_id,
            sql,
            mode == ExecutionMode::Transaction,
            on_chunk,
        )
        .await
    }

    async fn execute_batch(
        &self,
        _query_id: Uuid,
        statements: &[String],
        expected_rows: u64,
    ) -> Result<QueryResult, AppError> {
        execute_edit_batch_on_pool(&self.pool, statements, expected_rows).await
    }

    async fn cancel(&self, _query_id: Uuid) -> Result<bool, AppError> {
        Err(AppError::CancellationUnsupported(self.kind().to_string()))
    }

    async fn metadata(&self) -> Result<DatabaseMetadata, AppError> {
        let relation_rows = sqlx::query(
            "SELECT type AS relation_type, name, sql AS definition FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
        )
        .fetch_all(&self.pool)
        .await?;
        let column_rows = sqlx::query(
            "SELECT m.name AS relation_name, p.name AS column_name, p.type AS data_type, p.\"notnull\" AS is_not_null, p.pk AS primary_key FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type IN ('table', 'view') AND m.name NOT LIKE 'sqlite_%' ORDER BY m.name, p.cid",
        )
        .fetch_all(&self.pool)
        .await?;
        let index_rows = sqlx::query(
            "SELECT m.name AS table_name, il.name AS index_name, il.\"unique\" AS is_unique, il.origin AS origin, COALESCE(ii.name, '<expression>') AS column_name, sm.sql AS definition FROM sqlite_master m JOIN pragma_index_list(m.name) il LEFT JOIN pragma_index_info(il.name) ii LEFT JOIN sqlite_master sm ON sm.type = 'index' AND sm.name = il.name WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' ORDER BY m.name, il.name, ii.seqno",
        )
        .fetch_all(&self.pool)
        .await?;
        let foreign_key_rows = sqlx::query(
            "SELECT m.name AS source_table, fk.id AS foreign_key_id, fk.seq AS ordinal, fk.\"table\" AS referenced_table, fk.\"from\" AS source_column, fk.\"to\" AS referenced_column, fk.on_update, fk.on_delete, fk.\"match\" AS match_type FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) fk WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' ORDER BY m.name, fk.id, fk.seq",
        )
        .fetch_all(&self.pool)
        .await?;
        let trigger_rows = sqlx::query(
            "SELECT trigger_object.name AS trigger_name, trigger_object.tbl_name AS relation_name, trigger_object.sql AS definition, relation_object.type = 'view' AS is_view FROM sqlite_master trigger_object LEFT JOIN sqlite_master relation_object ON relation_object.name = trigger_object.tbl_name AND relation_object.type IN ('table', 'view') WHERE trigger_object.type = 'trigger' ORDER BY trigger_object.name",
        )
        .fetch_all(&self.pool)
        .await?;

        let mut columns_by_relation: HashMap<String, Vec<ColumnMetadata>> = HashMap::new();
        for row in column_rows {
            columns_by_relation
                .entry(row.try_get("relation_name")?)
                .or_default()
                .push(ColumnMetadata {
                    name: row.try_get("column_name")?,
                    r#type: row.try_get("data_type")?,
                    nullable: row.try_get::<i64, _>("is_not_null")? == 0,
                    primary_key: row.try_get::<i64, _>("primary_key")? > 0,
                });
        }

        let mut indexes_by_key: HashMap<(String, String), IndexMetadata> = HashMap::new();
        for row in index_rows {
            let table_name: String = row.try_get("table_name")?;
            let index_name: String = row.try_get("index_name")?;
            let column_name: String = row.try_get("column_name")?;
            indexes_by_key
                .entry((table_name, index_name.clone()))
                .and_modify(|index| index.columns.push(column_name.clone()))
                .or_insert(IndexMetadata {
                    name: index_name,
                    columns: vec![column_name],
                    unique: row.try_get::<i64, _>("is_unique")? != 0,
                    primary: row.try_get::<String, _>("origin")? == "pk",
                    r#type: "btree".into(),
                    definition: row.try_get("definition")?,
                });
        }

        let mut indexes_by_table: HashMap<String, Vec<IndexMetadata>> = HashMap::new();
        for ((table_name, _), index) in indexes_by_key {
            indexes_by_table.entry(table_name).or_default().push(index);
        }
        for indexes in indexes_by_table.values_mut() {
            indexes.sort_by(|left, right| left.name.cmp(&right.name));
        }

        let mut foreign_keys_by_key: HashMap<(String, i64), ForeignKeyMetadata> = HashMap::new();
        for row in foreign_key_rows {
            let source_table: String = row.try_get("source_table")?;
            let foreign_key_id: i64 = row.try_get("foreign_key_id")?;
            let pair = ForeignKeyColumnPair {
                ordinal: row.try_get::<i64, _>("ordinal")? as u32 + 1,
                source_column: row.try_get("source_column")?,
                referenced_column: row.try_get("referenced_column")?,
            };
            foreign_keys_by_key
                .entry((source_table.clone(), foreign_key_id))
                .and_modify(|foreign_key| foreign_key.columns.push(pair.clone()))
                .or_insert(ForeignKeyMetadata {
                    id: format!(
                        "sqlite:main:{}:{source_table}:{foreign_key_id}",
                        source_table.len()
                    ),
                    name: None,
                    columns: vec![pair],
                    referenced_relation: RelationRef {
                        schema: "main".into(),
                        name: row.try_get("referenced_table")?,
                    },
                    on_update: row.try_get("on_update")?,
                    on_delete: row.try_get("on_delete")?,
                    r#match: row.try_get("match_type")?,
                    deferrable: None,
                    initially_deferred: None,
                });
        }

        let mut foreign_keys_by_table: HashMap<String, Vec<ForeignKeyMetadata>> = HashMap::new();
        for ((table_name, _), mut foreign_key) in foreign_keys_by_key {
            foreign_key
                .columns
                .sort_by_key(|column_pair| column_pair.ordinal);
            foreign_keys_by_table
                .entry(table_name)
                .or_default()
                .push(foreign_key);
        }
        for foreign_keys in foreign_keys_by_table.values_mut() {
            foreign_keys.sort_by(|left, right| left.id.cmp(&right.id));
        }

        let mut tables = Vec::new();
        let mut views = Vec::new();
        for row in relation_rows {
            let relation_type: String = row.try_get("relation_type")?;
            let name: String = row.try_get("name")?;
            let columns = columns_by_relation.remove(&name).unwrap_or_default();
            if relation_type == "view" {
                views.push(ViewMetadata {
                    schema: "main".into(),
                    name,
                    columns,
                    definition: row.try_get("definition")?,
                });
            } else {
                tables.push(TableMetadata {
                    schema: "main".into(),
                    indexes: indexes_by_table.remove(&name).unwrap_or_default(),
                    foreign_keys: foreign_keys_by_table.remove(&name).unwrap_or_default(),
                    name,
                    row_count: 0,
                    columns,
                });
            }
        }

        let triggers = trigger_rows
            .into_iter()
            .map(|row| {
                let name: String = row.try_get("trigger_name")?;
                let relation_name: String = row.try_get("relation_name")?;
                let definition: Option<String> = row.try_get("definition")?;
                let (timing, events) = definition
                    .as_deref()
                    .map(parse_sqlite_trigger_header)
                    .unwrap_or((TriggerTiming::Unknown, vec![TriggerEvent::Unknown]));
                Ok(TriggerMetadata {
                    id: format!(
                        "sqlite:trigger:{}:main:{}:{}",
                        "main".len(),
                        name.len(),
                        name
                    ),
                    schema: "main".into(),
                    name,
                    relation: TriggerRelationRef {
                        schema: "main".into(),
                        name: relation_name,
                        kind: if row.try_get("is_view")? {
                            TriggerRelationKind::View
                        } else {
                            TriggerRelationKind::Table
                        },
                    },
                    timing,
                    events,
                    update_columns: None,
                    orientation: TriggerOrientation::Row,
                    status: TriggerStatus::Enabled,
                    condition: None,
                    definition,
                })
            })
            .collect::<Result<Vec<_>, sqlx::Error>>()?;

        let mut dependencies = Vec::new();
        for table in &tables {
            for foreign_key in &table.foreign_keys {
                dependencies.push(DependencyMetadata {
                    id: format!("sqlite:dependency:foreign-key:{}", foreign_key.id),
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
                id: format!("sqlite:dependency:trigger-owner:{}", trigger.id),
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
            databases: vec![self.path.clone()],
            schemas: vec!["main".into()],
            tables,
            views,
            routines: Vec::new(),
            triggers,
            event_triggers: Vec::new(),
            dependencies,
        })
    }

    async fn disconnect(&self) -> Result<(), AppError> {
        self.pool.close().await;
        Ok(())
    }
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

fn parse_sqlite_trigger_header(sql: &str) -> (TriggerTiming, Vec<TriggerEvent>) {
    let normalized = sql
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_uppercase();
    let header = normalized.split(" BEGIN").next().unwrap_or(&normalized);
    let timing = if header.contains(" INSTEAD OF ") {
        TriggerTiming::InsteadOf
    } else if header.contains(" AFTER ") {
        TriggerTiming::After
    } else {
        TriggerTiming::Before
    };
    let mut events = Vec::new();
    if header.contains(" INSERT ") {
        events.push(TriggerEvent::Insert);
    }
    if header.contains(" UPDATE ") {
        events.push(TriggerEvent::Update);
    }
    if header.contains(" DELETE ") {
        events.push(TriggerEvent::Delete);
    }
    if events.is_empty() {
        events.push(TriggerEvent::Unknown);
    }
    (timing, events)
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

async fn execute_stream_on_pool(
    pool: &SqlitePool,
    query_id: Uuid,
    sql: &str,
    in_transaction: bool,
    on_chunk: QueryChunkHandler,
) -> Result<QueryResult, AppError> {
    let started = Instant::now();
    if !is_row_returning_query(sql) {
        let result = execute_on_pool(pool, sql, in_transaction).await?;
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
        let mut transaction = pool.begin().await?;
        let result =
            execute_stream_with_executor(&mut *transaction, query_id, sql, started, on_chunk)
                .await?;
        transaction.commit().await?;
        return Ok(result);
    }

    execute_stream_with_executor(pool, query_id, sql, started, on_chunk).await
}

async fn execute_stream_with_executor<'e, E>(
    executor: E,
    query_id: Uuid,
    sql: &str,
    started: Instant,
    on_chunk: QueryChunkHandler,
) -> Result<QueryResult, AppError>
where
    E: sqlx::Executor<'e, Database = Sqlite>,
{
    let mut rows = sqlx::query(sql).fetch(executor);
    let mut columns = Vec::new();
    let warnings = Vec::new();
    let mut chunk_rows = Vec::with_capacity(256);
    let mut row_offset = 0_u64;

    while let Some(row) = rows.try_next().await? {
        if columns.is_empty() {
            columns = columns_from_row(&row);
        }
        chunk_rows.push(row_to_json(&row)?);
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

async fn execute_edit_batch_on_pool(
    pool: &SqlitePool,
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
        "CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, customer_id INTEGER, status TEXT NOT NULL, total_amount REAL NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY (customer_id) REFERENCES customers (id) ON UPDATE CASCADE ON DELETE RESTRICT)",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_orders_status_created_at ON orders (status, created_at)",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "CREATE VIEW IF NOT EXISTS paid_orders AS SELECT id, total_amount, created_at FROM orders WHERE status = 'paid'",
    )
    .execute(pool)
    .await?;
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM orders")
        .fetch_one(pool)
        .await?;
    if count == 0 {
        sqlx::query("INSERT INTO customers (id, name) VALUES (1, 'Ada')")
            .execute(pool)
            .await?;
        for offset in 1..=10 {
            sqlx::query("INSERT INTO orders (customer_id, status, total_amount, created_at) VALUES (1, 'paid', ?1, datetime('now', ?2))")
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
    use std::sync::Arc;

    use crate::{driver::QueryChunkHandler, models::QueryChunk};

    #[tokio::test]
    async fn streams_sqlite_rows_in_bounded_chunks() {
        let driver = SqliteDriver::connect(":memory:", false)
            .await
            .expect("connect sqlite memory database");
        assert!(driver.capabilities().contains(&DriverCapability::Streaming));
        assert!(!driver.capabilities().contains(&DriverCapability::Cancel));

        let chunks = Arc::new(std::sync::Mutex::new(Vec::<QueryChunk>::new()));
        let captured_chunks = Arc::clone(&chunks);
        let handler: QueryChunkHandler = Arc::new(move |chunk| {
            captured_chunks
                .lock()
                .expect("lock sqlite stream chunks")
                .push(chunk);
        });
        let result = driver
            .execute_stream(
                Uuid::new_v4(),
                "WITH RECURSIVE numbers AS (SELECT 1 AS n UNION ALL SELECT n + 1 FROM numbers WHERE n < 300) SELECT n FROM numbers",
                ExecutionMode::Direct,
                handler,
            )
            .await
            .expect("stream sqlite rows");
        let (total_rows, first_offset, second_offset) = {
            let chunks = chunks.lock().expect("read sqlite stream chunks");
            (
                chunks.iter().map(|chunk| chunk.rows.len()).sum::<usize>(),
                chunks.first().map(|chunk| chunk.row_offset),
                chunks.get(1).map(|chunk| chunk.row_offset),
            )
        };

        assert!(result.rows.is_empty());
        assert_eq!(total_rows, 300);
        assert_eq!(first_offset, Some(0));
        assert_eq!(second_offset, Some(256));
    }

    #[tokio::test]
    async fn reports_affected_rows_inside_a_transaction() {
        let driver = SqliteDriver::connect(":memory:", false)
            .await
            .expect("connect sqlite memory database");
        let result = driver
            .execute(
                Uuid::new_v4(),
                "UPDATE orders SET status = 'review' WHERE id = 1",
                ExecutionMode::Transaction,
            )
            .await
            .expect("execute transaction");

        assert_eq!(result.affected_rows, 1);
    }

    #[tokio::test]
    async fn sums_affected_rows_for_staged_updates_in_one_transaction() {
        let driver = SqliteDriver::connect(":memory:", false)
            .await
            .expect("connect sqlite memory database");
        let result = driver
            .execute(
                Uuid::new_v4(),
                "UPDATE orders SET status = 'review' WHERE id = 1; UPDATE orders SET status = 'review' WHERE id = 2;",
                ExecutionMode::Transaction,
            )
            .await
            .expect("execute staged updates");

        assert_eq!(result.affected_rows, 2);
    }

    #[tokio::test]
    async fn deletes_selected_rows_and_reports_the_affected_count() {
        let driver = SqliteDriver::connect(":memory:", false)
            .await
            .expect("connect sqlite memory database");
        let result = driver
            .execute_batch(
                Uuid::new_v4(),
                &["DELETE FROM orders WHERE id = 1 AND status = 'paid'".into()],
                1,
            )
            .await
            .expect("delete selected row");

        assert_eq!(result.affected_rows, 1);
        let remaining: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM orders WHERE id = 1")
            .fetch_one(&driver.pool)
            .await
            .expect("count deleted order");
        assert_eq!(remaining, 0);
    }

    #[tokio::test]
    async fn rolls_back_selected_row_deletes_when_one_original_value_conflicts() {
        let driver = SqliteDriver::connect(":memory:", false)
            .await
            .expect("connect sqlite memory database");
        let error = driver
            .execute_batch(
                Uuid::new_v4(),
                &[
                    "DELETE FROM orders WHERE id = 1 AND status = 'paid'".into(),
                    "DELETE FROM orders WHERE id = 999 AND status = 'paid'".into(),
                ],
                2,
            )
            .await
            .expect_err("conflicting delete batch must roll back");

        assert!(matches!(error, AppError::EditConflict { .. }));
        let remaining: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM orders WHERE id = 1")
            .fetch_one(&driver.pool)
            .await
            .expect("count rolled-back order");
        assert_eq!(remaining, 1);
    }

    #[tokio::test]
    async fn rolls_back_the_entire_edit_batch_on_a_conflict() {
        let driver = SqliteDriver::connect(":memory:", false)
            .await
            .expect("connect sqlite memory database");
        let error = driver
            .execute_batch(
                Uuid::new_v4(),
                &[
                    "UPDATE orders SET status = 'review' WHERE id = 1".into(),
                    "UPDATE orders SET status = 'review' WHERE id = 999".into(),
                ],
                2,
            )
            .await
            .expect_err("conflicting batch must roll back");

        assert!(matches!(error, AppError::EditConflict { .. }));
        let status: String = sqlx::query_scalar("SELECT status FROM orders WHERE id = 1")
            .fetch_one(&driver.pool)
            .await
            .expect("read rolled-back order");
        assert_eq!(status, "paid");
    }

    #[tokio::test]
    async fn loads_views_and_composite_indexes_in_one_metadata_snapshot() {
        let driver = SqliteDriver::connect(":memory:", false)
            .await
            .expect("connect sqlite memory database");
        sqlx::query("CREATE TRIGGER orders_status_audit AFTER UPDATE OF status ON orders FOR EACH ROW WHEN NEW.status = 'paid' BEGIN SELECT NEW.id; END")
            .execute(&driver.pool)
            .await
            .expect("create sqlite trigger");
        let metadata = driver.metadata().await.expect("load sqlite metadata");
        let orders = metadata
            .tables
            .iter()
            .find(|table| table.name == "orders")
            .expect("orders table metadata");
        let index = orders
            .indexes
            .iter()
            .find(|index| index.name == "idx_orders_status_created_at")
            .expect("orders composite index metadata");
        let view = metadata
            .views
            .iter()
            .find(|view| view.name == "paid_orders")
            .expect("paid orders view metadata");

        assert_eq!(index.columns, ["status", "created_at"]);
        assert!(!index.unique);
        assert_eq!(view.columns.len(), 3);
        assert!(metadata.routines.is_empty());
        assert!(metadata.event_triggers.is_empty());
        let trigger = metadata
            .triggers
            .iter()
            .find(|trigger| trigger.name == "orders_status_audit")
            .expect("sqlite trigger metadata");
        assert_eq!(trigger.relation.name, "orders");
        assert_eq!(trigger.timing, TriggerTiming::After);
        assert_eq!(trigger.events, [TriggerEvent::Update]);
        assert_eq!(trigger.orientation, TriggerOrientation::Row);
        assert_eq!(trigger.status, TriggerStatus::Enabled);
        assert!(trigger
            .definition
            .as_deref()
            .is_some_and(|definition| definition.contains("CREATE TRIGGER")));
        assert!(view
            .definition
            .as_deref()
            .is_some_and(|sql| sql.contains("CREATE VIEW")));
        let trigger_owner = metadata
            .dependencies
            .iter()
            .find(|dependency| {
                dependency.kind == DependencyKind::TriggerOwner
                    && dependency.dependent.id.as_deref() == Some(trigger.id.as_str())
            })
            .expect("sqlite trigger owner dependency");
        assert_eq!(trigger_owner.referenced.kind, DatabaseObjectKind::Table);
        assert_eq!(trigger_owner.referenced.name, "orders");
        assert!(metadata
            .dependencies
            .iter()
            .all(|dependency| dependency.kind != DependencyKind::ViewReference));
    }

    #[tokio::test]
    async fn preserves_composite_foreign_key_column_pairing() {
        let driver = SqliteDriver::connect(":memory:", false)
            .await
            .expect("connect sqlite memory database");
        sqlx::query(
            "CREATE TABLE account_versions (tenant_id INTEGER NOT NULL, account_id INTEGER NOT NULL, PRIMARY KEY (tenant_id, account_id))",
        )
        .execute(&driver.pool)
        .await
        .expect("create composite parent");
        sqlx::query(
            "CREATE TABLE invoices (tenant_id INTEGER NOT NULL, account_id INTEGER NOT NULL, FOREIGN KEY (tenant_id, account_id) REFERENCES account_versions (tenant_id, account_id) ON UPDATE CASCADE ON DELETE RESTRICT)",
        )
        .execute(&driver.pool)
        .await
        .expect("create composite child");

        let metadata = driver.metadata().await.expect("load sqlite metadata");
        let invoices = metadata
            .tables
            .iter()
            .find(|table| table.name == "invoices")
            .expect("invoices metadata");
        let foreign_key = invoices
            .foreign_keys
            .first()
            .expect("composite foreign key");

        assert_eq!(foreign_key.name, None);
        assert_eq!(foreign_key.referenced_relation.name, "account_versions");
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
        let dependency = metadata
            .dependencies
            .iter()
            .find(|dependency| {
                dependency.kind == DependencyKind::ForeignKey
                    && dependency.dependent.name == "invoices"
            })
            .expect("sqlite foreign key dependency");
        assert_eq!(dependency.referenced.name, "account_versions");
    }
}
