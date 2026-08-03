# Dependency Inspector

## What it does

QueryX exposes direct object dependencies in a vendor-neutral **Depends on / Used by** graph. The graph answers two common database-IDE questions without executing user SQL:

- What must exist for this object to work?
- What visible objects could be affected if this object changes?

Dependency rows are navigable. Select a row to open the referenced table, view, routine, or trigger in the same Inspector.

## Quick start

1. Connect to SQLite or PostgreSQL.
2. Select a table or view and open **Dependencies** in the Inspector.
3. Review **Depends on** for outgoing edges and **Used by** for incoming edges.
4. Select an edge to navigate to the other object.

Routine and trigger Inspectors show the same two groups directly below their object details.

## Edge semantics

Every edge points from the dependent object to the object it references.

| Kind | Dependent | Referenced | Drivers |
| --- | --- | --- | --- |
| Foreign key | Source table | Target table | SQLite, PostgreSQL |
| View reference | View | Table or view used by its rewrite rule | PostgreSQL |
| Trigger function | Relation trigger | Invoked trigger function | PostgreSQL |
| Trigger owner | Relation trigger | Owning table or view | SQLite, PostgreSQL |
| Event trigger function | Database event trigger | Invoked event-trigger function | PostgreSQL |

Edges are direct, not a computed transitive closure. For example, if `monthly_sales` reads `paid_orders` and `paid_orders` reads `orders`, QueryX reports two direct edges rather than inventing a third `monthly_sales → orders` edge.

Foreign keys also remain available in the table **Relations** tab, where QueryX can show ordered column pairs and referential actions. The dependency graph provides the cross-object overview; it does not replace constraint detail.

## Identity and snapshot rules

`DatabaseMetadata.dependencies` is part of the eager connection snapshot. Each edge has an opaque snapshot ID, a typed dependent reference, a typed referenced reference, and a normalized kind.

- Tables and views resolve by `kind + schema + name`.
- Routines, relation triggers, and event triggers resolve by opaque snapshot ID.
- Database-scoped event triggers use `schema: null`; schema objects always carry a schema.
- Routine references include identity arguments for overload-safe display.
- IDs must not be stored as durable database identifiers across reconnects.

The core package builds incoming and outgoing maps once per snapshot, so Inspector navigation does not issue one catalog query per selected object.

## Driver coverage

### PostgreSQL

QueryX reads direct view dependencies from `pg_rewrite` and `pg_depend`, relation-trigger functions from `pg_trigger.tgfoid`, event-trigger functions from `pg_event_trigger.evtfoid`, and preserves PostgreSQL OIDs only as opaque identities for the active snapshot. System, TOAST, and temporary schemas are excluded.

### SQLite

QueryX reports foreign-key and trigger-owner edges. SQLite does not expose a reliable catalog dependency graph for arbitrary view SQL, so QueryX intentionally does not guess view references by parsing `sqlite_master.sql`.

## Safety and privacy

Dependency discovery performs read-only catalog queries and local indexing. It does not execute displayed DDL, mutate objects, upload metadata, or send database names to a QueryX service. Catalog visibility follows the connected account's database permissions.

## Troubleshooting

- **An expected object is missing:** reconnect after external schema changes and confirm the account can see both endpoints.
- **A row cannot be opened:** the edge can reference an object outside the loaded catalog. QueryX keeps the edge but reports that navigation is unavailable.
- **SQLite view dependencies are empty:** this is an explicit driver limitation, not a metadata failure.
- **A PostgreSQL function looks duplicated:** routines are overload-safe; compare the identity arguments shown after the name.

## Related

- [Metadata Explorer](metadata-explorer.md)
- [Driver API](driver-api.md)
- [ADR-0008](decisions/ADR-0008-driver-owned-dependency-snapshot.md)
- [Testing Guide](testing.md)
