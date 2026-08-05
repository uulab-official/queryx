# SQLite Driver

## Current scope

The Tauri runtime owns real SQLite connections through SQLx. The React frontend never imports SQLx or accesses database files directly; it invokes generic typed Tauri commands through `TauriDatabaseDriver`.

The SQLite implementation is exposed through generic commands:

- `connect_database` — selects the SQLite factory, opens `:memory:` or a file, and returns an opaque connection ID
- `execute_query` — executes a read or write statement and returns the common result model
- `execute_query_transaction` — executes one statement inside a native transaction
- `execute_query_stream` — streams a single row-returning statement in ordered 256-row chunks; SQLite does not advertise cancellation
- `begin_transaction`, `commit_transaction`, and `rollback_transaction` — own a dedicated SQLite pool connection for multi-query sessions; subsequent queries and edit batches reuse it

SQLite advertises `explain`. QueryX wraps one active SQL statement with SQLite's `EXPLAIN` and renders the virtual-machine plan rows in the normal result grid. The action is non-executing and does not use `EXPLAIN ANALYZE`.
- `database_metadata` — returns schemas, tables, views, columns, indexes, foreign keys, triggers, FK/trigger-owner dependencies, and explicit empty PostgreSQL-routine/event-trigger arrays for Explorer/Inspector
- `disconnect_database` — closes and removes the connection from managed state

## Demo runtime

The current native app starts with `:memory:` and seeds deterministic `customers`, `orders`, an index, a view, and a foreign key. This validates the full Tauri → Rust → SQLx → SQLite → serialized result path without creating files or asking for credentials. Browser preview mode continues to use `InMemoryDriver`.

## Data mapping

- SQLite integer → JSON number
- SQLite real → JSON number
- SQLite text → JSON string
- SQLite blob → base64 string
- SQLite null → JSON null

The result also includes columns, execution time, affected rows, warnings, and an optional error field.

## Known limitations

- The connection dialog accepts a path and saves reusable secret-free profiles in the native app-local workspace. A native file picker remains planned.
- SQLite advertises native result streaming in 256-row chunks but deliberately does not advertise query cancellation; the UI keeps running state visible without offering a control that cannot safely interrupt SQLx execution.
- Explicit transaction sessions are connection-scoped and are rolled back automatically when the connection is disconnected. SQLite streaming remains non-cancellable while the session is active.
- Empty SELECT results do not yet include described column metadata.
- SQLite metadata covers tables, views, columns, primary-key markers, indexes, ordered foreign-key pairs, and `main` relation triggers. Trigger DDL comes from `sqlite_master.sql`; timing/events are conservatively parsed and status is `enabled`. It returns `routines: []` and `eventTriggers: []` because SQLite has no compatible stored-routine, aggregate/window-function, or database DDL event-trigger catalog. Dependency metadata includes foreign keys and trigger owners; view references remain empty because SQLite has no authoritative view dependency catalog.
- Safe Mode row estimates are still preview values; native parser/plan-backed estimation is required before production use.
