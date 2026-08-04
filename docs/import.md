# CSV Import

QueryX supports a reviewed CSV import flow for the selected table in the native and browser UI.

## Workflow

1. Select a table and choose **Browse data**.
2. Choose **⇧ Import** in the result toolbar, or open **Import CSV into selected table** from the command palette.
3. Select a UTF-8 CSV with a header row.
4. Map each source header to a target column, choose the value type, and review the first five rows.
5. Fix every reported row, type, duplicate-target, or unmapped-column error.
6. Choose **Import N rows**. QueryX sends one INSERT statement per row through the native edit batch, which commits all rows together or rolls the batch back.

Empty fields become SQL `NULL`. Integer, numeric, boolean, date, and JSON mappings are validated before any SQL is sent. Identifiers and string values are quoted for the active PostgreSQL, MySQL/MariaDB, or SQLite dialect.

## Safety boundaries

- Read-only connections disable Import and the native driver rejects edit batches as a second enforcement layer.
- A malformed CSV or invalid typed value prevents the entire import from starting; valid rows are not partially applied.
- The import wizard does not silently create tables, infer destructive schema changes, or resolve conflicts. Unique, foreign-key, generated-column, and trigger behavior remains database-owned and is reported if the batch fails.
- CSV is currently supported. JSON import, delimiter selection, column transforms, upsert/conflict policies, progress, and resumable batches remain planned.

## Recovery

Native drivers execute import statements in one edit-batch transaction. If one row fails or the affected-row count differs from the expected batch size, the native transaction rolls back and the active result remains available for review. Correct the file or mapping and run the import again.

## Related

- [Results and CSV Export](results.md)
- [Connections](connections.md)
- [Roadmap](../ROADMAP.md)
