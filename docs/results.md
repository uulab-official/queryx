# Results and Export

QueryX normalizes driver output into ordered columns, rows, execution time, affected-row count, warnings, and errors. Single-statement `SELECT` and `WITH` queries are server-paged in 100-row batches; non-pageable statements retain the driver's normal result behavior. Smaller loaded results use local pages, while larger loaded results use a virtualized table window so only the rows near the viewport are mounted.

## Table and JSON views

- **Table** preserves the driver's column order and displays NULL separately from text values.
- **JSON** shows the currently visible rows as formatted JSON.
- Drag the divider at the right edge of a column header to resize it. Arrow keys adjust the focused divider; Shift+Arrow changes it faster, and Home/End set the minimum/maximum width.
- Select a table in Explorer and choose **Browse data** to open its first 100 rows in a new query tab. When the result includes the table's primary-key columns, choose **Edit**, double-click a non-key cell, and stage a local change. Select one or more row numbers and choose **Delete** to review a guarded row deletion, or choose **New row** to enter values with database defaults preserved.
- The filter matches a case-insensitive string representation across each row.
- Selecting a column header toggles ascending/descending sorting for the loaded rows.

For ordinary query results, filtering and sorting are local to the loaded result until you choose **Apply to query**. A single safe `SELECT`/`WITH` result can push the current filter and selected column order into the database; QueryX wraps the original statement as a derived table, searches every returned column with a literal case-insensitive substring match, and fetches a fresh first page. **Table browser** results use **Apply to table** and add primary-key columns as deterministic tie-breakers. Arbitrary query results do not have a guaranteed tie-breaker when multiple rows share the same sort value.

## Copy and NULL display

Click a cell and Shift-click another cell to select a rectangular range. Click row numbers to select complete visible rows, then use Cmd/Ctrl+C or **Copy**. With no selection, **Copy** includes headers and copies the current filtered/sorted page; in virtualized mode it copies all loaded filtered/sorted rows. The shared clipboard serializer emits spreadsheet-safe TSV and quotes cells containing tabs, quotes, or line breaks.

The **NULL** button toggles between a visible `NULL` literal and a blank display. Copy follows that choice; CSV export keeps SQL NULL as an empty field so exported files remain compatible with the existing CSV contract.

## Export CSV, JSON, SQL INSERT, Markdown, and Excel

Choose **Export** after a query returns columns and choose a format. QueryX exports all loaded rows after local filtering and sorting, in the displayed column order; local pagination only limits what is rendered at once.

- **CSV** is spreadsheet-safe and keeps the existing formula-injection protection.
- **JSON** emits an ordered array of row objects and converts BigInt/date values into portable JSON values.
- **SQL INSERT** asks for a target table name, quotes identifiers for the active dialect, escapes values, and wraps replayable statements in `BEGIN`/`COMMIT`. It is generated text, never an automatic database write.
- **Markdown** emits a pipe table with escaped pipes, HTML-sensitive characters, and line breaks, making a filtered result easy to paste into an issue, pull request, or design document.
- **Excel Workbook** emits a standard OpenXML `.xlsx` package with typed Number, Boolean, and inline String cells. It opens in Excel, LibreOffice, and compatible spreadsheet tools; result text is never serialized as a formula.

In the native app, a save dialog asks for an explicit path with the selected extension. The browser development mode uses the browser download mechanism. Export is performed locally and does not use a QueryX service.

All formats export the complete loaded result after the current filter and sort, not only the 100-row page currently visible in the grid. Server-paged or streamed rows must be loaded before they can be exported.

CSV behavior:

- UTF-8 with a byte-order mark for spreadsheet compatibility;
- CRLF record endings;
- commas, double quotes, and newlines are quoted and escaped;
- NULL and undefined values become empty fields;
- objects become compact JSON;
- values beginning with `=`, `+`, `-`, `@`, tab, or carriage return receive a leading apostrophe to reduce spreadsheet formula injection risk.

Formula protection changes the exported representation of affected text cells intentionally. A future advanced export dialog may expose an explicit raw mode; the current UI always uses the safe default.

SQL INSERT export never executes the generated script. Review the target table, column order, constraints, and conflict behavior before running it in a query tab.

## Table snapshots

Select a table in Explorer and choose **Snapshot** in the Inspector to export the currently loaded table-browser rows as a reviewable `.sql` file. The snapshot includes a best-effort `CREATE TABLE`, dialect-aware `INSERT` statements, a transaction wrapper, and a row-coverage comment such as `Rows: 100 of 125 (partial)` or `Rows: 0 of 0 (complete)`. Unsafe or unrecognized catalog type labels omit the generated `CREATE TABLE` rather than copying untrusted type text into SQL.

