use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Deserialize)]
pub struct SqliteConnectionConfig {
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSummary {
    pub id: String,
    pub driver: &'static str,
    pub database: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryColumn {
    pub name: String,
    pub r#type: String,
    pub nullable: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<QueryColumn>,
    pub rows: Vec<HashMap<String, Value>>,
    pub execution_time: u128,
    pub affected_rows: u64,
    pub warnings: Vec<String>,
    pub error: Option<QueryError>,
}

#[derive(Debug, Serialize)]
pub struct QueryError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseMetadata {
    pub databases: Vec<String>,
    pub schemas: Vec<String>,
    pub tables: Vec<TableMetadata>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableMetadata {
    pub schema: String,
    pub name: String,
    pub row_count: u64,
    pub columns: Vec<ColumnMetadata>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnMetadata {
    pub name: String,
    pub r#type: String,
    pub nullable: bool,
    pub primary_key: bool,
}
