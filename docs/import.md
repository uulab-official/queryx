# CSV Import

QueryX supports a reviewed CSV/JSON import flow for the selected table in the native and browser UI.

## Workflow

1. Select a table and choose **Browse data**.
2. Choose **⇧ Import** in the result toolbar, or open **Import CSV into selected table** from the command palette.
3. Select a UTF-8 CSV with a header row, a JSON array of objects, or newline-delimited JSON objects.
4. Map each source header to a target column, choose the value type, and review the first five rows.
5. Fix every reported row, type, duplicate-target, or unmapped-column error.
6. Choose a duplicate-key policy: **Stop and rollback** (default), **Ignore conflicting rows**, or **Update existing rows (upsert)**.
7. For upsert, select the mapped conflict key columns. QueryX warns when the current metadata snapshot does not show a matching unique or primary index.
8. Choose **Import N rows**. Normal imports send one INSERT statement per row through the native edit batch; upsert sends one validated multi-row statement through the native transaction so MySQL affected-row differences cannot cause a false rollback.

Empty fields become SQL `NULL`. Integer, numeric, boolean, date, and JSON mappings are validated before any SQL is sent. Identifiers and string values are quoted for the active PostgreSQL, MySQL/MariaDB, or SQLite dialect. Ignore-conflict mode emits `ON CONFLICT DO NOTHING`, `INSERT IGNORE`, or `INSERT OR IGNORE`. Upsert emits PostgreSQL/SQLite `ON CONFLICT (...) DO UPDATE`, or MySQL `ON DUPLICATE KEY UPDATE`, using only mapped non-key columns for updates.

## Safety boundaries

- Read-only connections disable Import and the native driver rejects edit batches as a second enforcement layer.
- A malformed CSV or invalid typed value prevents the entire import from starting; valid rows are not partially applied.
- The import wizard does not silently create tables, infer destructive schema changes, or invent a unique constraint. Foreign-key, generated-column, trigger, and conflict behavior remains database-owned and is reported if the transaction fails.
- CSV and object-based JSON import are supported. Delimiter selection, column transforms, progress, and resumable batches remain planned.

## Recovery

Native drivers execute imports inside a transaction. Error/ignore batches verify the expected affected-row count; upsert uses the direct transaction path because an updated row may report a driver-specific affected-row count. Any SQL failure rolls back the full operation and the active result remains available for review. Correct the file or mapping and run the import again.

## Related

- [Results and CSV Export](results.md)
- [Connections](connections.md)
- [Roadmap](../ROADMAP.md)
