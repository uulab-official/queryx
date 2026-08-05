# Routine Inspector

## What it does

QueryX lists accessible PostgreSQL and SQL Server functions/procedures in each schema's **Routines** group. Selecting one opens its overload-safe signature, language, return shape, and the catalog metadata available for that callable without executing SQL. PostgreSQL also exposes aggregate and window-function entries.

## Before you start

Connect with an account that can see the routine's catalog entry. QueryX does not require `EXECUTE` privilege merely to list an otherwise visible routine, and inspecting a definition does not invoke it.

SQLite currently reports an empty routine collection because SQLite has no PostgreSQL-style stored function/procedure catalog. The shared UI renders that empty state without driver-specific branching.

## Quick start

1. Connect to PostgreSQL or SQL Server and expand **Schemas**.
2. Expand a schema, then **Routines**.
3. Select `name(arguments)`. The complete identity argument list distinguishes overloads.
4. Review **Routine details** and, for functions/procedures, **Database-rendered DDL** in the Inspector.
5. Choose **Copy DDL** to place the displayed text on the clipboard, or **Edit in SQL** to open a new editable tab. Neither action executes the definition.

## Identity and DDL behavior

PostgreSQL's routine OID becomes an opaque ID for the current metadata snapshot. The UI resolves a selection by that ID, never by name alone, so `calculate_total(integer)` and `calculate_total(numeric)` remain separate objects. OIDs are not persisted across reconnects or treated as permanent database identifiers.

Identity arguments come from `pg_get_function_identity_arguments`; they omit default expressions by design. Return text comes from `pg_get_function_result`, preserving useful `TABLE(...)` and set-returning forms.

Definitions for ordinary PostgreSQL functions/procedures come from `pg_get_functiondef`; SQL Server definitions come from `sys.sql_modules.definition`. Both are database-rendered source/DDL, so QueryX does not claim to preserve original authoring whitespace or comments.

Aggregates and window functions use the same OID-backed overload identity but have different catalog semantics. Aggregate entries show `normal`, `ordered-set`, or `hypothetical-set` mode and the number of direct arguments from `pg_aggregate`. A normal aggregate can also be invoked with an `OVER` clause; the catalog kind describes the stored callable, not the syntax of one query invocation. Window-function entries can be used only with window syntax. PostgreSQL does not expose an equivalent executable definition through `pg_get_functiondef` for these kinds, so QueryX shows catalog metadata and never invents DDL.

## Safety and privacy

Routine bodies can contain business logic, object names, and embedded literals. QueryX retrieves them directly from the connected database into the local desktop process; it does not send them through a QueryX cloud service. The Inspector treats the text as untrusted, read-only content and never executes it automatically.

Use **Run in Transaction** from the new SQL tab after reviewing or editing the statement. The transaction is rolled back when execution fails, and the SQL remains available for correction. Aggregate and window entries do not offer this handoff because they have no executable definition panel.

The alpha eagerly loads visible routine definitions in one batched catalog query. Very large routine catalogs can increase connection metadata latency and memory use. If measured payloads cross the boundary in [ADR-0004](decisions/ADR-0004-additive-relation-metadata.md), QueryX will retain the same opaque IDs while moving definition hydration to a batched lazy API.

## Troubleshooting

- **A routine is missing:** reconnect after creating it and confirm the account can see its schema and catalog entry. System, TOAST, and temporary schemas are excluded. User-defined window functions may also require a supported PostgreSQL implementation language; built-in system routines remain hidden with system schemas.
- **Two entries have the same name:** they are overloads; compare the arguments shown in parentheses.
- **Formatting differs from the migration:** PostgreSQL reconstructed the definition. Comments and original spacing are not preserved by `pg_get_functiondef`. Aggregate/window entries intentionally have no copied DDL.
- **Copy DDL fails:** allow clipboard access for the desktop app, then retry. The definition remains selectable in the Inspector.
- **The edited DDL fails:** correct the SQL in its tab and run it again. The failed transaction is rolled back; use **Refresh metadata** after a successful external or transactional schema change.
- **The Routines count is zero on SQLite:** this is the expected explicit empty contract, not a metadata failure. Oracle routines are still planned.

## Related

- [Metadata Explorer](metadata-explorer.md)
- [PostgreSQL Driver](postgres-driver.md)
- [Driver API](driver-api.md)
- [ADR-0006](decisions/ADR-0006-overload-safe-routine-metadata.md)
