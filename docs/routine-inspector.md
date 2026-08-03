# Routine Inspector

## What it does

QueryX lists accessible PostgreSQL functions and procedures in each schema's **Routines** group. Selecting one opens its overload-safe signature, language, return shape, and database-rendered DDL without executing SQL.

## Before you start

Connect with an account that can see the routine's catalog entry. QueryX does not require `EXECUTE` privilege merely to list an otherwise visible routine, and inspecting a definition does not invoke it.

SQLite currently reports an empty routine collection because SQLite has no PostgreSQL-style stored function/procedure catalog. The shared UI renders that empty state without driver-specific branching.

## Quick start

1. Connect to PostgreSQL and expand **Schemas**.
2. Expand a schema, then **Routines**.
3. Select `name(arguments)`. The complete identity argument list distinguishes overloads.
4. Review **Routine details** and **Database-rendered DDL** in the Inspector.
5. Choose **Copy DDL** to place the displayed text on the clipboard. Copying does not open, edit, or execute a query.

## Identity and DDL behavior

PostgreSQL's routine OID becomes an opaque ID for the current metadata snapshot. The UI resolves a selection by that ID, never by name alone, so `calculate_total(integer)` and `calculate_total(numeric)` remain separate objects. OIDs are not persisted across reconnects or treated as permanent database identifiers.

Identity arguments come from `pg_get_function_identity_arguments`; they omit default expressions by design. Return text comes from `pg_get_function_result`, preserving useful `TABLE(...)` and set-returning forms.

Definitions come from `pg_get_functiondef`. PostgreSQL reconstructs a `CREATE OR REPLACE` statement, so whitespace, comments, and formatting from the original source may differ. QueryX labels this as database-rendered DDL rather than claiming it is the original authoring text.

## Safety and privacy

Routine bodies can contain business logic, object names, and embedded literals. QueryX retrieves them directly from the connected database into the local desktop process; it does not send them through a QueryX cloud service. The Inspector treats the text as untrusted, read-only content and never executes it automatically.

The alpha eagerly loads visible routine definitions in one batched catalog query. Very large routine catalogs can increase connection metadata latency and memory use. If measured payloads cross the boundary in [ADR-0004](decisions/ADR-0004-additive-relation-metadata.md), QueryX will retain the same opaque IDs while moving definition hydration to a batched lazy API.

## Troubleshooting

- **A routine is missing:** reconnect after creating it and confirm the account can see its schema and catalog entry. System, TOAST, and temporary schemas are excluded.
- **Two entries have the same name:** they are overloads; compare the arguments shown in parentheses.
- **Formatting differs from the migration:** PostgreSQL reconstructed the definition. Comments and original spacing are not preserved by `pg_get_functiondef`.
- **Copy DDL fails:** allow clipboard access for the desktop app, then retry. The definition remains selectable in the Inspector.
- **The Routines count is zero on SQLite:** this is the expected explicit empty contract, not a metadata failure.

## Related

- [Metadata Explorer](metadata-explorer.md)
- [PostgreSQL Driver](postgres-driver.md)
- [Driver API](driver-api.md)
- [ADR-0006](decisions/ADR-0006-overload-safe-routine-metadata.md)
