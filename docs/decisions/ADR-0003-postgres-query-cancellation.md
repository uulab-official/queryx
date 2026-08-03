# ADR-0003: Use a driver-owned PostgreSQL cancellation control plane

- Status: Accepted
- Date: 2026-08-03

## Context

QueryX needs cancellation that stops work on the database server, not only a renderer promise. SQLx 0.8 keeps PostgreSQL backend keys internally and does not expose a public protocol cancellation token. Cancelling a Tokio task alone can leave the server query running. Calling `pg_cancel_backend` through the main pool can deadlock when every pooled connection is busy, and a late PID-based cancellation can target a later query if the execution connection is returned too early.

## Decision

Keep cancellation behind the object-safe `DatabaseDriver` contract and identify every execution with a random UUID. The frontend first calls `prepare_query`, then executes with the same UUID and maps `AbortSignal` to `cancel_query`. This two-phase protocol closes the cancel-before-registration race.

The PostgreSQL driver owns a pending/running/cancelling/cancelled/finished state machine per UUID. It captures `pg_backend_pid()` from the checked-out execution connection and sends a parameterized `pg_cancel_backend($1)` through a separate lazy pool limited to one control connection. If cancellation starts as execution finishes, the execution connection remains checked out until the control request completes. No SQL, password, or backend secret is stored in the active-query map.

SQLite does not advertise `cancel` and returns an explicit unsupported error.

## Alternatives considered

1. Abort only the Tokio task. Rejected because dropping a future does not provide a user-visible guarantee that PostgreSQL stopped the statement.
2. Use a SQLx PostgreSQL cancel token. Preferred in principle, but SQLx 0.8 has no public API for it.
3. Call `pg_cancel_backend` through the normal pool. Rejected because pool saturation can prevent the cancellation command from obtaining a connection.

## Consequences

- PostgreSQL cancellation reaches the server and remains available even when the execution pool is saturated.
- PostgreSQL authorization remains authoritative; cancellation can fail when server policy rejects it.
- The extra control pool can consume one additional PostgreSQL connection when first used.
- UUID preparation and state synchronization add lifecycle complexity, covered by unit tests and an environment-selective live `pg_sleep` test.
- A future SQLx release exposing protocol cancel tokens can replace the control query inside the PostgreSQL driver without changing the frontend contract.
