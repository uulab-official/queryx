# QueryX Testing Guide

## Test layers

QueryX uses a small, explicit test pyramid:

1. **Contract tests** validate driver behavior that every database implementation must provide.
2. **Core unit tests** validate query safety, metadata mapping, result normalization, and transaction behavior.
3. **Type checks** prevent the UI, shared contracts, and driver packages from drifting apart.
4. **Formatting and lint checks** keep the TypeScript/React source deterministic and catch unsafe patterns.
5. **Production build checks** verify that the desktop frontend can be bundled from a clean install.
6. **Native matrix checks** test and build Tauri on Linux, macOS, and Windows.
7. **Live database contract checks** execute PostgreSQL behavior against a disposable service and optionally exercise MySQL/MariaDB when the corresponding environment is available.
8. **Manual smoke checks** cover the high-value UI path: connect state → run a SELECT returning more than 100 rows → confirm only the first page loads, use **Load next 100**, and verify rows append without changing the editor SQL or history entry → filter/sort/copy result → export CSV/JSON/SQL INSERT → import a typed CSV into a selected table and confirm batch rollback behavior → open Create table, Add column, Edit columns, Create index, Drop index, or Create view from the command palette, preview SQL, apply a disposable change, and refresh metadata → inspect and navigate object dependencies.
9. **Browser workflow checks** cover Monaco load, query-tab creation/switching/closing, document preservation, and keyboard execution.

The desktop preview also has a Safe Mode smoke path: replace the editor query with an UPDATE or DELETE without WHERE, press Cmd/Ctrl+Enter, confirm the warning, then choose Cancel, Run in Transaction, or Execute Anyway. This is a UI contract preview; native transaction semantics belong to the Rust driver.

The editor smoke path creates a second query with Cmd/Ctrl+T, enters distinct SQL in both tabs, switches between them, and confirms that each document and its undo history remain independent. Selecting SQL before Cmd/Ctrl+Enter must execute only the selection; with no selection it executes the complete active document. The browser smoke path also clicks **Explain**, confirms a plan result and the non-execution toast, and verifies the action is disabled when the driver lacks `explain`. The DDL smoke path selects a routine or trigger, confirms **Edit in SQL** creates a new tab without a result, verifies **Run in Transaction** is available, and uses **Refresh metadata** after the definition changes.

The formatter smoke path enters a query containing a quoted value with repeated spaces and a comment containing SQL keywords, chooses **Format**, and confirms those protected sections are unchanged while clauses are laid out.

The command-palette smoke path opens Cmd/Ctrl+K, filters for **Format SQL**, runs it with Enter, then opens the palette again and uses ArrowDown/ArrowUp plus Enter to run a selected action. Escape and clicking the backdrop must close the palette without changing SQL.

The workspace smoke path saves the active query with the ♡ button, confirms the filled-heart state and a new **Favorites** entry, recalls that entry without executing it, then removes it and confirms the empty state. It repeats the save/remove flow through Cmd/Ctrl+K and verifies that whitespace-only SQL is rejected.

The Quick Open smoke path opens Cmd/Ctrl+P or the Explorer search icon, confirms that favorites and recent queries are listed, filters by a SQL fragment, opens the matching entry with Enter, and verifies that the SQL is loaded without a new result execution. Escape and backdrop click must close Quick Open without changing the active SQL.

The workspace recovery smoke path creates a second tab, enters distinct SQL, reloads the preview or restarts the native desktop, and confirms tabs, active-tab selection, dirty state, history, and favorites are restored without rerunning the previous query or repopulating the result grid. On first native startup after the feature, a valid browser snapshot is migrated once into the app-local workspace boundary.

The result-grid smoke path clicks a cell, Shift-clicks another cell, presses Cmd/Ctrl+C, and pastes into a spreadsheet or plain-text editor to verify rectangular TSV output. It repeats the check with a row-number selection and the **NULL** display toggle, resizes a column by mouse and keyboard, then confirms Copy uses only the current filtered/sorted page when no range is selected, page navigation resets after filtering/sorting, and Export includes all loaded filtered/sorted rows. For a keyed table, it uses **Browse data**, loads another 100 rows, stages a non-key edit, confirms the generated UPDATE preview contains original-value predicates, verifies Cancel and Discard do not write, and applies the change only through the explicit native edit-batch transaction. Native contract tests also force a conflict and verify the entire SQLite batch rolls back.

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

CSV/JSON/SQL export unit tests cover column order, control-character escaping, NULL handling, UTF-8 BOM output, BigInt/date normalization, identifier quoting, transaction wrapping, object serialization, and spreadsheet-formula protection. The manual export smoke test filters and sorts a result, exports each format, opens the files in a text editor, and confirms that the visible row order and count match without evaluating formula-like cells or executing generated SQL.

The PostgreSQL contract test is environment-selective. Set `QUERYX_TEST_POSTGRES_DATABASE` plus any required host, port, username, and password variables before `cargo test` to exercise a live disposable server. The MySQL/MariaDB contract is separately enabled with `QUERYX_TEST_MYSQL_DATABASE` and its optional host, port, username, and password variables; it verifies a read-only health query and native write rejection. When database variables are absent, no external connection is attempted and the offline suite remains deterministic. See [PostgreSQL Driver](postgres-driver.md) and [MySQL/MariaDB Driver](mysql-driver.md).

## Driver contract checklist

Every driver must test:

- connect success and actionable connection failure
- connection-manager profile save, duplicate, delete, isolated test, and reconnect flow; assert password fields are absent from persisted profile data
- execute success with normalized columns and rows
- execution time, affected rows, warnings, and error shape
- cancellation behavior
- cancel-before-start, duplicate cancel, completion/cancel races, and unsupported-driver capability behavior
- metadata for databases, schemas, tables, columns, indexes, views, composite foreign keys, functions/procedures/aggregates/window functions, relation/event triggers, and typed direct dependencies; unsupported MySQL/MariaDB catalogs must remain explicitly empty
- dependency direction, incoming/outgoing indexing, overload identity, and explicit unsupported catalog behavior
- PostgreSQL event-trigger event/tag/status normalization, catalog-reconstructed DDL, database scope, and function navigation
- real SQLite and PostgreSQL trigger ownership, timing/events, activation status, conditions, and DDL
- overloaded function identity, procedure/null return behavior, TABLE returns, and read-only database-rendered DDL where supported
- transaction success, rollback on failure, and disconnect cleanup
- capability reporting without vendor checks in the UI

## Safety checks

The query safety analyzer is intentionally conservative. It flags UPDATE and DELETE statements without a WHERE clause and does not attempt to estimate rows. The production Rust layer must use a parser or database-backed plan before showing an affected-row estimate.

No test fixture may contain real credentials, production connection strings, or personal data. Use synthetic database names and deterministic rows.
