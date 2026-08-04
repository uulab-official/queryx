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

## Current alpha — v0.1 foundation

Available and tested:

- [x] Tauri 2 desktop shell with React, TypeScript, Rust, and SQLx
- [x] Driver-neutral contracts and capability discovery
- [x] Native SQLite and PostgreSQL connection/query/transaction paths
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

- Query tabs, history, and favorites use best-effort browser-local persistence in the preview; native workspace persistence is still pending.
- Passwords are intentionally session-only until OS keychain support lands.
- Result rows are loaded into memory; virtualized streaming and server paging are not implemented.
- Safety analysis is lexical, not yet parser/plan backed.
- GitHub Release packaging and signed OTA verification are wired; the first production release still requires repository updater secrets and platform signing/notarization credentials.

## v0.2 — Daily query workflow

Goal: make SQLite and PostgreSQL reliable for sustained everyday query work.

- [ ] SQLite workspace storage for profiles, tabs, history, favorites, and settings
- [x] Browser-local query history and favorites with deduplication, recall, and command-palette actions; native SQLite migration remains planned
- [x] Confirmed local-history clearing with truthful empty-state behavior; favorites and tabs remain intact
- [x] Browser-local query-tab recovery with active-tab, dirty-state, and SQL restoration; native SQLite migration remains planned
- [ ] OS keychain integration with migration and deletion tests
- [ ] Connection test, duplicate, color, read-only mode, timeout, and keepalive controls
- [ ] SSH tunnel and PostgreSQL SSL certificate configuration
- [x] Conservative SQL formatter with literal/comment preservation; dialect-aware parser and diagnostics remain planned
- [x] Non-executing EXPLAIN plan result viewer with capability gating and cancellation/history reuse
- [ ] EXPLAIN ANALYZE with explicit execution warning and database-specific cost controls
- [ ] Virtualized result grid with incremental fetch, server paging, reorder/freeze
- [x] Result-grid column resizing with mouse and keyboard controls; virtualization, incremental fetch, server paging, reorder, and freeze remain planned
- [x] Cell/row/range copy, NULL display controls, and spreadsheet-safe TSV clipboard output
- [x] Client-side result pages up to 100 rows with local page navigation; streaming and server-side paging remain planned
- [x] JSON and SQL INSERT export with portable values, dialect-aware identifier quoting, transaction wrapper, and explicit target-table prompt; progress/cancel and advanced encoding controls remain planned
- [x] Metadata for views, indexes, and primary keys
- [x] Composite foreign keys with outgoing/incoming relationship navigation
- [x] PostgreSQL functions/procedures with overload-safe selection and read-only DDL inspection
- [x] PostgreSQL/SQLite relation triggers with status, events, owner navigation, and read-only DDL
- [x] Direct object dependencies with Depends on / Used by navigation and overload-safe PostgreSQL trigger-function edges
- [x] PostgreSQL database-scoped event triggers with tags, activation status, function navigation, and reconstructed DDL
- [x] PostgreSQL aggregates/window functions with catalog-specific Inspector metadata
- [x] DDL Inspector handoff to editable SQL tabs with explicit transaction execution, rollback-on-error, and metadata refresh
- [ ] Schema-aware DDL diff, object-specific preview, and migration history
- [x] Searchable command palette and Quick Open for core query/editor/result actions; complete keyboard map and full accessibility audit remain planned
- [x] Inspector close behavior, modal Escape handling, and accessible labels for primary navigation controls

Release gates:

- A clean install can connect, reopen a workspace, run/cancel queries, inspect objects, and export 100,000 rows without data corruption.
- Secrets never enter workspace SQLite, logs, crash reports, frontend storage, or exported settings.
- SQLite and PostgreSQL pass the same versioned driver contract suite.

## v0.3 — Safe data and schema operations

Goal: support production-oriented work without turning mistakes into incidents.

- [ ] Explicit auto-commit state and begin/commit/rollback controls
- [ ] Editable result rows with key detection, staged diff, validation, and generated SQL preview
- [ ] Parser-backed destructive-statement analysis and database-backed affected-row estimates
- [ ] Read-only connection enforcement in both UI and Rust execution layer
- [ ] Table data editor with filters, ordering, pagination, and optimistic conflict detection
- [ ] Object creation/editing for tables, columns, indexes, views, and constraints
- [ ] Schema compare and migration SQL preview with dependency ordering
- [ ] Session audit trail stored locally with configurable retention and redaction
- [ ] Backup/export warning flows before high-risk schema operations

Release gates:

- Every data mutation has an inspectable SQL representation and an explicit commit boundary.
- Failure and cancellation tests prove rollback semantics for each supported driver.
- Schema changes are previewable and never silently executed from comparison output.

## v0.5 — Broad database IDE coverage

Goal: cover the database families and power workflows expected from a general-purpose IDE.

- [ ] MySQL and MariaDB drivers
- [ ] SQL Server driver
- [ ] Oracle driver and Oracle-specific object metadata
- [ ] ER diagram with selective loading for large schemas
- [ ] Data compare and controlled synchronization scripts
- [ ] Import wizard for CSV/JSON with type mapping, preview, errors, and transaction batches
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
