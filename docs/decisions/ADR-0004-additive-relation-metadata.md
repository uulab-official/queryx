# ADR-0004: Extend the metadata snapshot before introducing lazy catalog commands

- Status: Accepted
- Date: 2026-08-03

## Context

QueryX needs table indexes and views to provide a credible database-IDE Explorer. The existing driver contract returns one `DatabaseMetadata` snapshot containing schemas, tables, and columns. Three designs were considered:

1. Add explicit view metadata and table-owned indexes to the snapshot.
2. Replace the table model with a flattened `DatabaseObject` discriminated union.
3. Replace the snapshot immediately with lazy `listSchemas`, `listRelations`, `listColumns`, and `listIndexes` commands.

The current alpha needs a usable SQLite/PostgreSQL slice without prematurely fixing a complex loading and cache protocol. The design must avoid vendor branches in React and avoid N+1 catalog queries.

## Decision

Keep the snapshot contract and extend it additively:

- `DatabaseMetadata.views` contains `ViewMetadata` values.
- `TableMetadata.indexes` contains `IndexMetadata` values.
- New arrays are always present and use an empty array when unsupported or empty.
- Views contain schema, name, ordered columns, and an optional definition.
- Indexes contain name, ordered columns/expressions, uniqueness, primary status, access method, and an optional definition.
- SQLite and PostgreSQL collect relation, column, and index rows with batched catalog queries and group them inside the driver.
- React selects a driver-neutral table/view reference and renders common metadata.

## Consequences

- Existing query and driver lifecycle commands remain unchanged.
- The metadata payload and initial connection work increase with catalog size.
- Index and view differences remain in driver mappings instead of UI vendor checks.
- Materialized views, triggers, routines, dependencies, and editable DDL remain future model additions.
- The current refresh boundary is reconnecting the database.

## Lazy migration boundary

Instrument metadata latency, relation count, and serialized payload before expanding the snapshot further. Introduce lazy loading when representative catalogs exceed any sustained target:

- metadata p95 above 750 ms on a local connection;
- more than 1,000 visible relations;
- serialized metadata above 5 MiB.

The migration order is `listSchemas` → `listRelations(schema)` → `listColumns(relation)` and `listIndexes(relation)`. The existing snapshot can act as an adapter/cache during migration. Do not flatten every object into one union first; introduce a `RelationMetadata` table/view boundary and keep indexes relation-owned.

## Risks and mitigations

- **Large snapshot:** batch catalog queries now and measure before adding more nested data.
- **Expression indexes:** preserve the database-rendered expression when no column name exists.
- **Missing optional definitions:** return `None`/omit the field, never a fabricated SQL statement.
- **Permission differences:** honor only catalog-visible objects and surface metadata errors without escalating privileges.
