# ADR-0007: Model relation triggers as a top-level metadata collection

- Status: Accepted
- Date: 2026-08-03

## Context

Triggers belong to tables or views but are also independently browsed schema objects. QueryX needs collision-safe selection, relation navigation, structured activation semantics, and read-only DDL across PostgreSQL and SQLite. Embedding triggers in both table and view models would duplicate contracts; adding lazy commands now would introduce revision, caching, and loading states before the measured eager boundary is crossed.

## Decision

Add required `DatabaseMetadata.triggers`. Each `TriggerMetadata` contains an opaque snapshot ID, schema/name, typed owner relation, timing, events, optional UPDATE columns, orientation, activation status, optional condition, and nullable definition. Selection resolves by opaque ID only.

PostgreSQL uses `pg_trigger` OIDs, preserves `origin/replica/always/disabled`, and obtains structured values and reconstructed DDL in one batched query. SQLite uses a length-prefixed deterministic opaque ID, authoritative `sqlite_master.tbl_name/sql`, `enabled` status, and conservative header parsing with `unknown` fallback.

Definitions are untrusted read-only data. Copy is explicit and execution is never connected to selection or copy.

## Consequences

- The UI remains driver neutral and can show one schema-level Triggers group.
- Trigger owners can be tables or views without changing either relation model.
- PostgreSQL replication semantics are not collapsed into a boolean.
- Eager definition bytes increase the snapshot. If ADR-0004 thresholds are crossed, definitions move to a revision-scoped batch hydration API while IDs and descriptors remain stable for that snapshot.
- PostgreSQL event triggers, foreign-table triggers, SQLite attached schemas, and editable trigger DDL remain separate future work.