Snapshots are intentionally loaded-row exports, not full database backups. Load additional pages before exporting, confirm the coverage comment, and review constraints, generated columns, sequences, indexes, foreign keys, permissions, and vendor-specific types before restoring. High-risk `ALTER`, `DROP`, and `TRUNCATE` statements show the same loaded-row snapshot action in Safe Mode when a selected table result is available. Full native dump/restore orchestration remains planned.

## Staged row editing

Row editing is available for SQLite, PostgreSQL, and MySQL/MariaDB tables with reported primary keys. Primary-key cells are locked and act as the update target. Enter `NULL` to stage a null value; numeric, boolean, and JSON columns receive basic value normalization before SQL generation. MySQL/MariaDB primary-key metadata is supported through `information_schema`; foreign-key-aware editor validation remains planned.

Edits stay local until **Review & Apply**. QueryX shows the generated `UPDATE` statements with primary-key and original-value predicates, then runs them inside the native edit-batch transaction only after explicit confirmation. Every statement must affect exactly one row; a mismatch is reported as an optimistic conflict and the native transaction rolls back the full batch while the original result/staged edits stay available for review. If the result does not contain every primary-key column, editing remains disabled. Views, keyless tables, and arbitrary result projections remain read-only until stronger table identity detection and validation land.

Selected-row deletion follows the same guarded path: QueryX generates one `DELETE` per selected row using the primary key plus every loaded original value as conflict predicates, shows the SQL before execution, and requires every statement to affect exactly one row. A concurrent edit, missing row, read-only connection, or database error rolls back the entire deletion batch. Deletion is intentionally limited to rows opened through the selected table browser; arbitrary query results remain protected from destructive row actions.

**New row** opens a column-aware form. Each column can use a database **Default**, an explicitly typed **Value**, or **NULL** where nullable. Omitted columns are left out of the `INSERT` so identity keys, generated columns, timestamps, and database defaults remain database-owned. The generated statement is previewed, then executed as one native edit batch that must report exactly one affected row before QueryX refreshes the table browser.

## Large results

The table browser and ordinary pageable queries can fetch another 100 rows with **Load next 100**. Table browsing applies a dialect-aware server filter and sort when requested, uses a deterministic primary-key `ORDER BY` when available, and blocks the next-page action until changed filter/order settings are applied. Ordinary single-statement `SELECT`/`WITH` queries are wrapped as a derived table with dialect-aware quoting and `LIMIT/OFFSET`; **Apply to query** adds a literal filter and selected-column order to that wrapper, and the original SQL remains in the editor and query history. Newly loaded rows stay in the local result. Once the loaded set grows beyond 200 rows, the grid switches to bounded row rendering with overscan and scroll spacers; the footer marks this mode as **virtualized**. Selection and copy continue to use logical row positions, while export still operates on all loaded, filtered, and sorted rows.

Virtualization reduces DOM work but does not reduce memory use: loaded pages remain available for local filtering and export. For all native connections, **Stream** runs a single safe `SELECT`/`WITH` query through the native row stream and appends 256-row chunks as they arrive. The Results toolbar shows live rows loaded and persists a selectable 10,000/100,000/1,000,000 row cap. When a chunk exceeds the cap, QueryX retains only the bounded prefix, cancels where the driver supports cancellation, records a successful truncated result, and clearly adds a warning. PostgreSQL and MySQL/MariaDB keep the normal **Cancel** action available while the stream is active; SQLite streams without a cancellation control because SQLite does not expose a safe interrupt path through the current driver contract. QueryX still falls back to normal execution for DML, multiple statements, locking clauses, and queries with unterminated SQL syntax. True chunk backpressure and disk spill remain roadmap items.

Streaming is an accumulation path: received rows remain in the local result for filtering, copy, and export. The cap bounds renderer memory, but it does not turn an unbounded export into a disk-backed workflow. Use an explicit `LIMIT`, projection, and ordering for repeatable large-result workflows; increase the cap only when the local machine can safely hold the result.

## Recovery

- If the save dialog is cancelled, no file is written.
- If writing fails, QueryX reports the native error and leaves the active query result intact.
- If the data looks truncated, rerun the query with an explicit ordering and limit, then confirm the visible row count before export.

When the active connection is marked **READ ONLY**, QueryX hides or disables result editing and rejects the edit batch at the database connection as a second enforcement layer. Query execution and metadata inspection remain available.

## Related

- [SQL Editor](sql-editor.md)
- [CSV Import](import.md)
- [Connections](connections.md)
- [Security Policy](../SECURITY.md)
