# ADR-0002: Use a driver-neutral native registry

- Status: Accepted
- Date: 2026-08-03

## Context

The first native implementation exposed SQLite-specific registry types and command names. Adding PostgreSQL in that shape would require changes in command handlers and frontend IPC call sites, spreading vendor awareness beyond the driver boundary.

## Decision

Define an object-safe async Rust `DatabaseDriver` trait and store implementations as `Arc<dyn DatabaseDriver>` in `DriverRegistry`. Keep vendor selection in the connection factory only. Expose generic Tauri commands for connection lifecycle, execution, transactions, and metadata.

## Consequences

- SQLite, PostgreSQL, and MySQL share one command surface.
- The frontend chooses a driver when connecting but does not branch for query results or metadata.
- Native drivers can share a registry-level contract test suite.
- New capabilities must be reported explicitly instead of inferred from a vendor name.
- The factory still needs one new constructor branch for each compiled-in driver.
