# ADR-0008: Return a driver-owned object dependency snapshot

- Status: accepted
- Date: 2026-08-03

## Context

QueryX needs database-IDE-grade **Depends on / Used by** navigation across tables, views, routines, and triggers. Existing metadata is loaded as one driver-neutral snapshot. Foreign keys and trigger owners can be derived from existing values, but PostgreSQL view rewrite dependencies and trigger-function OIDs require catalog knowledge. Three options were considered:

1. Drivers return one normalized top-level dependency collection.
2. The frontend derives common edges while drivers return vendor-specific extras.
3. The Inspector requests dependencies lazily for every selected object.

Splitting edge ownership would make a snapshot semantically incomplete. Per-object lookup would introduce N+1 catalog traffic, caching, cancellation, and stale-selection states before catalog size requires lazy loading.

## Decision

Add required `DatabaseMetadata.dependencies`. Each driver returns all dependency edges it can support for the loaded snapshot. An edge contains an opaque ID, normalized kind, dependent object reference, and referenced object reference. Direction always means `dependent → referenced`.

PostgreSQL returns foreign-key, trigger-owner, trigger-function, and direct view-reference edges. SQLite returns foreign-key and trigger-owner edges and does not parse view SQL heuristically. The frontend core builds incoming and outgoing maps once and the UI remains vendor neutral.

Relations resolve by kind/schema/name. Routines and triggers resolve by opaque snapshot IDs; routine references also carry identity arguments so overloads remain distinct. Snapshot IDs are not durable database identifiers.

## Consequences

- One metadata refresh produces a coherent, testable graph with no per-selection catalog query.
- Driver contract tests can prove direction, type, and overload identity.
- The payload grows linearly with visible direct edges.
- Drivers construct some edges from metadata they already own, which intentionally duplicates a small amount of mapping code.
- Permissions can produce an incomplete visible graph, and SQLite view dependencies remain unavailable by design.
- If measured catalog size makes eager snapshots too expensive, a future schema-scoped API must preserve the same edge model and explicit completeness semantics.
