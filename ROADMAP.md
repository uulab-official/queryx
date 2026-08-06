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

- Native desktop now restores tabs, history, favorites, redacted session audit observations, and secret-free connection profiles from versioned SQLite workspace storage; browser preview remains localStorage-backed. Settings namespaces, named workspaces, and crash-recovery journals remain pending.
- Native desktop passwords can be saved in the platform OS keychain; profile files retain only a `passwordStored` marker. Browser preview remains session-only.
- Result rows are loaded into memory by page or stream; the desktop grid virtualizes large loaded sets, server-pages safe SELECT/WITH queries with database-side filter/sort, and all native drivers can stream 256-row chunks. Disk spill/backpressure and deterministic tie-breakers for arbitrary projections remain pending.
- Safety analysis is lexical, not yet parser/plan backed.
- GitHub Release packaging and signed OTA verification are wired; the first production release still requires repository updater secrets and platform signing/notarization credentials.

## v0.2 — Daily query workflow

Goal: make SQLite and PostgreSQL reliable for sustained everyday query work.

- [x] SQLite workspace storage for secret-free profiles, tabs, history, favorites, migration history, and redacted session audit observations; settings namespaces and named workspaces remain planned
- [x] Versioned native SQLite workspace snapshot with browser/legacy JSON migration, tab/history/favorite recovery, WAL-backed atomic writes, and no-secret persistence
- [x] Secret-free connection profile lifecycle with native SQLite persistence, duplicate/delete actions, and explicit connection testing; settings and cross-profile workspace migration remain planned
- [x] Browser-local query history and favorites with deduplication, recall, and command-palette actions; native SQLite storage is the desktop path
- [x] Confirmed local-history clearing with truthful empty-state behavior; favorites and tabs remain intact
- [x] Browser-local query-tab recovery with active-tab, dirty-state, and SQL restoration; native SQLite recovery is the desktop path
- [x] OS keychain integration for macOS Keychain, Windows Credential Manager, and Linux Secret Service with profile marker, delete, duplicate, and browser-boundary tests
- [x] Connection test and duplicate/delete profile actions with active-connection preservation
- [ ] Profile color, timeout, and keepalive controls
- [x] Read-only connection enforcement in native SQLite/PostgreSQL pools and the result-editor UI; PostgreSQL live integration coverage remains part of the external driver matrix
- [x] PostgreSQL/MySQL/MariaDB SSL modes with CA, client certificate, and client key file paths plus native OpenSSH local tunnels
- [x] Conservative SQL formatter with literal/comment preservation; dialect-aware parser and diagnostics remain planned
- [x] Non-executing EXPLAIN plan result viewer with capability gating and cancellation/history reuse
- [ ] EXPLAIN ANALYZE with explicit execution warning and database-specific cost controls
- [x] Virtualized result grid for large loaded sets with bounded DOM rows, overscan, global selection indices, scroll spacers, 100-row server paging with database-side filter/sort for safe SELECT/WITH queries and table browsing, and all native drivers' cursor-backed 256-row result streaming; progress telemetry and disk spill/backpressure remain planned
- [x] Result-grid column resizing with mouse and keyboard controls; incremental fetch, server paging, reorder, and freeze remain planned
- [x] Keyed table browser incremental fetch in 100-row pages with deterministic primary-key ordering, dialect-aware server filtering/sorting, literal wildcard escaping, and unapplied-order protection; safe arbitrary SELECT/WITH server paging and filter/sort are also available
- [x] Cell/row/range copy, NULL display controls, and spreadsheet-safe TSV clipboard output
- [x] Client-side result pages up to 100 rows with local page navigation for loaded results; larger loaded results use the virtualized grid, safe SELECT/WITH queries can apply database-side filter/sort, and all native drivers can append cursor chunks
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

