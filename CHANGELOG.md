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

## [0.1.0] — 2026-08-03

### Added

- Initial QueryX UI prototype and local-first product documentation.
- pnpm workspace with `apps/desktop`, `packages/shared`, and `packages/core`.
- Shared `DatabaseDriver`, metadata, and `QueryResult` contracts.
- Deterministic in-memory PostgreSQL-shaped driver for UI development.
- React/Vite desktop workflow with Explorer, editor, results, and Inspector panels.
