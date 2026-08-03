# SQLite Driver

## Current scope

The Tauri runtime owns real SQLite connections through SQLx. The React frontend never imports SQLx or accesses database files directly; it invokes generic typed Tauri commands through `TauriDatabaseDriver`.

The SQLite implementation is exposed through generic commands:

- `connect_database` — selects the SQLite factory, opens `:memory:` or a file, and returns an opaque connection ID
- `execute_query` — executes a read or write statement and returns the common result model
- `execute_query_transaction` — executes one statement inside a native transaction
- `database_metadata` — returns schemas, tables, views, columns, indexes, and foreign keys for Explorer/Inspector
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

- The connection dialog accepts a path, but a native file picker and saved profiles are not implemented yet.
- SQLite deliberately does not advertise query cancellation yet; the UI keeps running state visible without offering a control that cannot safely interrupt SQLx execution.
- A transaction invocation currently wraps one statement; multi-step transaction sessions need a dedicated transaction ID.
- Empty SELECT results do not yet include described column metadata.
- SQLite metadata covers tables, views, columns, primary-key markers, indexes, and ordered foreign-key pairs. Triggers and editable DDL are not exposed yet.
- Safe Mode row estimates are still preview values; native parser/plan-backed estimation is required before production use.
