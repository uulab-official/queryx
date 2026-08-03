# ADR-0009: Model event triggers as database-scoped objects

- Status: accepted
- Date: 2026-08-03

## Context

PostgreSQL event triggers observe database-level DDL events and execute event-trigger functions. They do not belong to a schema or relation. QueryX already models relation triggers as schema-level objects and dependencies as typed object references. Three designs were considered:

1. Add a required top-level `eventTriggers` collection and connection-root Explorer group.
2. Merge event triggers into `triggers` by adding a scope discriminator.
3. Add a PostgreSQL-only lazy command and UI path.

Merging the object types would make relation ownership, timing, row orientation, and event-trigger tags conditionally valid throughout the existing contract. A vendor-specific lazy path would break the eager snapshot and driver-neutral rendering patterns before the measured migration boundary is reached.

## Decision

Add required `DatabaseMetadata.eventTriggers`. Unsupported drivers return an empty array. `EventTriggerMetadata` contains an opaque snapshot ID, name, normalized event, activation status, optional command tags, overload-safe routine reference, and nullable catalog-reconstructed definition.

Event triggers appear under the database connection root, not inside Schemas. `DatabaseObjectKind` adds `eventTrigger`, and `DatabaseObjectRef.schema` becomes nullable so database-scoped objects use `null` without inventing a pseudo-schema. The dependency graph adds `eventTriggerFunction` edges.

PostgreSQL supplies identifier and literal quoting for reconstructed DDL. The UI labels this text catalog-reconstructed and never executes it automatically.

## Consequences

- Relation-trigger contracts stay strict and unchanged.
- Database scope is explicit in shared TypeScript and Rust models.
- Function navigation reuses routine OIDs and remains overload safe.
- SQLite proves compatibility by returning `eventTriggers: []`.
- The eager snapshot adds one batched catalog query and one dependency edge per event trigger.
- Definition reconstruction does not retain comments, original formatting, or activation-alter statements.
- Editing remains deferred until permission checks, generated-SQL preview, confirmation, transaction limits, and recovery behavior are designed.
