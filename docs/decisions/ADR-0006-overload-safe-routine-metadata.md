# ADR-0006: Add overload-safe routine metadata to the eager snapshot

- Status: Accepted
- Date: 2026-08-03

## Context

A credible database IDE must browse functions and procedures, distinguish overloads, and inspect DDL. QueryX already loads a driver-neutral `DatabaseMetadata` snapshot for schemas, tables, views, indexes, and relationships. Replacing that contract with a flattened object graph would create broad migration risk, while fetching each definition on selection would introduce a new command, cache, loading state, and possible N+1 behavior before catalog size requires it.

PostgreSQL names alone are not unique for routines. Argument text is useful to people but should not become the UI's identity key. Definitions may also contain sensitive business logic and are database-reconstructed text, not necessarily the original source.

## Decision

Add `routines: RoutineMetadata[]` to `DatabaseMetadata`. Every driver returns the field, including an empty array. `RoutineMetadata` contains an opaque snapshot ID, schema, name, function/procedure/aggregate/window-function kind, identity arguments, optional return type, language, and optional definition. Aggregate entries may additionally carry `pg_aggregate` mode and direct-argument metadata.

PostgreSQL loads functions, procedures, aggregates, and window functions (`prokind` `f`, `p`, `a`, and `w`) with one `pg_proc` query. It derives the opaque ID from the catalog OID, display arguments from `pg_get_function_identity_arguments`, return text from `pg_get_function_result`, and read-only DDL from `pg_get_functiondef` only for `f` and `p`. A `pg_aggregate` left join supplies aggregate mode and direct-argument count. Aggregate and window entries remain read-only catalog metadata without invented executable DDL.

The frontend stores a discriminated `SelectedDatabaseObject`. Table and view references use schema/name; routine references resolve only by opaque ID. The ID is scoped to the active snapshot and must not be persisted as a durable database identifier.

The Inspector presents database-rendered DDL as untrusted read-only text. Copy is explicit and separate from editor execution. QueryX never automatically runs the definition.

## Consequences

- Existing table/view arrays and driver behavior remain compatible through an additive field.
- Overloaded routines cannot collide in Explorer selection.
- SQLite can use the same UI contract with `routines: []`.
- Monaco can advertise routines with Function completion kind while inserting only the routine name.
- Eager definitions increase snapshot size. Definition bytes join metadata latency and payload size as signals for the lazy-loading threshold in ADR-0004.
- `pg_get_functiondef` can change formatting and omit original comments. Product copy and documentation must call it database-rendered DDL.

## Follow-up

If observed catalogs cross the eager boundary, add a schema- or ID-batched definition provider tied to the metadata revision. Preserve nullable definitions and opaque IDs so Explorer selection does not change. Dependencies, triggers, and editable DDL need separate capability and safety designs. Aggregate invocation as a window expression is a query-level concern; the catalog kind remains `aggregate`.
