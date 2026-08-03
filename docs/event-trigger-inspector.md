# Event Trigger Inspector

## What it does

QueryX lists PostgreSQL event triggers under the connection-level **Event Triggers** group. Event triggers observe database-wide DDL events, so they are intentionally separated from schema-level relation triggers.

Selecting an event trigger shows its activation status, event, optional command-tag filter, execution function, direct dependency edge, and catalog-reconstructed DDL for inspection.

## Quick start

1. Connect to PostgreSQL and expand the connection root.
2. Open **Event Triggers** and select an item.
3. Review the event and command tags before changing related database objects.
4. Select the function link or dependency row to open its overload-safe routine Inspector.
5. Use **Copy DDL** when needed, or **Edit in SQL** to open a separate review tab. QueryX never inserts or executes the text automatically.

SQLite returns an empty event-trigger collection, so no synthetic objects are shown.

## Events and activation

QueryX normalizes PostgreSQL events as follows:

| Inspector label | PostgreSQL catalog value |
| --- | --- |
| DDL command start | `ddl_command_start` |
| DDL command end | `ddl_command_end` |
| SQL drop | `sql_drop` |
| Table rewrite | `table_rewrite` |

Activation uses the same PostgreSQL modes as relation triggers: `origin`, `replica`, `always`, and `disabled`. A disabled event trigger remains visible because it can still affect operational expectations and future deployments.

An empty Tags field means all commands supported by that event are eligible. A non-empty list is the exact `WHEN TAG IN (...)` filter reported by PostgreSQL.

## Identity and dependencies

Event triggers are database-scoped and therefore have `schema: null` in `DatabaseObjectRef`. Selection resolves through an opaque snapshot ID. The execution function uses its PostgreSQL routine OID, schema, name, and identity arguments, matching the existing overload-safe Routine Explorer.

The dependency graph adds one `eventTriggerFunction` edge from the event trigger to its function. The function Inspector consequently lists the event trigger under **Used by**.

## DDL boundary

PostgreSQL does not provide the same complete deparser used for relation triggers. QueryX reconstructs `CREATE EVENT TRIGGER` from catalog values. PostgreSQL itself quotes the trigger name, function identifiers, and tag literals; QueryX assembles those quoted values into read-only SQL.

Activation state is displayed separately and is not appended as an automatic `ALTER EVENT TRIGGER` statement. Original comments and formatting are unavailable.

## Safety and privacy

Event triggers can affect DDL across the complete database. This alpha feature has no object-specific create, alter, enable, disable, or drop controls. **Edit in SQL** is a safe handoff to the normal SQL editor; review the reconstructed statement and use **Run in Transaction** explicitly. Metadata and function bodies remain between the database, local native process, and local UI.

Use a least-privilege account. Catalog visibility and the ability to create event triggers are controlled by PostgreSQL, not bypassed by QueryX.

## Troubleshooting

- **The group is empty:** the database has no visible event triggers, the driver is SQLite, or catalog access is restricted.
- **The function cannot be opened:** it is outside the loaded routine catalog. The dependency remains visible but navigation reports the missing object.
- **Status is disabled:** the object exists but PostgreSQL will not fire it until explicitly enabled outside this read-only Inspector.
- **Copied DDL differs from source:** QueryX reconstructs canonical SQL from catalog values; comments and original whitespace are not retained.
- **Changes made elsewhere are missing:** use **Refresh metadata** to reload the eager metadata snapshot.

## Related

- [Trigger Inspector](trigger-inspector.md)
- [Dependency Inspector](dependency-inspector.md)
- [PostgreSQL Driver](postgres-driver.md)
- [ADR-0009](decisions/ADR-0009-database-scoped-event-triggers.md)
