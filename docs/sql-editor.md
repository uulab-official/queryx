# SQL Editor

## What it does

QueryX uses the same Monaco editor foundation as VS Code. It provides SQL syntax highlighting, find, multi-cursor editing, bracket matching, line operations, a minimap, cursor/selection status, and metadata-aware suggestions for schemas, tables, and columns loaded from the active database.

Each query tab has an independent Monaco model. Switching tabs preserves its SQL and undo/redo stack instead of recreating a textarea.

## Quick start

1. Open a connection and create a tab with **+ New query** or Cmd/Ctrl+T.
2. Enter SQL. Use Ctrl+Space to open schema, table, and column suggestions.
3. Press Cmd/Ctrl+Enter to execute the active selection. With no selection, QueryX executes the full document.
4. On a driver with cancellation support, choose **Cancel** or press Escape while a query is running.
5. Close the active tab with Cmd/Ctrl+W or its close button. QueryX confirms before discarding modified SQL and always keeps at least one editable tab open.

Choose **Format** or press Cmd/Ctrl+L to apply a conservative SQL layout. Common clauses move to separate lines and keywords are uppercased; quoted strings, quoted identifiers, and SQL comments are preserved. This is intentionally dialect-neutral and does not claim parser-level formatting.

Choose **Explain** to run a non-executing `EXPLAIN` wrapper for the active SQL document. Text-plan responses expose a **Plan** view beside Table/JSON: operator nodes are indented by parentage, can be collapsed, and show parsed cost, estimated rows, actual rows, and execution time when the database reports them. The raw result remains available in Table/JSON, the query is cancellable where the driver supports cancellation, and it is recorded in local query history. QueryX explains one statement at a time and never generates `EXPLAIN ANALYZE` from this button.

Choose **Analyze** to run `EXPLAIN ANALYZE` after an explicit confirmation. PostgreSQL uses `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)` and MySQL/MariaDB uses `EXPLAIN ANALYZE`; both execute the target statement, so functions, writes, locks, and production resource usage are possible. SQLite, SQL Server, and Oracle remain disabled until their database-specific execution-plan contracts are implemented.

Use **Begin** to switch the connection from **Auto-commit** to an explicit native transaction session. Queries, streamed results, and table-editor batches keep using the same database connection until **Commit** or **Rollback** is chosen. The status bar shows the current state; disconnecting an unfinished session rolls it back. **Run in Transaction** remains the one-shot rollback-on-error workflow for a complete SQL document.

Click the ♡ toolbar button to save the active SQL to local **Favorites**. Press Cmd/Ctrl+P or click the Explorer search icon to open **Quick Open**, which searches favorites and recent queries by label or SQL. Selecting a result only loads it into the active tab; it never executes during recall. Favorites are deduplicated by SQL text and capped at 50 entries; see [Workspaces](workspaces.md) for the persistence boundary.

## Result grid

The table view supports spreadsheet-oriented copy without sending result data anywhere except the local clipboard:

- Click a cell to select it; Shift-click extends a rectangular cell range.
- Click a row number to select a full visible row; Shift-click extends the row range.
- Press Cmd/Ctrl+C while the grid is focused, or choose **Copy**, to copy the selected cells/rows as TSV. With no selection, Copy includes the visible column headers and filtered/sorted rows.
- Toggle **NULL** to switch between the literal `NULL` display and a blank display. Clipboard output follows the selected display mode; CSV export continues to use empty cells for null values.

Cells containing tabs, line breaks, or quotes are quoted so a pasted range remains rectangular in spreadsheet applications. Results are displayed in local pages of up to 100 rows, while the grid keeps loaded rows in memory. Column dividers can be dragged or adjusted with the keyboard; the native-driver **Stream** action appends cursor chunks while a single `SELECT`/`WITH` query runs, reports rows loaded live, and stops at the persisted 10k/100k/1m row cap. Safe SELECT/WITH queries support database-side paging and **Apply to query** filtering/sorting; disk-backed spill remains planned.

For a table with a reported primary key, choose **Browse data** in the Inspector, then **Edit** in the result toolbar. Double-click a non-key cell to stage a value, press Enter to commit the draft, and use **Review & Apply** to inspect the generated UPDATE statements before execution. QueryX includes original-value predicates and checks each affected row through the native edit-batch transaction; a mismatch is surfaced as an optimistic conflict and the full batch rolls back. QueryX never auto-writes a cell on blur.

