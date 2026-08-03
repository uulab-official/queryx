# SQLite Driver

## Current scope

The Tauri runtime owns real SQLite connections through SQLx. The React frontend never imports SQLx or accesses database files directly; it invokes typed Tauri commands through `TauriSqliteDriver`.

Implemented commands:

- `connect_sqlite` — opens `:memory:` or a SQLite file and returns an opaque connection ID
- `execute_sqlite` — executes a read or write statement and returns the common result model
- `execute_sqlite_transaction` — executes one statement inside a native transaction
- `sqlite_metadata` — returns schemas, tables, and columns for Explorer/Inspector
- `disconnect_sqlite` — closes and removes the connection from managed state

## Demo runtime

The current native app starts with `:memory:` and seeds a deterministic `orders` table. This validates the full Tauri → Rust → SQLx → SQLite → serialized result path without creating files or asking for credentials. Browser preview mode continues to use `InMemoryDriver`.

## Data mapping

- SQLite integer → JSON number
- SQLite real → JSON number
- SQLite text → JSON string
- SQLite blob → base64 string
- SQLite null → JSON null

The result also includes columns, execution time, affected rows, warnings, and an optional error field.

## Known limitations

- The UI does not yet expose a file picker or saved connection profiles.
- Query cancellation is not wired to SQLx yet.
- A transaction invocation currently wraps one statement; multi-step transaction sessions need a dedicated transaction ID.
- Empty SELECT results do not yet include described column metadata.
- SQLite metadata currently covers tables and columns, not indexes, views, triggers, or DDL.
- Safe Mode row estimates are still preview values; native parser/plan-backed estimation is required before production use.
