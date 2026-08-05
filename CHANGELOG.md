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
- PostgreSQL/MySQL/MariaDB TLS profile configuration with verify-CA/verify-full modes and CA, client certificate, and client key file paths.
- Open-source release and OTA operations guide covering updater secrets, key rotation, platform signing boundaries, and rollback.
- QueryX visual identity refresh with a reusable vector icon system, branded query mark, and regenerated desktop/mobile platform icon assets.
- Refined the app mark into a quieter neon Q-lens with a single orbit accent for clearer recognition at small sizes.
- Added local JSON and SQL INSERT exports with an explicit target table, dialect-aware identifier quoting, replayable transaction wrapper, and 40 serialization tests.
- Added result-grid column resizing with mouse drag handles and keyboard sizing controls for denser IDE-style data inspection.
- Added keyed result-cell editing for SQLite/PostgreSQL with staged local diffs, generated UPDATE preview, explicit transaction apply, and post-write refresh.
- Added incremental 100-row table browsing with deterministic primary-key ordering and local result-page append.
- Added optimistic edit conflict detection using original-value predicates, per-row affected-row verification, and atomic native batch rollback before refreshing results.
- Added explicit native transaction sessions across SQLite, PostgreSQL, and MySQL/MariaDB with held-connection reuse for queries, streams, and edit batches, plus Begin/Commit/Rollback controls and visible auto-commit state.
- Added bounded 256-row result streaming for SQLite alongside the existing PostgreSQL/MySQL/MariaDB streaming contract; SQLite correctly remains non-cancellable.
- Added optional native OS-keychain password storage for connection profiles with platform credential-store routing, profile presence markers, deletion on profile removal, and browser-preview non-persistence tests.
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
- Added a bounded ERD explorer with deterministic table/view layout, foreign-key and view-reference edges, relation filtering, zoom, keyboard navigation, and Inspector click-through.
- Added explicit transactional schema migration apply with executable-statement batching, applied-status confirmation, and native workspace persistence for the migration ledger.
- Added a validated table-creation form with dialect-aware quoting, composite primary keys, SQL preview, and explicit transaction apply.
- Added an add-column form for selected tables with duplicate/type validation, dialect-aware ALTER TABLE SQL, preview, and explicit transaction apply.
- Added selected-table column editing for PostgreSQL/MySQL/MariaDB type/nullability changes and non-primary-key drops, with SQLite manual-review gating.
- Added selected-table index creation with ordered columns, UNIQUE support, duplicate/missing-column validation, redundancy warnings, and explicit transaction apply.
- Added selected-table regular index deletion with dialect-aware SQL and primary-index protection.
- Added a validated view-creation form for single SELECT/WITH definitions with duplicate-name, delimiter, comment, and mutating-query guards, SQL preview, explicit transaction apply, and metadata refresh.
- Added selected-view definition editing and deletion with PostgreSQL/MySQL replacement SQL, SQLite drop/create review warnings, dependency-aware drop warnings, explicit transaction batches, and metadata refresh.
- Added named foreign-key add/drop forms with composite-column mapping, referential-action validation, PostgreSQL/MySQL SQL generation, and SQLite/manual-rebuild protection.
- Added import upsert with mapped conflict-key selection, unique-index warnings, PostgreSQL/SQLite/MySQL conflict SQL, and a single-statement transaction path that preserves MySQL affected-row semantics.
- Added metadata-safe table-browser filtering and sorting with dialect-aware literal search patterns, deterministic primary-key tie-breakers, and protection against paging with unapplied order changes.
- Added guarded selected-row deletion from the table browser with SQL preview, primary-key/original-value conflict predicates, exact affected-row verification, and atomic rollback.
- Added a default-aware table-browser new-row form with typed Value/NULL/Default modes, dialect-specific INSERT generation, SQL preview, exact affected-row verification, and refresh.
- Added conservative dialect-aware server paging for single SELECT/WITH results, 100-row incremental loading, original-SQL history preservation, and fallback for mutation, locking, or multi-statement queries.
- Added PostgreSQL cursor-backed result streaming with 256-row Tauri event chunks, incremental grid accumulation, cancellation cleanup, and capability-gated UI actions; later entries extend the same result contract to MySQL/MariaDB and SQLite.
- Added MySQL/MariaDB cursor-backed result streaming and active-query cancellation through a local `KILL QUERY` control connection, with capability-gated Stream/Cancel actions and optional live contract coverage.
- Added SQLite row-stream result delivery in bounded 256-row chunks; SQLite intentionally remains non-cancellable while sharing the native Stream result contract.

## [0.1.0] — 2026-08-03

### Added

- Initial QueryX UI prototype and local-first product documentation.
- pnpm workspace with `apps/desktop`, `packages/shared`, and `packages/core`.
- Shared `DatabaseDriver`, metadata, and `QueryResult` contracts.
- Deterministic in-memory PostgreSQL-shaped driver for UI development.
- React/Vite desktop workflow with Explorer, editor, results, and Inspector panels.