The table browser starts with 100 rows and exposes **Load next 100**. Primary-key ordering makes subsequent pages deterministic; manually written SQL remains a bounded, in-memory result until server-side paging is added.

## DDL handoff

From a relation, trigger, event-trigger, or function/procedure Inspector, choose **Edit in SQL** to open the reconstructed definition in a new tab. The handoff never executes automatically. Review and modify the statement like any other query, then choose **Run in Transaction** to execute the complete document through the native transaction path. A failed statement rolls back the transaction and keeps the SQL tab available for correction.

## Keyboard behavior

- Cmd/Ctrl+Enter — execute selection or complete active document
- Cmd/Ctrl+Shift+Enter — execute selection or complete active document
- Cmd/Ctrl+T — create query tab
- Cmd/Ctrl+W — close active query tab
- Cmd/Ctrl+F while editing — Monaco find
- Cmd/Ctrl+F outside the editor — focus result filtering
- Cmd/Ctrl+K — open the searchable command palette, including favorite actions
- Cmd/Ctrl+P — open Quick Open for favorites and recent queries
- Ctrl+Space — show metadata completion
- Escape — cancel an active query when the driver advertises cancellation; close Safe Mode or connection dialogs when one is open
- Run in Transaction — execute the complete active document in one native transaction
- Begin — start a reusable native transaction session
- Commit — commit the active transaction session
- Rollback — discard the active transaction session
- Explain — show a non-executing plan for the active document
- Analyze — execute PostgreSQL/MySQL/MariaDB `EXPLAIN ANALYZE` after confirmation
- Monaco standard undo, redo, multi-cursor, and line movement shortcuts remain available

## Safety and privacy

Editor models live in the local renderer process. SQL is sent only over the local Tauri bridge to the selected database when explicitly executed. On native desktop, query text in tabs, history, and favorites is stored in the versioned local workspace snapshot; browser preview uses localStorage until the native storage migration is complete.

Safe Mode analyzes exactly the selected SQL when a selection is executed, so an unrelated safe statement elsewhere in the tab cannot bypass a destructive-query warning. Its shared structure-aware scanner ignores literals, comments, quoted identifiers, nested predicates, and CTE names, checks every statement in a document for an `UPDATE`/`DELETE` without a top-level `WHERE`, and warns for high-risk `TRUNCATE`/`DROP`/`ALTER` operations. QueryX does not run a preflight `COUNT` or claim an affected-row estimate; the warning clearly marks the impact as unknown until the statement is reviewed or executed inside a transaction.

## Performance

The application shell and Monaco editor are separate build chunks. QueryX can render its navigation and connection state before loading the larger editor runtime. Only the SQL language contribution and the generic editor worker are included; TypeScript, HTML, CSS, and JSON language workers are excluded.

## Known limitations

- SQL formatting is conservative and dialect-neutral; parser-backed dialect formatting and diagnostics remain planned.
- The command palette currently covers the core query/editor/result actions; extension-contributed commands remain planned.
- Completion is metadata-based; aliases, joins, CTE scope, functions, and dialect-aware ranking are not parsed yet.
- Tabs, active-tab selection, dirty SQL, history, and favorites are restored from the native workspace snapshot or browser preview fallback; settings, cross-profile recovery, and SQLite migration remain planned.
- SQLite does not yet support native cancellation; the Cancel control is capability-driven and currently available for PostgreSQL/MySQL/MariaDB. SQLite streaming remains available without cancellation.
- Explain and Analyze normalize common text-plan responses into a collapsible operator tree; raw rows remain available in Table/JSON. Graphical node layout, database-specific cost limits, JSON plan contracts, and SQL Server/Oracle/SQLite analyze contracts remain planned.
- Result-grid copy operates on the currently visible filtered/sorted page; CSV export includes all loaded filtered/sorted rows. Single safe SELECT/WITH results support **Apply to query** for database-side literal filtering and selected-column ordering before loading another page. Binary viewers and spill-to-disk remain planned.

## Related

- [Database Connections](connections.md)
- [Execution Plans](explain-plans.md)
- [Workspaces](workspaces.md)
- [Driver API](driver-api.md)
- [Testing Guide](testing.md)
