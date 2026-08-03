# Changelog

All notable QueryX changes are documented here. The project follows [Semantic Versioning](https://semver.org/) once the desktop runtime reaches its first public release.

## [Unreleased]

### Added

- CI verification harness for version alignment, documentation links, type checks, tests, and production builds.
- Driver safety inspection for UPDATE/DELETE statements without a WHERE clause.
- Tauri 2 native desktop shell with a typed frontend-to-Rust command bridge.
- SQLx SQLite driver for connection lifecycle, query execution, transactions, and table/column metadata.
- Native SQLite integration tests and a deterministic local demo database.
- Driver-neutral Rust `DatabaseDriver` trait, registry, generic Tauri commands, and reusable contract tests.

## [0.1.0] — 2026-08-03

### Added

- Initial QueryX UI prototype and local-first product documentation.
- pnpm workspace with `apps/desktop`, `packages/shared`, and `packages/core`.
- Shared `DatabaseDriver`, metadata, and `QueryResult` contracts.
- Deterministic in-memory PostgreSQL-shaped driver for UI development.
- React/Vite desktop workflow with Explorer, editor, results, and Inspector panels.
