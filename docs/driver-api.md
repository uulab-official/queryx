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

## Safety

Before an UPDATE or DELETE with no WHERE clause is executed, the query orchestration layer must produce a warning for Safe Mode. The UI can then choose Cancel, Run in Transaction, or Execute Anyway based on the user's explicit action.
