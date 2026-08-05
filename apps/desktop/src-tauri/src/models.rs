use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DriverKind {
    Sqlite,
    Postgres,
    Mysql,
    #[serde(rename = "sqlserver")]
    SqlServer,
    Oracle,
}

impl std::fmt::Display for DriverKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let value = match self {
            Self::Sqlite => "sqlite",
            Self::Postgres => "postgres",
            Self::Mysql => "mysql",
            Self::SqlServer => "sqlserver",
            Self::Oracle => "oracle",
        };
        formatter.write_str(value)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SslMode {
    Disable,
    Prefer,
    Require,
    VerifyCa,
    VerifyFull,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshTunnelConfig {
    pub ssh_host: String,
    #[serde(default)]
    pub ssh_port: Option<u16>,
    pub ssh_username: String,
    #[serde(default)]
    pub local_port: Option<u16>,
    #[serde(default)]
    pub private_key_path: Option<String>,
    #[serde(default)]
    pub known_hosts_path: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionConfig {
    pub kind: DriverKind,
    pub name: String,
    pub database: String,
    #[serde(default)]
    pub read_only: bool,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub ssl_mode: Option<SslMode>,
    #[serde(default)]
    pub ssl_root_cert: Option<String>,
    #[serde(default)]
    pub ssl_client_cert: Option<String>,
    #[serde(default)]
    pub ssl_client_key: Option<String>,
    #[serde(default)]
    pub ssh_tunnel: Option<SshTunnelConfig>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSummary {
    pub id: String,
    pub name: String,
    pub driver: DriverKind,
    pub database: String,
    pub read_only: bool,
    pub capabilities: Vec<DriverCapability>,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DriverCapability {
    Transactions,
    Explain,
    Cancel,
    Streaming,
    Editing,
    Sessions,
    Locks,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DatabaseSessionState {
    Active,
    Idle,
    IdleInTransaction,
    Waiting,
    Unknown,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseSession {
    pub id: String,
    pub user: Option<String>,
    pub database: Option<String>,
    pub client_address: Option<String>,
    pub application_name: Option<String>,
    pub state: DatabaseSessionState,
    pub query: Option<String>,
    pub started_at: Option<String>,
    pub duration_ms: Option<i64>,
    pub wait_event: Option<String>,
    pub can_cancel: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseLock {
    pub id: String,
    pub blocked_session_id: String,
    pub blocking_session_id: String,
    pub resource: String,
    pub lock_type: String,
    pub blocked_mode: Option<String>,
    pub blocking_mode: Option<String>,
    pub blocked_duration_ms: Option<i64>,
    pub blocked_query: Option<String>,
    pub blocking_query: Option<String>,
    pub blocking_can_cancel: bool,
}

#[derive(Clone, Debug, Serialize)]
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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryChunk {
    pub query_id: String,
    pub row_offset: u64,
    pub columns: Vec<QueryColumn>,
    pub rows: Vec<HashMap<String, Value>>,
    pub warnings: Vec<String>,
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
    pub views: Vec<ViewMetadata>,
    pub routines: Vec<RoutineMetadata>,
    pub triggers: Vec<TriggerMetadata>,
    pub event_triggers: Vec<EventTriggerMetadata>,
    pub dependencies: Vec<DependencyMetadata>,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseObjectKind {
    Table,
    View,
    Routine,
    Trigger,
    EventTrigger,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseObjectRef {
    pub kind: DatabaseObjectKind,
    pub id: Option<String>,
    pub schema: Option<String>,
    pub name: String,
    pub identity_arguments: Option<String>,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DependencyKind {
    ForeignKey,
    ViewReference,
    TriggerFunction,
    TriggerOwner,
    EventTriggerFunction,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyMetadata {
    pub id: String,
    pub kind: DependencyKind,
    pub dependent: DatabaseObjectRef,
    pub referenced: DatabaseObjectRef,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EventTriggerEvent {
    DdlCommandStart,
    DdlCommandEnd,
    SqlDrop,
    TableRewrite,
    Unknown,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventTriggerMetadata {
    pub id: String,
    pub name: String,
    pub event: EventTriggerEvent,
    pub status: TriggerStatus,
    pub tags: Option<Vec<String>>,
    pub function: DatabaseObjectRef,
    pub definition: Option<String>,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RoutineKind {
    Function,
    Procedure,
    Aggregate,
    Window,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AggregateKind {
    Normal,
    OrderedSet,
    HypotheticalSet,
    Unknown,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AggregateMetadata {
    pub kind: AggregateKind,
    pub direct_argument_count: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineMetadata {
    pub id: String,
    pub schema: String,
    pub name: String,
    pub kind: RoutineKind,
    pub identity_arguments: String,
    pub return_type: Option<String>,
    pub language: String,
    pub definition: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aggregate: Option<AggregateMetadata>,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TriggerTiming {
    Before,
    After,
    InsteadOf,
    Unknown,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TriggerEvent {
    Insert,
    Update,
    Delete,
    Truncate,
    Unknown,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TriggerOrientation {
    Row,
    Statement,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TriggerStatus {
    Enabled,
    Origin,
    Replica,
    Always,
    Disabled,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerMetadata {
    pub id: String,
    pub schema: String,
    pub name: String,
    pub relation: TriggerRelationRef,
    pub timing: TriggerTiming,
    pub events: Vec<TriggerEvent>,
    pub update_columns: Option<Vec<String>>,
    pub orientation: TriggerOrientation,
    pub status: TriggerStatus,
    pub condition: Option<String>,
    pub definition: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerRelationRef {
    pub schema: String,
    pub name: String,
    pub kind: TriggerRelationKind,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TriggerRelationKind {
    Table,
    View,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableMetadata {
    pub schema: String,
    pub name: String,
    pub row_count: u64,
    pub columns: Vec<ColumnMetadata>,
    pub indexes: Vec<IndexMetadata>,
    pub foreign_keys: Vec<ForeignKeyMetadata>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnMetadata {
    pub name: String,
    pub r#type: String,
    pub nullable: bool,
    pub primary_key: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexMetadata {
    pub name: String,
    pub columns: Vec<String>,
    pub unique: bool,
    pub primary: bool,
    pub r#type: String,
    pub definition: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewMetadata {
    pub schema: String,
    pub name: String,
    pub columns: Vec<ColumnMetadata>,
    pub definition: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationRef {
    pub schema: String,
    pub name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKeyColumnPair {
    pub ordinal: u32,
    pub source_column: String,
    pub referenced_column: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKeyMetadata {
    pub id: String,
    pub name: Option<String>,
    pub columns: Vec<ForeignKeyColumnPair>,
    pub referenced_relation: RelationRef,
    pub on_update: String,
    pub on_delete: String,
    pub r#match: Option<String>,
    pub deferrable: Option<bool>,
    pub initially_deferred: Option<bool>,
}
