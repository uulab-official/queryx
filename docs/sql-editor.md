# SQL Editor

## What it does

QueryX uses the same Monaco editor foundation as VS Code. It provides SQL syntax highlighting, find, multi-cursor editing, bracket matching, line operations, a minimap, cursor/selection status, and metadata-aware suggestions for schemas, tables, and columns loaded from the active database.

Each query tab has an independent Monaco model. Switching tabs preserves its SQL and undo/redo stack instead of recreating a textarea.

## Quick start

1. Open a connection and create a tab with **+ New query** or Cmd/Ctrl+T.
2. Enter SQL. Use Ctrl+Space to open schema, table, and column suggestions.
3. Press Cmd/Ctrl+Enter to execute the active selection. With no selection, QueryX executes the full document.
4. Close the active tab with Cmd/Ctrl+W or its close button. QueryX confirms before discarding modified SQL and always keeps at least one editable tab open.

## Keyboard behavior

- Cmd/Ctrl+Enter — execute selection or complete active document
- Cmd/Ctrl+Shift+Enter — execute selection or complete active document
- Cmd/Ctrl+T — create query tab
- Cmd/Ctrl+W — close active query tab
- Cmd/Ctrl+F while editing — Monaco find
- Cmd/Ctrl+F outside the editor — focus result filtering
- Ctrl+Space — show metadata completion
- Monaco standard undo, redo, multi-cursor, and line movement shortcuts remain available

## Safety and privacy

Editor models live in the local renderer process. SQL is sent only over the local Tauri bridge to the selected database when explicitly executed. Query text currently enters local browser history after execution; migration to the encrypted/local workspace storage boundary remains planned.

Safe Mode analyzes exactly the selected SQL when a selection is executed, so an unrelated safe statement elsewhere in the tab cannot bypass a destructive-query warning.

## Performance

The application shell and Monaco editor are separate build chunks. QueryX can render its navigation and connection state before loading the larger editor runtime. Only the SQL language contribution and the generic editor worker are included; TypeScript, HTML, CSS, and JSON language workers are excluded.

## Known limitations

- SQL formatting is still a lightweight placeholder and needs a dialect-aware formatter.
- Completion is metadata-based; aliases, joins, CTE scope, functions, and dialect-aware ranking are not parsed yet.
- Tabs are session state and are not restored after restart yet.
- Native query cancellation is not implemented yet.

## Related

- [Database Connections](connections.md)
- [Driver API](driver-api.md)
- [Testing Guide](testing.md)
