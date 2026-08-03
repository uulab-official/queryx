# Metadata Explorer

QueryX loads a driver-neutral snapshot of accessible schemas, tables, views, columns, primary-key markers, indexes, foreign keys, routines, relation triggers, and direct object dependencies. Database-specific catalog queries remain inside the SQLite and PostgreSQL drivers.

## Browse relations

Expand **Schemas**, choose a schema, and open its **Tables**, **Views**, **Routines**, or **Triggers** group. PostgreSQL database-wide event triggers appear in a separate connection-level **Event Triggers** group. Selecting an object updates the Inspector without executing SQL.

The Inspector shows:

- ordered column names and database-reported types;
- primary-key markers for table columns;
- estimated table row count when the driver provides it;
- view definition when the catalog exposes it;
- table index name, ordered key columns, access method, and primary/unique badges.
- outgoing and incoming foreign keys with ordered source/target column pairs and update/delete actions.
- overload-safe function/procedure signatures, language, return shape, and read-only database-rendered DDL.
- trigger activation mode, timing/events, owner navigation, condition, and read-only DDL.
- direct **Depends on / Used by** edges across visible tables, views, routines, and triggers.
- PostgreSQL event-trigger activation, DDL event, command tags, execution function, and catalog-reconstructed DDL.

View, table, and routine names are also available to Monaco metadata completion. Routine suggestions use the Function icon and insert the unqualified routine name.

## Inspect routines

Routines are displayed as `name(identity arguments)`, so overloads remain distinct. Selection resolves through an opaque snapshot ID rather than the visible name or argument text. PostgreSQL reconstructs the displayed `CREATE OR REPLACE` statement; original comments and formatting may differ.

The DDL panel is read only. **Copy DDL** is an explicit clipboard action and never executes or inserts the definition into an editor. See [Routine Inspector](routine-inspector.md) for identity, privacy, and recovery details.

## Inspect triggers

Trigger rows show the trigger name and owning relation. Selection uses an opaque snapshot ID. Inspector preserves PostgreSQL replication activation modes and links directly to the owning table or view. See [Trigger Inspector](trigger-inspector.md).

## Navigate relationships

Select a table and open **Relations** in the Inspector. **Outgoing** lists tables referenced by the selected table; **Incoming** lists visible tables that reference it. Select a relationship to move directly to the other table.

Composite keys remain paired in database ordinal order. SQLite constraints can be unnamed, in which case QueryX displays **Unnamed foreign key** instead of inventing a database constraint name. A referenced table outside the visible catalog remains listed, but QueryX reports that it cannot navigate to the hidden object.

## Navigate object dependencies

Select **Dependencies** for a table or view. Routine and trigger Inspectors show dependency groups below their details. **Depends on** follows outgoing edges; **Used by** follows incoming edges. Select either endpoint to navigate without issuing another catalog query. See [Dependency Inspector](dependency-inspector.md) for edge semantics and driver coverage.

## Driver behavior

### SQLite

QueryX excludes internal `sqlite_%` objects. It reads tables, views, and relation triggers from `sqlite_master`, then uses table-valued PRAGMA queries to collect columns, indexes, and foreign keys in batches. SQLite auto-indexes may not include a SQL definition. An `INTEGER PRIMARY KEY` aliases the rowid and may not appear as a separate index.

SQLite returns `routines: []` because it has no stored function/procedure catalog equivalent to PostgreSQL. This is an explicit supported contract rather than an error.

SQLite also returns `eventTriggers: []`; it has no PostgreSQL-compatible database DDL event-trigger catalog.

SQLite reports foreign-key and trigger-owner dependency edges. It does not guess view dependencies from SQL text because SQLite has no authoritative view dependency catalog.

`pragma_foreign_key_list` does not expose a declared constraint name or deferrability. QueryX preserves those values as unavailable instead of inferring them. When SQLite omits an implicit referenced column, QueryX displays `primary key` without fabricating a physical column name.

### PostgreSQL

QueryX excludes `pg_catalog`, `information_schema`, TOAST, and temporary schemas. It combines `information_schema` relation data with `pg_catalog` index, constraint, and routine metadata. PostgreSQL constraint and routine OIDs provide snapshot identities, while paired `conkey`/`confkey` ordinals preserve composite relationships. Estimated row counts come from PostgreSQL catalog statistics and can differ from an exact `COUNT(*)`.

One `pg_proc` query loads ordinary functions and procedures, identity arguments, result text, language, and `pg_get_functiondef` output. Aggregates and window functions are intentionally excluded until they receive a separate model.

A separate batched `pg_trigger` query loads non-internal relation triggers, activation modes, UPDATE columns, conditions, and reconstructed DDL.

PostgreSQL adds direct view-to-relation edges from rewrite dependencies and trigger-to-function edges from `tgfoid`. Routine OIDs keep trigger function navigation overload safe.

A batched `pg_event_trigger` query loads database-scoped event triggers and their execution functions. PostgreSQL-provided quoting is used for the catalog-reconstructed read-only definition. See [Event Trigger Inspector](event-trigger-inspector.md).

Expression index entries use the database-rendered expression when no physical column name exists. Partial index predicates and complete definitions remain available in metadata even though the alpha Inspector currently presents only the compact summary.

## Performance boundary

The alpha loads one metadata snapshot per connection. Catalog queries are batched rather than issued once per object, but very large databases or routine bodies can still produce a large IPC payload. QueryX will move to schema/object lazy loading when observed metadata latency, definition bytes, or payload size crosses the boundary in [ADR-0004](decisions/ADR-0004-additive-relation-metadata.md).

## Troubleshooting

- Missing objects usually indicate database catalog visibility or account permissions.
- Refresh currently happens when connecting; reconnect after creating or dropping an object outside QueryX.
- An empty Indexes tab means the driver reported no physical indexes for that table.
- Incoming relationships are derived from catalog-visible tables. Database permissions can make the list incomplete.
- Routine definitions are reconstructed by PostgreSQL; compare semantics rather than original whitespace or comments.
- Metadata failure does not change database permissions or execute user SQL. Correct the connection privileges and reconnect.

## Related

- [Driver API](driver-api.md)
- [SQLite Driver](sqlite-driver.md)
- [PostgreSQL Driver](postgres-driver.md)
- [Architecture](architecture.md)
