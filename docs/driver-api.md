# Driver API

All database integrations must implement the common driver contract. The UI should depend on this contract rather than `if postgres`, `if mysql`, or `if sqlite` branches.

```ts
interface DatabaseDriver {
  readonly kind: DriverKind;
  connect(config: DriverConfig): Promise<void>;
  execute(sql: string, signal?: AbortSignal): Promise<QueryResult>;
  executeStream(sql: string, onChunk: (chunk: QueryChunk) => void, signal?: AbortSignal): Promise<QueryResult>;
  metadata(): Promise<DatabaseMetadata>;
  transaction<T>(work: () => Promise<T>): Promise<T>;
  disconnect(): Promise<void>;
  capabilities(): ReadonlySet<DriverCapability>;
}
```

## Contract rules

- `connect()` must be safe to call once during initialization and must fail with an actionable error.
- `execute()` always returns the shared `QueryResult` shape for successful queries.
- `executeStream()` is the large-result path: it delivers ordered `QueryChunk` values while the query runs and returns a completion summary whose `rows` array may be empty. Drivers without native streaming use the buffered fallback and must not advertise `streaming`.
- Cancellation uses `AbortSignal` in the frontend and maps to the native mechanism only when the driver advertises `cancel`.
- `metadata()` returns vendor-neutral databases, schemas, tables, views, columns, indexes, foreign keys, routines, relation triggers, event triggers, and direct dependencies.
- `transaction()` must not silently commit a failed workflow.
- `disconnect()` releases the connection and any driver-owned resources.
- `capabilities()` describes optional behavior instead of making the UI infer support from vendor names.
- Drivers advertising `explain` must accept a vendor-compatible non-executing `EXPLAIN` statement through `execute()`. The UI never generates `EXPLAIN ANALYZE` in the baseline plan action.

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

interface QueryChunk {
  rowOffset: number;
  columns: QueryColumn[];
  rows: Array<Record<string, unknown>>;
  warnings: string[];
}
```

Rows must remain serializable across the Tauri bridge. Binary and database-specific values need an explicit serialization policy before they are added to the shared model.

PostgreSQL normalization currently covers booleans, integer and floating-point values, precision-preserving numeric strings, text, JSON, UUID, date/time values, bytea as base64, and common scalar arrays. MySQL/MariaDB normalization covers common integer/floating/decimal, text, JSON, date/time, and binary values. Unknown native types are represented by an explicit type marker and add a result warning instead of failing the entire result set.

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
    async fn execute_stream(&self, query_id: Uuid, sql: &str, mode: ExecutionMode, on_chunk: QueryChunkHandler) -> Result<QueryResult, AppError>;
    async fn cancel(&self, query_id: Uuid) -> Result<bool, AppError>;
    async fn metadata(&self) -> Result<DatabaseMetadata, AppError>;
    async fn disconnect(&self) -> Result<(), AppError>;
}
```

`DriverRegistry` stores `Arc<dyn DatabaseDriver>` behind opaque connection IDs. Vendor selection exists only in the connection factory; prepare, execute, cancel, metadata, transaction, disconnect, and read-only policy remain driver-neutral. The prepare step closes the abort-before-execute race by registering the UUID before the frontend exposes cancellation.

`DriverConfig.readOnly` is enforced by the native connection: SQLite enables `PRAGMA query_only` for pooled connections, PostgreSQL sets `default_transaction_read_only`, and MySQL/MariaDB sets a read-only transaction session while applying a conservative native statement guard. `DatabaseDriver.isReadOnly()` and the `editing` capability expose the resulting policy to the UI, but UI state is not the security boundary.

Generic Tauri commands:

- `connect_database`
- `prepare_query`
- `execute_query`
- `execute_query_transaction`
- `execute_query_stream`
- `cancel_query`
- `database_metadata`
- `disconnect_database`

Every native driver must pass the registry contract suite before it can be exposed in the UI.

DDL Inspector actions are intentionally layered on this contract: copying is renderer-local, **Edit in SQL** creates a normal query document, and **Run in Transaction** calls `execute_query_transaction`. No object-specific mutation command exists yet. The transaction path must roll back on execution failure and return an actionable error while preserving the edited SQL in the tab.

Cancellation is capability-driven. PostgreSQL reports `cancel` and `streaming`; SQLite returns `CancellationUnsupported` and does not expose the Cancel control. PostgreSQL stream chunks are emitted in bounded 256-row batches and use the same active-query cancellation state machine. Repeated cancellation while a query is active is idempotent, while cancellation after completion returns `false`.

Live PostgreSQL contract coverage is enabled with the `QUERYX_TEST_POSTGRES_*` environment variables documented in [postgres-driver.md](postgres-driver.md). The optional MySQL/MariaDB health and read-only contract uses `QUERYX_TEST_MYSQL_*`, documented in [mysql-driver.md](mysql-driver.md).

## Metadata contract

`DatabaseMetadata` is currently an eager connection snapshot. `views`, `routines`, `triggers`, `eventTriggers`, `dependencies`, and every table's `indexes` and `foreignKeys` arrays are always present, including when empty. Drivers batch catalog queries and group results locally; the UI does not infer metadata behavior from the driver name.

Indexes preserve ordered column or expression labels, uniqueness, primary status, access method, and an optional database-rendered definition. Views preserve ordered columns and an optional definition. See [ADR-0004](decisions/ADR-0004-additive-relation-metadata.md) for the measured boundary that triggers migration to lazy catalog commands.

Foreign keys are owned by the source table and preserve an opaque snapshot ID, optional database name, ordered source/reference column pairs, target relation, referential actions, match mode, and optional deferrability. Incoming relationships are derived by the core reverse index rather than duplicated in the IPC payload. See [ADR-0005](decisions/ADR-0005-table-owned-foreign-keys.md).

Routines preserve an opaque snapshot ID, schema/name, function, procedure, aggregate, or window-function kind, identity arguments, optional return text, language, and optional database-rendered definition. Aggregate entries may include catalog-specific mode and direct-argument metadata. Selection uses only the opaque ID; it is not a durable identifier across reconnects. Drivers that have no compatible routine catalog return an empty array. See [ADR-0006](decisions/ADR-0006-overload-safe-routine-metadata.md) and [ADR-0010](decisions/ADR-0010-postgresql-callable-kinds.md).

Triggers preserve opaque snapshot identity, typed owner relation, timing/events, optional UPDATE columns, orientation, activation status, optional condition, and nullable database-rendered DDL. See [ADR-0007](decisions/ADR-0007-driver-neutral-trigger-metadata.md).

Event triggers preserve database-scoped identity, normalized PostgreSQL DDL event, activation status, optional command tags, overload-safe execution-function reference, and nullable catalog-reconstructed DDL. Their `DatabaseObjectRef.schema` is `null`; schema objects always carry a schema. Unsupported drivers return an empty collection. See [ADR-0009](decisions/ADR-0009-database-scoped-event-triggers.md).

Dependencies preserve normalized direction (`dependent → referenced`) and explicit provenance kinds: foreign key, view reference, trigger function, trigger owner, or event-trigger function. Relation endpoints use kind/schema/name; routine, relation-trigger, and event-trigger endpoints use opaque snapshot IDs where available, and routine endpoints include identity arguments. Drivers return only edges they can report authoritatively. See [ADR-0008](decisions/ADR-0008-driver-owned-dependency-snapshot.md).

## Safety

Before an UPDATE or DELETE with no WHERE clause is executed, the query orchestration layer must produce a warning for Safe Mode. The UI can then choose Cancel, Run in Transaction, or Execute Anyway based on the user's explicit action.
