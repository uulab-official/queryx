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
- Cancellation should use `AbortSignal` in the frontend and map to the native cancellation mechanism in Rust.
- `metadata()` returns vendor-neutral databases, schemas, and table/column information.
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
    async fn execute(&self, sql: &str, mode: ExecutionMode) -> Result<QueryResult, AppError>;
    async fn metadata(&self) -> Result<DatabaseMetadata, AppError>;
    async fn disconnect(&self) -> Result<(), AppError>;
}
```

`DriverRegistry` stores `Arc<dyn DatabaseDriver>` behind opaque connection IDs. Vendor selection exists only in the connection factory; execute, metadata, transaction, and disconnect commands remain driver-neutral.

Generic Tauri commands:

- `connect_database`
- `execute_query`
- `execute_query_transaction`
- `database_metadata`
- `disconnect_database`

Every native driver must pass the registry contract suite before it can be exposed in the UI.

Live PostgreSQL contract coverage is enabled with the `QUERYX_TEST_POSTGRES_*` environment variables documented in [postgres-driver.md](postgres-driver.md).

## Safety

Before an UPDATE or DELETE with no WHERE clause is executed, the query orchestration layer must produce a warning for Safe Mode. The UI can then choose Cancel, Run in Transaction, or Execute Anyway based on the user's explicit action.
