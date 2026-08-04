# QueryX Product Roadmap

QueryX aims to become a daily-driver, local-first database IDE: fast enough for routine querying, safe enough for production access, and extensible enough to replace a broad database client for most developer workflows. This roadmap is ordered by user value and release evidence, not by UI mockups.

## Product bar

A serious alternative to DBeaver or SQL Developer must cover six workflows well:

1. Reliable connections across common databases, tunnels, TLS, and credentials.
2. A low-latency SQL editor with dialect intelligence and explain tooling.
3. A result grid that remains usable on large datasets and exports exactly what users see.
4. Deep metadata navigation, object inspection, DDL, and dependency discovery.
5. Safe data editing, transactions, schema comparison, and auditable local history.
6. Stable installers, upgrades, diagnostics, accessibility, and extension boundaries.

QueryX differentiates through a smaller local-first security boundary, modern editor behavior, explicit destructive-query safeguards, and an open driver/plugin contract.

Parity claims are tracked in the [database IDE capability matrix](docs/parity-matrix.md); QueryX does not claim full DBeaver, pgAdmin, phpMyAdmin, or SQL Developer equivalence until the matrix release gates are evidenced.

## Current alpha — v0.1 foundation

Available and tested:

- [x] Tauri 2 desktop shell with React, TypeScript, Rust, and SQLx
- [x] Driver-neutral contracts and capability discovery
- [x] Native SQLite, PostgreSQL, and initial MySQL/MariaDB connection/query/transaction paths
- [x] PostgreSQL TLS modes and server-side query cancellation
- [x] Schema/table/column metadata Explorer
- [x] View Explorer and table index inspection across SQLite/PostgreSQL
- [x] Monaco SQL editor, metadata completion, multi-tab models, selected SQL execution
- [x] Dynamic result table, JSON view, local filter and sort
- [x] Native CSV save with UTF-8 BOM, escaping, visible-row semantics, and formula-injection protection
- [x] UPDATE/DELETE-without-WHERE interception and transaction execution option
- [x] Deterministic frontend tests and native driver contract tests
- [x] Linux/macOS/Windows CI definitions and repository documentation harness

Known alpha limitations:

- Native desktop now restores tabs, history, favorites, and secret-free connection profiles from versioned app-local snapshots; browser preview remains localStorage-backed. Native SQLite migration, settings, and cross-profile workspaces remain pending.
- Passwords are intentionally session-only until OS keychain support lands.
- Result rows are loaded into memory by page; the desktop grid now virtualizes large loaded sets and server-pages single SELECT/WITH queries, while streaming cursors and server-side filtering are not implemented.
- Safety analysis is lexical, not yet parser/plan backed.
- GitHub Release packaging and signed OTA verification are wired; the first production release still requires repository updater secrets and platform signing/notarization credentials.

## v0.2 — Daily query workflow

Goal: make SQLite and PostgreSQL reliable for sustained everyday query work.

- [ ] SQLite workspace storage for profiles, tabs, history, favorites, and settings
- [x] Versioned native workspace snapshot with browser migration, tab/history/favorite recovery, and no-secret persistence; SQLite migration remains planned
- [x] Secret-free connection profile lifecycle with native app-local persistence, duplicate/delete actions, and explicit connection testing; SQLite workspace migration remains planned
- [x] Browser-local query history and favorites with deduplication, recall, and command-palette actions; native SQLite migration remains planned
- [x] Confirmed local-history clearing with truthful empty-state behavior; favorites and tabs remain intact
- [x] Browser-local query-tab recovery with active-tab, dirty-state, and SQL restoration; native SQLite migration remains planned
- [ ] OS keychain integration with migration and deletion tests
- [x] Connection test and duplicate/delete profile actions with active-connection preservation
- [ ] Profile color, timeout, and keepalive controls
- [x] Read-only connection enforcement in native SQLite/PostgreSQL pools and the result-editor UI; PostgreSQL live integration coverage remains part of the external driver matrix
- [ ] SSH tunnel and PostgreSQL SSL certificate configuration
- [x] Conservative SQL formatter with literal/comment preservation; dialect-aware parser and diagnostics remain planned
- [x] Non-executing EXPLAIN plan result viewer with capability gating and cancellation/history reuse
- [ ] EXPLAIN ANALYZE with explicit execution warning and database-specific cost controls
- [x] Virtualized result grid for large loaded sets with bounded DOM rows, overscan, global selection indices, scroll spacers, and conservative 100-row server paging for single SELECT/WITH queries; streaming and server-side filtering remain planned
- [x] Result-grid column resizing with mouse and keyboard controls; incremental fetch, server paging, reorder, and freeze remain planned
- [x] Keyed table browser incremental fetch in 100-row pages with deterministic primary-key ordering; arbitrary-query server paging remains planned
- [x] Cell/row/range copy, NULL display controls, and spreadsheet-safe TSV clipboard output
- [x] Client-side result pages up to 100 rows with local page navigation for loaded results; larger loaded results use the virtualized grid, while streaming and server-side filtering remain planned
- [x] JSON and SQL INSERT export with portable values, dialect-aware identifier quoting, transaction wrapper, and explicit target-table prompt; progress/cancel and advanced encoding controls remain planned
- [x] Metadata for views, indexes, and primary keys
- [x] Composite foreign keys with outgoing/incoming relationship navigation
- [x] PostgreSQL functions/procedures with overload-safe selection and read-only DDL inspection
- [x] PostgreSQL/SQLite relation triggers with status, events, owner navigation, and read-only DDL
- [x] Direct object dependencies with Depends on / Used by navigation and overload-safe PostgreSQL trigger-function edges
- [x] PostgreSQL database-scoped event triggers with tags, activation status, function navigation, and reconstructed DDL
- [x] PostgreSQL aggregates/window functions with catalog-specific Inspector metadata
- [x] DDL Inspector handoff to editable SQL tabs with explicit transaction execution, rollback-on-error, and metadata refresh
- [x] Session-local and same-dialect cross-connection schema compare with dependency-ordered table/column/index/FK/view migration, rollback SQL preview, driver-specific privilege preflight, explicit transactional apply, native applied history, local preview history, and manual-review markers; object-specific forms remain planned
- [x] Searchable command palette and Quick Open for core query/editor/result actions; complete keyboard map and full accessibility audit remain planned
- [x] Inspector close behavior, modal Escape handling, and accessible labels for primary navigation controls

