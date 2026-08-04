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
- Quick Open query switcher with Cmd/Ctrl+P, Explorer search access, SQL/label filtering, favorite-first ordering, and non-executing recall.
- Browser-local query workspace recovery for up to 20 tabs, active-tab selection, dirty state, and SQL text after reload.
- Honest Safe Mode impact messaging without fabricated affected-row estimates, plus a confirmed local-history clear action and truthful empty history state.
- Functional Inspector close control, modal Escape handling, and accessible labels for primary navigation actions.
- Client-side result pagination with 100-row pages, filter/sort page reset, page-aware clipboard copy, and full filtered-result CSV export.
- Tauri signed updater integration with startup checks, one-click install/relaunch UX, and a cross-platform GitHub Actions release workflow that publishes `latest.json`.
- Open-source release and OTA operations guide covering updater secrets, key rotation, platform signing boundaries, and rollback.
- QueryX visual identity refresh with a reusable vector icon system, branded query mark, and regenerated desktop/mobile platform icon assets.
- Refined the app mark into a quieter neon Q-lens with a single orbit accent for clearer recognition at small sizes.
- Added local JSON and SQL INSERT exports with an explicit target table, dialect-aware identifier quoting, replayable transaction wrapper, and 40 serialization tests.
- Added result-grid column resizing with mouse drag handles and keyboard sizing controls for denser IDE-style data inspection.
- Added keyed result-cell editing for SQLite/PostgreSQL with staged local diffs, generated UPDATE preview, explicit transaction apply, and post-write refresh.
- Added incremental 100-row table browsing with deterministic primary-key ordering and local result-page append.
- Added optimistic edit conflict detection using original-value predicates, per-row affected-row verification, and atomic native batch rollback before refreshing results.
- Added a connection-manager vertical slice with secret-free native app-local profiles, browser fallback persistence, duplicate/delete actions, isolated connection tests, and session-only passwords.
- Added versioned native workspace snapshots for tabs, active documents, query history, and favorites, with browser-preview migration and no-query-execution recovery.
- Added read-only connection sessions with secret-free profile persistence, database/runtime enforcement for SQLite and PostgreSQL, and disabled result editing as a secondary UI guard.
- Added a bounded virtualized result grid for large loaded datasets, with overscan, scroll spacers, global selection/copy indices, and an explicit virtualized status hint.
- Added the initial native MySQL/MariaDB driver with SQLx query/transaction execution, read-only enforcement, common value normalization, and information_schema tables/views/columns/index metadata.
- Expanded MySQL/MariaDB metadata with foreign-key relationships, direct dependency edges, routines, and relation triggers.
- Added session-local schema compare with baseline capture, table/column/index diffing, dialect-aware migration preview SQL, destructive markers, and SQLite manual-review safeguards.
- Added same-dialect cross-connection schema comparison through temporary read-only metadata connections without replacing the active session.
- Expanded schema compare with foreign-key and view diffing, dialect-aware preview SQL, SQLite manual-review safeguards, and deterministic dependency-aware object-category ordering.
- Added metadata-graph ordering for dependent views/foreign keys and reverse rollback SQL preview in a normal editable SQL tab.
- Added driver-specific privilege preflight SQL and a local migration-preview ledger with forward, rollback, and preflight recall actions.
- Added a CSV import wizard with target/type mapping, typed validation, first-row preview, and transactional edit batches.
- Extended import to JSON arrays/NDJSON and driver-specific ignore-conflict policies.

## [0.1.0] — 2026-08-03

### Added

- Initial QueryX UI prototype and local-first product documentation.
- pnpm workspace with `apps/desktop`, `packages/shared`, and `packages/core`.
- Shared `DatabaseDriver`, metadata, and `QueryResult` contracts.
- Deterministic in-memory PostgreSQL-shaped driver for UI development.
- React/Vite desktop workflow with Explorer, editor, results, and Inspector panels.
