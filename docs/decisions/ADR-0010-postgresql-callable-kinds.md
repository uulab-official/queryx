# ADR-0010: Preserve callable identity for PostgreSQL aggregate and window kinds

- Status: Accepted
- Date: 2026-08-03

## Context

PostgreSQL stores functions, procedures, aggregate functions, and window functions in `pg_proc`. The catalog `prokind` distinguishes them as `f`, `p`, `a`, and `w`; aggregate-specific semantics live in `pg_aggregate`. QueryX already has an overload-safe `RoutineMetadata` collection keyed by the current snapshot's `pg_proc.oid` and a UI Explorer/Inspector that navigates routines and trigger dependencies by that opaque ID.

The product needs to show aggregate and window entries to be useful as a database IDE, but the change must not split one callable identity across multiple collections or imply that every catalog object has executable DDL. A normal aggregate may also be invoked as a window expression with `OVER`; that query syntax does not change its catalog kind.

## Decision

Extend `RoutineMetadata.kind` additively with `aggregate` and `window`. Keep all four PostgreSQL callable kinds in the existing schema-level **Routines** group and retain `pg_proc.oid`-derived opaque IDs. Existing functions and procedures keep their current definition behavior and UI. Aggregate entries optionally carry:

- `aggregate.kind`: `normal`, `orderedSet`, `hypotheticalSet`, or `unknown`, mapped from `pg_aggregate.aggkind`;
- `aggregate.directArgumentCount`, mapped from `pg_aggregate.aggnumdirectargs`.

The PostgreSQL driver uses one batched `pg_proc` query with a left join to `pg_aggregate`. `pg_get_functiondef` is called only for `f` and `p`; aggregate/window definitions remain null. `pg_get_function_identity_arguments` and `pg_get_function_result` remain the shared overload and return-shape sources. SQLite returns `routines: []` because it has no compatible stored routine or aggregate/window catalog.

The Inspector labels callable kinds, shows aggregate-specific metadata when available, and presents a read-only catalog explanation when no executable definition exists. QueryX never fabricates, copies, or executes aggregate/window DDL.

## Consequences

- Existing dependency endpoints remain stable because functions, procedures, aggregates, and window functions all resolve as `DatabaseObjectKind::Routine` by opaque ID.
- Existing ordinary routine consumers only see new values when PostgreSQL exposes those catalog kinds; current function/procedure fields are unchanged.
- The shared contract remains driver-neutral: unsupported drivers return the existing explicit empty routine array.
- Aggregate invocation as a window expression is documented as query-level behavior, preventing an incorrect mutual-exclusion model.
- Aggregate/window definitions are not currently editable. Editable DDL needs a separate preview, privilege, transaction, and rollback decision.

## Verification

The offline Rust suite tests `prokind` and `aggkind` normalization. The live PostgreSQL 17 contract creates an isolated aggregate, verifies overload identity, return shape, aggregate mode, direct-argument count, and the null definition boundary, then drops the schema with `CASCADE`.

## References

- [PostgreSQL `pg_proc`](https://www.postgresql.org/docs/17/catalog-pg-proc.html)
- [PostgreSQL `pg_aggregate`](https://www.postgresql.org/docs/17/catalog-pg-aggregate.html)
- [PostgreSQL window functions](https://www.postgresql.org/docs/17/functions-window.html)
