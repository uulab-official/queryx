# Metadata Explorer

QueryX loads a driver-neutral snapshot of accessible schemas, tables, views, columns, primary-key markers, and indexes. Database-specific catalog queries remain inside the SQLite and PostgreSQL drivers.

## Browse relations

Expand **Schemas**, choose a schema, and open its **Tables** or **Views** group. Selecting a table or view updates the Inspector without executing SQL.

The Inspector shows:

- ordered column names and database-reported types;
- primary-key markers for table columns;
- estimated table row count when the driver provides it;
- view definition when the catalog exposes it;
- table index name, ordered key columns, access method, and primary/unique badges.

View and table names are also available to Monaco metadata completion.

## Driver behavior

### SQLite

QueryX excludes internal `sqlite_%` objects. It reads tables and views from `sqlite_master`, then uses table-valued PRAGMA queries to collect columns and indexes in batches. SQLite auto-indexes may not include a SQL definition. An `INTEGER PRIMARY KEY` aliases the rowid and may not appear as a separate index.

### PostgreSQL

QueryX excludes `pg_catalog`, `information_schema`, and TOAST schemas. It combines `information_schema` relation data with `pg_catalog` index metadata. Estimated row counts come from PostgreSQL catalog statistics and can differ from an exact `COUNT(*)`.

Expression index entries use the database-rendered expression when no physical column name exists. Partial index predicates and complete definitions remain available in metadata even though the alpha Inspector currently presents only the compact summary.

## Performance boundary

The alpha loads one metadata snapshot per connection. Catalog queries are batched rather than issued once per table, but very large databases can still produce a large IPC payload. QueryX will move to schema/relation lazy loading when observed metadata latency or payload size crosses the boundary in [ADR-0004](decisions/ADR-0004-additive-relation-metadata.md).

## Troubleshooting

- Missing objects usually indicate database catalog visibility or account permissions.
- Refresh currently happens when connecting; reconnect after creating or dropping an object outside QueryX.
- An empty Indexes tab means the driver reported no physical indexes for that table.
- Metadata failure does not change database permissions or execute user SQL. Correct the connection privileges and reconnect.

## Related

- [Driver API](driver-api.md)
- [SQLite Driver](sqlite-driver.md)
- [PostgreSQL Driver](postgres-driver.md)
- [Architecture](architecture.md)
