# ADR-0005: Keep foreign keys source-table-owned and derive incoming relations

- Status: Accepted
- Date: 2026-08-03

## Context

QueryX needs bidirectional foreign-key navigation for credible daily database inspection. SQLite and PostgreSQL expose different catalog identities: PostgreSQL names constraints and exposes deferrability, while SQLite's `pragma_foreign_key_list` provides a table-local numeric ID but no declared name. Composite keys must preserve source/reference column pairing.

The eager metadata snapshot already owns indexes under `TableMetadata`. [ADR-0004](ADR-0004-additive-relation-metadata.md) defines the measured boundary for moving the snapshot to lazy relation loading.

Three representations were considered:

1. Store canonical outgoing foreign keys on the source table and derive incoming edges.
2. Store every relationship in a global `DatabaseMetadata.relationships` list.
3. Duplicate outgoing and incoming arrays on each table.

## Decision

Use source-table ownership:

- `TableMetadata.foreignKeys` is always present and contains canonical outgoing constraints.
- Each constraint has an opaque snapshot ID, nullable database name, target `RelationRef`, normalized actions, optional match/deferrability, and ordered `ForeignKeyColumnPair` values.
- SQLite groups rows by source table plus PRAGMA foreign-key ID and keeps unavailable names and deferrability as `null`.
- PostgreSQL groups `pg_constraint` rows by constraint OID and pairs `conkey` with `confkey` by ordinality.
- Drivers fetch catalog rows in batches; they do not issue a query per table.
- `@queryx/core` builds a transient reverse index. React consumes outgoing and incoming selectors and does not reconstruct or duplicate driver metadata.
- The eager snapshot reports incoming completeness as complete for visible tables. A relation outside the loaded snapshot reports partial completeness.

## Consequences

- Composite FK direction and column pairing are stable across drivers.
- Incoming relationships add no IPC payload and cannot drift from outgoing constraints.
- References to catalog-hidden tables remain representable, but navigation cannot open an object the user cannot see.
- SQLite's missing constraint name is shown as unnamed rather than synthesized as database truth.
- Snapshot IDs are suitable for rendering and one metadata session; they are not a persistence contract.

## Lazy-loading migration

The future `listRelations(schema)`/relation-detail API will reuse `ForeignKeyMetadata` unchanged. Outgoing constraints remain relation-owned. Complete incoming discovery will require a target-filtered or direction-aware catalog command, and the reverse index will expose partial state until that query completes.

## Risks and mitigations

- **Partial catalogs:** carry completeness state instead of presenting an empty incoming list as authoritative.
- **Composite ordering:** preserve explicit ordinals and test both SQLite and live PostgreSQL mappings.
- **Vendor leakage:** normalize actions and optional fields in Rust drivers; keep React driver-neutral.
- **Catalog cost:** retain batched queries and the ADR-0004 latency/relation-count/payload thresholds.
