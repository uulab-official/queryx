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
- Native SQLx PostgreSQL driver with SSL modes, transactions, normalized values, and catalog metadata.
- Local-only PostgreSQL/SQLite connection dialog; session passwords are never persisted.
- Dynamic result columns, PostgreSQL type labels, schema-aware Explorer nodes, and unsupported-type warnings.
- Monaco SQL editor with syntax highlighting, metadata-aware completion, cursor/selection status, and lazy loading.
- Multi-tab query documents with independent Monaco models, undo history, dirty state, keyboard creation/closing, and selected-SQL execution.
- Capability-driven PostgreSQL query cancellation with AbortSignal, Escape/toolbar controls, an isolated cancellation pool, and race-condition tests.
- Native and browser CSV export for the visible result set with deterministic escaping, UTF-8 BOM output, and spreadsheet-formula injection protection.
- Open-source project handbook: getting started, results/export, troubleshooting, contribution, conduct, and security documentation plus issue and pull request templates.
- Least-privilege GitHub Actions with web quality gates and Linux, macOS, and Windows native build/test coverage.
- Competitive, acceptance-gated roadmap toward a production database IDE.
- Driver-neutral Views Explorer and table Indexes Inspector backed by batched SQLite/PostgreSQL catalog metadata.
- Bidirectional foreign-key Inspector with composite column pairing, referential actions, and live PostgreSQL contract coverage.
- Overload-safe PostgreSQL function/procedure Explorer, read-only database-rendered DDL Inspector, routine completion, and SQLite's explicit empty routine contract.
- Driver-neutral PostgreSQL/SQLite Trigger Explorer with activation modes, timing/events, owner navigation, conditions, and read-only DDL.
- Driver-owned direct dependency graph with indexed Depends on / Used by navigation for foreign keys, view references, trigger functions, and trigger owners.
- PostgreSQL database-scoped Event Trigger Explorer with command tags, activation status, routine dependencies, and catalog-reconstructed read-only DDL.
- PostgreSQL aggregate and window-function Explorer entries with overload-safe identity, aggregate mode/direct-argument metadata, and read-only catalog safety boundaries.
- Safe DDL workflow: Copy DDL, Edit in SQL handoff, explicit Run in Transaction execution, rollback-on-error behavior, and metadata refresh recovery.
- Real non-executing EXPLAIN plan action for PostgreSQL/SQLite capability-aware connections, with single-statement validation, cancellation, history, and result-grid reuse.
- Result-grid cell, row, and range selection with Cmd/Ctrl+C clipboard export, visible-result copy, and configurable NULL display.
- Safe baseline SQL formatter that preserves quoted literals, identifiers, and comments while laying out common clauses.
- Searchable Cmd/Ctrl+K command palette for running, explaining, formatting, filtering, metadata refresh, and connection actions.
- Local query favorites with save/remove toggle, sidebar recall, SQL deduplication, empty-query protection, and command-palette actions.

## [0.1.0] — 2026-08-03

### Added

- Initial QueryX UI prototype and local-first product documentation.
- pnpm workspace with `apps/desktop`, `packages/shared`, and `packages/core`.
- Shared `DatabaseDriver`, metadata, and `QueryResult` contracts.
- Deterministic in-memory PostgreSQL-shaped driver for UI development.
- React/Vite desktop workflow with Explorer, editor, results, and Inspector panels.
