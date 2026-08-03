# Results and CSV Export

QueryX normalizes driver output into ordered columns, rows, execution time, affected-row count, warnings, and errors. The current alpha renders all returned rows in memory.

## Table and JSON views

- **Table** preserves the driver's column order and displays NULL separately from text values.
- **JSON** shows the currently visible rows as formatted JSON.
- The filter matches a case-insensitive string representation across each row.
- Selecting a column header toggles local ascending/descending sorting.

Filtering and sorting do not run another database query. They affect only the loaded result in the desktop UI.

## Export CSV

Choose **Export** after a query returns columns. QueryX exports the rows currently visible after local filtering and sorting, in the displayed column order.

In the native app, a save dialog asks for an explicit `.csv` path. The browser development mode uses the browser download mechanism. Export is performed locally and does not use a QueryX service.

CSV behavior:

- UTF-8 with a byte-order mark for spreadsheet compatibility;
- CRLF record endings;
- commas, double quotes, and newlines are quoted and escaped;
- NULL and undefined values become empty fields;
- objects become compact JSON;
- values beginning with `=`, `+`, `-`, `@`, tab, or carriage return receive a leading apostrophe to reduce spreadsheet formula injection risk.

Formula protection changes the exported representation of affected text cells intentionally. A future advanced export dialog may expose an explicit raw mode; the current UI always uses the safe default.

## Large results

The alpha does not stream or virtualize results. Add a LIMIT clause when querying large tables and avoid exporting more data than the machine can comfortably hold in memory. Streaming, server paging, progress, and cancellation are v0.2 roadmap items.

## Recovery

- If the save dialog is cancelled, no file is written.
- If writing fails, QueryX reports the native error and leaves the active query result intact.
- If the data looks truncated, rerun the query with an explicit ordering and limit, then confirm the visible row count before export.

## Related

- [SQL Editor](sql-editor.md)
- [Connections](connections.md)
- [Security Policy](../SECURITY.md)
