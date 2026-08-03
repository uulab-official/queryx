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
- [x] Monaco SQL editor, metadata completion, multi-tab models, selected SQL execution
- [x] Dynamic result table, JSON view, local filter and sort
- [x] Native CSV save with UTF-8 BOM, escaping, visible-row semantics, and formula-injection protection
- [x] UPDATE/DELETE-without-WHERE interception and transaction execution option
- [x] Deterministic frontend tests and native driver contract tests
- [x] Linux/macOS/Windows CI definitions and repository documentation harness

Known alpha limitations:

- Connection profiles, query history, and favorites are not yet persisted in the native workspace database.
- Passwords are intentionally session-only until OS keychain support lands.
- Result rows are loaded into memory; virtualized streaming and server paging are not implemented.
- Safety analysis is lexical, not yet parser/plan backed.
- Installers are not yet signed or published.

## v0.2 — Daily query workflow

Goal: make SQLite and PostgreSQL reliable for sustained everyday query work.

- [ ] SQLite workspace storage for profiles, tabs, history, favorites, and settings
- [ ] OS keychain integration with migration and deletion tests
- [ ] Connection test, duplicate, color, read-only mode, timeout, and keepalive controls
- [ ] SSH tunnel and PostgreSQL SSL certificate configuration
- [ ] Dialect-aware parser, formatter, diagnostics, snippets, and function completion
- [ ] EXPLAIN / EXPLAIN ANALYZE plan viewer with explicit execution warning
- [ ] Virtualized result grid with incremental fetch, server paging, resize/reorder/freeze
- [ ] Cell/row/range copy, NULL display controls, and binary/JSON viewers
- [ ] JSON and SQL INSERT export; progress, cancel, encoding, delimiter, and line-ending controls
- [ ] Complete metadata for views, indexes, primary/foreign keys, routines, and DDL
- [ ] Command palette, Quick Open, complete keyboard map, and accessibility baseline

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
- [ ] Secure automatic updates with rollback guidance
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
