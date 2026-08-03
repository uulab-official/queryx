# Driver API

All database integrations must implement the common driver contract. The UI should depend on this contract rather than `if postgres`, `if mysql`, or `if sqlite` branches.

```ts
interface DatabaseDriver {
  readonly kind: DriverKind;
  connect(config: DriverConfig): Promise<void>;
  execute(sql: string, signal?: AbortSignal): Promise<QueryResult>;
  metadata(): Promise<DatabaseMetadata>;
  transaction<T>(work: () => Promise<T>): Promise<T>;
  disconnect(): Promise<void>;
  capabilities(): ReadonlySet<DriverCapability>;
}
```

## Contract rules

- `connect()` must be safe to call once during initialization and must fail with an actionable error.
- `execute()` always returns the shared `QueryResult` shape for successful queries.
- Cancellation uses `AbortSignal` in the frontend and maps to the native mechanism only when the driver advertises `cancel`.
- `metadata()` returns vendor-neutral databases, schemas, tables, views, columns, indexes, foreign keys, and routines.
- `transaction()` must not silently commit a failed workflow.
- `disconnect()` releases the connection and any driver-owned resources.
- `capabilities()` describes optional behavior instead of making the UI infer support from vendor names.

## Result contract

```ts
interface QueryResult {
  columns: QueryColumn[];
  rows: Array<Record<string, unknown>>;
  executionTime: number;
  affectedRows: number;
  warnings: string[];
  error?: { code: string; message: string };
}
```

Rows must remain serializable across the Tauri bridge. Binary and database-specific values need an explicit serialization policy before they are added to the shared model.

PostgreSQL normalization currently covers booleans, integer and floating-point values, precision-preserving numeric strings, text, JSON, UUID, date/time values, bytea as base64, and common scalar arrays. Unknown native types are represented by an explicit type marker and add a result warning instead of failing the entire result set.

## Native Rust contract

The native runtime mirrors the TypeScript boundary with an object-safe async trait:

```rust
#[async_trait]
pub trait DatabaseDriver: Send + Sync {
    fn kind(&self) -> DriverKind;
    fn database(&self) -> &str;
    fn capabilities(&self) -> Vec<DriverCapability>;
    async fn prepare(&self, query_id: Uuid) -> Result<(), AppError>;
    async fn execute(&self, query_id: Uuid, sql: &str, mode: ExecutionMode) -> Result<QueryResult, AppError>;
    async fn cancel(&self, query_id: Uuid) -> Result<bool, AppError>;
    async fn metadata(&self) -> Result<DatabaseMetadata, AppError>;
    async fn disconnect(&self) -> Result<(), AppError>;
}
```

`DriverRegistry` stores `Arc<dyn DatabaseDriver>` behind opaque connection IDs. Vendor selection exists only in the connection factory; prepare, execute, cancel, metadata, transaction, and disconnect commands remain driver-neutral. The prepare step closes the abort-before-execute race by registering the UUID before the frontend exposes cancellation.

Generic Tauri commands:

- `connect_database`
- `prepare_query`
- `execute_query`
- `execute_query_transaction`
- `cancel_query`
- `database_metadata`
- `disconnect_database`

Every native driver must pass the registry contract suite before it can be exposed in the UI.

Cancellation is capability-driven. PostgreSQL reports `cancel`; SQLite returns `CancellationUnsupported` and does not expose the Cancel control. Repeated cancellation while a query is active is idempotent, while cancellation after completion returns `false`.

Live PostgreSQL contract coverage is enabled with the `QUERYX_TEST_POSTGRES_*` environment variables documented in [postgres-driver.md](postgres-driver.md).

## Metadata contract

`DatabaseMetadata` is currently an eager connection snapshot. `views`, `routines`, and every table's `indexes` and `foreignKeys` arrays are always present, including when empty. Drivers batch catalog queries and group results locally; the UI does not infer metadata behavior from the driver name.

Indexes preserve ordered column or expression labels, uniqueness, primary status, access method, and an optional database-rendered definition. Views preserve ordered columns and an optional definition. See [ADR-0004](decisions/ADR-0004-additive-relation-metadata.md) for the measured boundary that triggers migration to lazy catalog commands.

Foreign keys are owned by the source table and preserve an opaque snapshot ID, optional database name, ordered source/reference column pairs, target relation, referential actions, match mode, and optional deferrability. Incoming relationships are derived by the core reverse index rather than duplicated in the IPC payload. See [ADR-0005](decisions/ADR-0005-table-owned-foreign-keys.md).

Routines preserve an opaque snapshot ID, schema/name, function or procedure kind, identity arguments, optional return text, language, and optional database-rendered definition. Selection uses only the opaque ID; it is not a durable identifier across reconnects. Drivers that have no compatible routine catalog return an empty array. See [ADR-0006](decisions/ADR-0006-overload-safe-routine-metadata.md).

## Safety

Before an UPDATE or DELETE with no WHERE clause is executed, the query orchestration layer must produce a warning for Safe Mode. The UI can then choose Cancel, Run in Transaction, or Execute Anyway based on the user's explicit action.