- [x] Explicit auto-commit state and native begin/commit/rollback controls across SQLite, PostgreSQL, and MySQL/MariaDB; the held connection is reused by queries and edit batches
- [x] Keyed table-browser data editing with staged cell updates, default-aware row insertion, selected-row deletion, original-value predicates, affected-row conflict detection, atomic native batch rollback, explicit preview/apply, and refresh; stronger arbitrary-query table identity/validation remains planned
- [ ] Parser-backed destructive-statement analysis and database-backed affected-row estimates
- [x] Read-only connection enforcement in both UI and Rust execution layer; explicit transaction state is visible in the status bar and command palette
- [x] Table data editor with filters, ordering, pagination, keyed cell updates, default-aware row insertion, guarded selected-row deletion, and optimistic conflict detection; arbitrary-query table identity remains planned
- [x] Table creation, add-column, column rename, type/nullability/non-PK-drop, ordered UNIQUE/non-unique index-create, named UNIQUE/CHECK constraint create, regular index-drop, guarded index rename, named foreign-key add/drop, and view create/alter/drop forms with validation, SQL preview, explicit transaction apply, driver-aware manual review, dependency warnings, and metadata refresh; broader index alteration forms remain planned
- [x] Schema compare applied-migration confirmation and native durable migration history on top of the metadata dependency graph, privilege preflight, and forward/rollback preview; object-specific DDL forms remain planned
- [x] Session audit trail stored locally with 0/1/7/30-day retention, 500-observation bound, literal/comment redaction, query-shape fingerprinting, workspace restore, and explicit clear
- [ ] Backup/export warning flows before high-risk schema operations

Release gates:

- Every data mutation has an inspectable SQL representation and an explicit commit boundary.
- Failure and cancellation tests prove rollback semantics for each supported driver.
- Schema changes are previewable and never silently executed from comparison output.

## v0.5 — Broad database IDE coverage

Goal: cover the database families and power workflows expected from a general-purpose IDE.

- [x] MySQL/MariaDB connection, query execution, transactions, read-only guard, and tables/views/columns/index/foreign-key/routine/trigger metadata, cursor-backed streaming, and active-query cancellation; event triggers and broader integration matrix remain planned
- [x] Initial SQL Server driver with SQL authentication, encrypted TDS/TLS connections, native 256-row streaming, explicit transactions, atomic edit batches, read-only enforcement, tables/views/columns/database/schema metadata, PK/index/composite-FK metadata, stored procedures/functions, relation triggers, SQL Server paging, bracket quoting, SSH-tunnel support, inspection-only sessions, and lock-wait graph; safe query cancellation, routine/trigger edit forms, richer view dependencies, and Windows/AAD authentication remain planned
- [x] Initial Oracle driver with service-name connections, TLS/CA/client-certificate paths, native 256-row streaming, explicit transactions, atomic edit batches, read-only enforcement, Oracle paging, users/tables/views/columns/database metadata, PK/index/composite-FK metadata, standalone/package routine signatures, table/view trigger inspection, and FK/trigger-owner dependency edges; SID/connect descriptors, wallet authentication, cancellation, sessions, locks, routine/trigger edit forms, and MERGE import modes remain planned
- [x] Bounded deterministic ERD for visible tables/views with FK and view-dependency edges, search, zoom, and Inspector navigation; selective lazy loading, layout persistence, export, and editing remain planned
- [x] Same-driver primary-key table Data Compare with bounded 10,000-row reads, selectable INSERT/UPDATE/DELETE preview, optimistic target-value predicates, read-only target guard, and transactional apply; multi-million-row, LOB-aware, cross-dialect, and multi-table synchronization remain planned
- [x] CSV/JSON import wizard with header/type mapping, preview, validation errors, transactional batches, ignore-conflict, and key-based upsert; transforms, progress, and resumable batches remain planned
- [x] CSV/JSON/SQL/Markdown export plus Excel-compatible typed SpreadsheetML export; true `.xlsx` packaging, workbook styling, and multi-sheet export remain planned
- [x] PostgreSQL/MySQL/MariaDB session explorer, point-in-time lock graph, threshold-based long-running query diagnostics, and redacted local session audit history with active/idle/waiting state, wait-event visibility, refresh, and safe query cancellation; server wait statistics remain planned
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
