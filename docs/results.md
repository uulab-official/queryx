# Results and CSV Export

QueryX normalizes driver output into ordered columns, rows, execution time, affected-row count, warnings, and errors. The current alpha loads returned rows in memory and displays them in local pages of up to 100 rows.

## Table and JSON views

- **Table** preserves the driver's column order and displays NULL separately from text values.
- **JSON** shows the currently visible rows as formatted JSON.
- Drag the divider at the right edge of a column header to resize it. Arrow keys adjust the focused divider; Shift+Arrow changes it faster, and Home/End set the minimum/maximum width.
- Select a table in Explorer and choose **Browse data** to open its first 100 rows in a new query tab. When the result includes the table's primary-key columns, choose **Edit**, double-click a non-key cell, and stage a local change.
- The filter matches a case-insensitive string representation across each row.
- Selecting a column header toggles local ascending/descending sorting.

Filtering and sorting do not run another database query. They affect only the loaded result in the desktop UI, reset to the first page, and keep page navigation local.

## Copy and NULL display

Click a cell and Shift-click another cell to select a rectangular range. Click row numbers to select complete visible rows, then use Cmd/Ctrl+C or **Copy**. With no selection, **Copy** includes headers and copies the current filtered/sorted page. The shared clipboard serializer emits spreadsheet-safe TSV and quotes cells containing tabs, quotes, or line breaks.

The **NULL** button toggles between a visible `NULL` literal and a blank display. Copy follows that choice; CSV export keeps SQL NULL as an empty field so exported files remain compatible with the existing CSV contract.

## Export CSV, JSON, and SQL INSERT

Choose **Export** after a query returns columns and choose a format. QueryX exports all loaded rows after local filtering and sorting, in the displayed column order; local pagination only limits what is rendered at once.

- **CSV** is spreadsheet-safe and keeps the existing formula-injection protection.
- **JSON** emits an ordered array of row objects and converts BigInt/date values into portable JSON values.
- **SQL INSERT** asks for a target table name, quotes identifiers for the active dialect, escapes values, and wraps replayable statements in `BEGIN`/`COMMIT`. It is generated text, never an automatic database write.

In the native app, a save dialog asks for an explicit path with the selected extension. The browser development mode uses the browser download mechanism. Export is performed locally and does not use a QueryX service.

CSV behavior:

- UTF-8 with a byte-order mark for spreadsheet compatibility;
- CRLF record endings;
- commas, double quotes, and newlines are quoted and escaped;
- NULL and undefined values become empty fields;
- objects become compact JSON;
- values beginning with `=`, `+`, `-`, `@`, tab, or carriage return receive a leading apostrophe to reduce spreadsheet formula injection risk.

Formula protection changes the exported representation of affected text cells intentionally. A future advanced export dialog may expose an explicit raw mode; the current UI always uses the safe default.

SQL INSERT export never executes the generated script. Review the target table, column order, constraints, and conflict behavior before running it in a query tab.

## Staged row editing

Row editing is available for SQLite and PostgreSQL tables with reported primary keys. Primary-key cells are locked and act as the update target. Enter `NULL` to stage a null value; numeric, boolean, and JSON columns receive basic value normalization before SQL generation.

Edits stay local until **Review & Apply**. QueryX shows the generated `UPDATE` statements with primary-key and original-value predicates, then runs them inside the native edit-batch transaction only after explicit confirmation. Every statement must affect exactly one row; a mismatch is reported as an optimistic conflict and the native transaction rolls back the full batch while the original result/staged edits stay available for review. If the result does not contain every primary-key column, editing remains disabled. Views, keyless tables, and arbitrary result projections remain read-only until stronger table identity detection and validation land.

## Large results

The table browser can fetch another 100 rows with **Load next 100**. For keyed tables, each page uses a deterministic primary-key `ORDER BY` with `LIMIT/OFFSET`, and newly loaded rows stay in the local result. This is incremental fetch, not a virtualized grid: all loaded rows still occupy memory and arbitrary SQL results are not automatically paged. Add a narrower LIMIT clause when querying large tables and avoid exporting more data than the machine can comfortably hold in memory. Streaming, full server paging, progress, and cancellation remain roadmap items.

## Recovery

- If the save dialog is cancelled, no file is written.
- If writing fails, QueryX reports the native error and leaves the active query result intact.
- If the data looks truncated, rerun the query with an explicit ordering and limit, then confirm the visible row count before export.

When the active connection is marked **READ ONLY**, QueryX hides or disables result editing and rejects the edit batch at the database connection as a second enforcement layer. Query execution and metadata inspection remain available.

## Related

- [SQL Editor](sql-editor.md)
- [Connections](connections.md)
- [Security Policy](../SECURITY.md)
