# QueryX Testing Guide

## Test layers

QueryX uses a small, explicit test pyramid:

1. **Contract tests** validate driver behavior that every database implementation must provide.
2. **Core unit tests** validate query safety, metadata mapping, result normalization, and transaction behavior.
3. **Type checks** prevent the UI, shared contracts, and driver packages from drifting apart.
4. **Formatting and lint checks** keep the TypeScript/React source deterministic and catch unsafe patterns.
5. **Production build checks** verify that the desktop frontend can be bundled from a clean install.
6. **Native matrix checks** test and build Tauri on Linux, macOS, and Windows.
7. **Live PostgreSQL contract checks** execute catalog, query, and cancellation behavior against a disposable PostgreSQL service.
8. **Manual smoke checks** cover the high-value UI path: connect state → run query → filter/sort result → export → inspect table/routine.
9. **Browser workflow checks** cover Monaco load, query-tab creation/switching/closing, document preservation, and keyboard execution.

The desktop preview also has a Safe Mode smoke path: replace the editor query with an UPDATE or DELETE without WHERE, press Cmd/Ctrl+Enter, confirm the warning, then choose Cancel, Run in Transaction, or Execute Anyway. This is a UI contract preview; native transaction semantics belong to the Rust driver.

The editor smoke path creates a second query with Cmd/Ctrl+T, enters distinct SQL in both tabs, switches between them, and confirms that each document and its undo history remain independent. Selecting SQL before Cmd/Ctrl+Enter must execute only the selection; with no selection it executes the complete active document.

## Local commands

```bash
pnpm install
pnpm run verify
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm --filter @queryx/desktop tauri build --no-bundle
```

`pnpm run verify` checks version alignment, required open-source project files, and local Markdown links. GitHub Actions runs the web gates on Ubuntu 22.04 and native tests/builds on Ubuntu 22.04, macOS 15, and Windows 2025. A separate Ubuntu job runs live PostgreSQL contract tests against PostgreSQL 17. Rust formatting and Clippy run once on Linux; native tests and the no-bundle Tauri build run on every platform.

CSV unit tests cover column order, control-character escaping, NULL handling, UTF-8 BOM output, object serialization, and spreadsheet-formula protection. The manual export smoke test filters and sorts a result, exports it, opens the CSV in a text editor and spreadsheet, and confirms that the visible row order and count match without evaluating formula-like cells.

The PostgreSQL contract test is environment-selective. Set `QUERYX_TEST_POSTGRES_DATABASE` plus any required host, port, username, and password variables before `cargo test` to exercise a live disposable server. The harness verifies result normalization, real server cancellation of `pg_sleep(10)` within three seconds, composite foreign-key metadata, and overload-safe function/procedure DDL metadata. When the database variable is absent, no external connection is attempted and the offline suite remains deterministic. See [PostgreSQL Driver](postgres-driver.md).

## Driver contract checklist

Every driver must test:

- connect success and actionable connection failure
- execute success with normalized columns and rows
- execution time, affected rows, warnings, and error shape
- cancellation behavior
- cancel-before-start, duplicate cancel, completion/cancel races, and unsupported-driver capability behavior
- metadata for databases, schemas, tables, columns, indexes, views, composite foreign keys, and explicit routines arrays
- overloaded function identity, procedure/null return behavior, TABLE returns, and read-only database-rendered DDL where supported
- transaction success, rollback on failure, and disconnect cleanup
- capability reporting without vendor checks in the UI

## Safety checks

The query safety analyzer is intentionally conservative. It flags UPDATE and DELETE statements without a WHERE clause and does not attempt to estimate rows. The production Rust layer must use a parser or database-backed plan before showing an affected-row estimate.

No test fixture may contain real credentials, production connection strings, or personal data. Use synthetic database names and deterministic rows.