Release gates:

- A clean install can connect, reopen a workspace, run/cancel queries, inspect objects, and export 100,000 rows without data corruption.
- Secrets never enter workspace SQLite, logs, crash reports, frontend storage, or exported settings.
- SQLite and PostgreSQL pass the same versioned driver contract suite.

## v0.3 — Safe data and schema operations

Goal: support production-oriented work without turning mistakes into incidents.

- [ ] Explicit auto-commit state and begin/commit/rollback controls
- [x] Keyed result-cell editing with staged local diffs, original-value predicates, affected-row conflict detection, atomic native batch rollback, explicit transaction apply, and refresh; stronger table identity/validation remains planned
- [ ] Parser-backed destructive-statement analysis and database-backed affected-row estimates
- [x] Read-only connection enforcement in both UI and Rust execution layer; explicit transaction state remains separate work
- [ ] Table data editor with filters, ordering, pagination, and optimistic conflict detection
- [x] Table creation, add-column, type/nullability/non-PK-drop, ordered UNIQUE/non-unique index-create, regular index-drop, and view create/alter/drop forms with validation, SQL preview, explicit transaction apply, driver-aware manual review, dependency warnings, and metadata refresh; rename/index-alter/constraint forms remain planned
- [x] Schema compare applied-migration confirmation and native durable migration history on top of the metadata dependency graph, privilege preflight, and forward/rollback preview; object-specific DDL forms remain planned
- [ ] Session audit trail stored locally with configurable retention and redaction
- [ ] Backup/export warning flows before high-risk schema operations

Release gates:

- Every data mutation has an inspectable SQL representation and an explicit commit boundary.
- Failure and cancellation tests prove rollback semantics for each supported driver.
- Schema changes are previewable and never silently executed from comparison output.

## v0.5 — Broad database IDE coverage

Goal: cover the database families and power workflows expected from a general-purpose IDE.

- [x] MySQL/MariaDB connection, query execution, transactions, read-only guard, and tables/views/columns/index/foreign-key/routine/trigger metadata; event triggers, streaming, cancellation, and integration matrix remain planned
- [ ] SQL Server driver
- [ ] Oracle driver and Oracle-specific object metadata
- [x] Bounded deterministic ERD for visible tables/views with FK and view-dependency edges, search, zoom, and Inspector navigation; selective lazy loading, layout persistence, export, and editing remain planned
- [ ] Data compare and controlled synchronization scripts
- [x] CSV/JSON import wizard with header/type mapping, preview, validation errors, transactional batches, and ignore-conflict policy; transforms, update/upsert, and progress remain planned
- [ ] Excel and Markdown export
- [ ] Query performance diagnostics, lock/session explorer, and long-running query controls
- [ ] Driver SDK, compatibility matrix, and community driver certification tests
- [ ] Theme tokens and stable commands/menus/panels extension points

Release gates:

- Driver-specific features are capability based; unsupported controls never appear as broken UI.
- Large metadata catalogs and million-row workflows have documented performance budgets.
- Each database has containerized or hosted integration coverage for supported versions.

## v1.0 — Stable open ecosystem

- [ ] Signed and notarized installers for macOS, Windows, and Linux packages
- [x] Secure automatic updates with signature verification, GitHub Release publishing, and rollback guidance; production secret provisioning remains an operational gate
- [ ] Stable storage migrations, driver API, plugin API, and deprecation policy
- [ ] Crash recovery for tabs, transactions, and workspace state
- [ ] Public threat model, independent security review, and vulnerability response SLA
- [ ] WCAG-oriented keyboard/screen-reader audit
- [ ] Diagnostics bundle with opt-in, redacted local logs; no mandatory telemetry
- [ ] Plugin registry proposal, package signing, permissions, and isolation model
- [ ] Release notes, upgrade guide, support matrix, and long-term maintenance policy

## Continuous quality gates

Every milestone must keep these green:

- TypeScript strict checks, Biome formatting/linting, unit tests, and production frontend build
- Rust formatting, Clippy with warnings denied, unit/integration tests, and native no-bundle builds
- Linux, macOS, and Windows CI
- Version alignment and Markdown link verification
- Driver contract, cancellation/race, transaction rollback, and credential-boundary tests
- User docs, troubleshooting, changelog, and ADR updates for changed behavior

## Prioritization rules

1. Protect user data and credentials.
2. Make the core connect → edit → run → inspect → export loop fast and reliable.
3. Put database differences behind capabilities instead of vendor checks in the UI.
4. Measure completion with repeatable tests and documented recovery paths.
5. Add extension surface only after its security and compatibility boundaries are stable.
