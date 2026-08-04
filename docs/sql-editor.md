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

Choose **Explain** to run a non-executing `EXPLAIN` wrapper for the active SQL document. The plan appears in the normal result grid, is cancellable where the driver supports cancellation, and is recorded in local query history. QueryX explains one statement at a time and never generates `EXPLAIN ANALYZE` from this button.

Click the ♡ toolbar button to save the active SQL to local **Favorites**. Saved queries can be recalled from the Explorer sidebar or Cmd/Ctrl+K and are never executed during recall. Favorites are deduplicated by SQL text and capped at 50 entries; see [Workspaces](workspaces.md) for the persistence boundary.

## Result grid

The table view supports spreadsheet-oriented copy without sending result data anywhere except the local clipboard:

- Click a cell to select it; Shift-click extends a rectangular cell range.
- Click a row number to select a full visible row; Shift-click extends the row range.
- Press Cmd/Ctrl+C while the grid is focused, or choose **Copy**, to copy the selected cells/rows as TSV. With no selection, Copy includes the visible column headers and filtered/sorted rows.
- Toggle **NULL** to switch between the literal `NULL` display and a blank display. Clipboard output follows the selected display mode; CSV export continues to use empty cells for null values.

Cells containing tabs, line breaks, or quotes are quoted so a pasted range remains rectangular in spreadsheet applications. The current grid still loads result rows in memory; virtualized streaming and server paging remain planned.

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
- Ctrl+Space — show metadata completion
- Escape — cancel an active query when the driver advertises cancellation
- Run in Transaction — execute the complete active document in one native transaction
- Explain — show a non-executing plan for the active document
- Monaco standard undo, redo, multi-cursor, and line movement shortcuts remain available

## Safety and privacy

Editor models live in the local renderer process. SQL is sent only over the local Tauri bridge to the selected database when explicitly executed. Query text currently enters local browser storage for history and favorites; migration to the encrypted/local workspace storage boundary remains planned.

Safe Mode analyzes exactly the selected SQL when a selection is executed, so an unrelated safe statement elsewhere in the tab cannot bypass a destructive-query warning.

## Performance

The application shell and Monaco editor are separate build chunks. QueryX can render its navigation and connection state before loading the larger editor runtime. Only the SQL language contribution and the generic editor worker are included; TypeScript, HTML, CSS, and JSON language workers are excluded.

## Known limitations

- SQL formatting is conservative and dialect-neutral; parser-backed dialect formatting and diagnostics remain planned.
- The command palette currently covers the core query/editor/result actions; Quick Open and extension-contributed commands remain planned.
- Completion is metadata-based; aliases, joins, CTE scope, functions, and dialect-aware ranking are not parsed yet.
- Tabs are session state and are not restored after restart yet; history and favorites are browser-local preview persistence until native workspace storage lands.
- SQLite does not yet support native cancellation; the Cancel control is capability-driven and currently available for PostgreSQL.
- Explain currently uses the database's text/row plan result in the shared result grid. Visual plan graphs and `EXPLAIN ANALYZE` controls remain planned.
- Result-grid copy operates on the currently visible filtered/sorted rows. Binary viewers, virtualized streaming, and server paging remain planned.

## Related

- [Database Connections](connections.md)
- [Workspaces](workspaces.md)
- [Driver API](driver-api.md)
- [Testing Guide](testing.md)
