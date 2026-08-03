# DDL Workflow

## What it does

QueryX keeps metadata inspection separate from schema mutation. A relation, trigger, event trigger, or ordinary PostgreSQL function/procedure can expose a catalog-rendered definition. **Edit in SQL** hands that text to a normal query tab; it does not execute it or create an object-specific mutation command.

## Before you start

Use a least-privilege account and confirm the target database supports transactional DDL for the operation you are reviewing. PostgreSQL definitions are reconstructed by the server and may differ from the original migration. Aggregate and window-function entries remain catalog metadata without an executable definition handoff.

## Quick start

1. Select a supported object in Explorer.
2. Review the Inspector definition and choose **Copy DDL** if you need a clipboard copy.
3. Choose **Edit in SQL**. QueryX opens a new tab containing the definition and does not execute it.
4. Review identifiers, dependencies, privileges, and environment-specific values. Edit the SQL when needed.
5. Choose **Run in Transaction** to execute the complete active document through the native transaction path.
6. After a successful schema change, choose **Refresh metadata** to load a new catalog snapshot.

## Options and behavior

- **Copy DDL** is renderer-local clipboard output.
- **Edit in SQL** creates a regular tab, preserving normal undo, close-confirmation, query history, and editor behavior.
- **Run in Transaction** is explicit and runs the complete document, not only a selected fragment. A statement error rolls back the transaction and leaves the SQL available for correction.
- **Refresh metadata** asks the active driver for a new eager snapshot. It does not execute user SQL and does not alter database state.
- There is no automatic privilege preflight, schema diff, migration ledger, or object-specific Apply button yet.

## Safety and privacy

Definitions and edited SQL stay within the local desktop process and the selected database connection. QueryX never executes a definition as a side effect of selecting, copying, or handing it to the editor. Review reconstructed SQL before running it, especially event-trigger DDL that can affect the whole database.

The native transaction path owns commit and rollback behavior. If execution fails, QueryX reports the error and preserves the tab; do not assume a partially applied multi-statement document is committed. Confirm the database's DDL transaction semantics for vendor-specific statements.

## Troubleshooting

- **No Edit in SQL button:** the selected object has no executable definition in the shared metadata contract, most commonly an aggregate/window routine.
- **The SQL fails:** inspect the native error, correct the tab, and run it again. The failed transaction is rolled back by the driver path.
- **The object is missing after success:** choose **Refresh metadata**. An eager snapshot can be stale after changes made by another tool or connection.
- **The reconstructed SQL differs from the migration:** PostgreSQL deparses catalog values and does not retain original comments or whitespace in this view.
- **The result looks unchanged:** metadata refresh updates Explorer/Inspector state; it does not re-run the SQL tab or rewrite your edited document.

## Current limits and next gate

This workflow is a safe editor handoff, not a schema migration system. The next roadmap gate is schema-aware diffing with dependency ordering, privilege checks, generated SQL preview, migration history, and vendor capability declarations. See [ADR-0011](decisions/ADR-0011-safe-ddl-editor-handoff.md) and [Roadmap](../ROADMAP.md).

## Related

- [Metadata Explorer](metadata-explorer.md)
- [SQL Editor](sql-editor.md)
- [Testing Guide](testing.md)
- [Driver API](driver-api.md)
