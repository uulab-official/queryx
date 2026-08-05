# Database IDE Parity Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move QueryX from an alpha query shell toward a verifiable database IDE that can compete with DBeaver, pgAdmin, phpMyAdmin, and SQL Developer by closing complete workflows rather than accumulating isolated controls.

**Architecture:** Keep the driver-neutral TypeScript/Rust boundary and make each product area a vertical slice with a user workflow, native enforcement, deterministic tests, documentation, and a release gate. Database-specific behavior stays in native drivers and is exposed to the UI through capabilities and connection state. The first slice adds a read-only connection mode enforced by SQLite/PostgreSQL, surfaced in the connection manager and result editor, with transaction state kept explicit rather than inferred from a single query wrapper.

**Tech Stack:** React 18, TypeScript, Zustand, Tauri 2, Rust, SQLx 0.8, Vitest, Rust tests, Biome, GitHub Actions.

## Global Constraints

- Supported database behavior must remain behind `DatabaseDriver`, `DriverConfig`, `ConnectionSummary`, and capability contracts.
- Passwords and secrets must never enter profiles, workspace snapshots, history, favorites, logs, exports, or test fixtures.
- Native read-only mode must be enforced by the database connection/runtime, not only by disabled buttons.
- Browser preview must remain deterministic and must mirror the native contract without claiming to be a real database connection.
- Every vertical slice requires TypeScript tests, Rust tests when native behavior changes, documentation, roadmap status, and a passing no-bundle Tauri build.
- Do not claim DBeaver/phpMyAdmin/pgAdmin/SQL Developer parity until the release gates in this plan have evidence.

## Product parity map

The program is split into independent release tracks. Each track must be usable end-to-end before the next one is treated as complete.

1. **Safe operations (v0.2):** saved connections, read-only enforcement, explicit auto-commit/transaction state, rollback recovery, session-only secrets, and native workspace migration.
2. **Large data workflow (v0.3):** virtualized rows, server-side paging, cancel/progress, column pinning/reorder, table editor filters, imports, and export formats.
3. **Schema workflow (v0.4):** create/edit/drop object forms, schema diff, dependency-ordered migration preview, migration history, ERD, and rollback guidance.
4. **Database breadth (v0.5):** MySQL/MariaDB, Oracle, SQL Server, SSH tunnels, PostgreSQL certificates, capability matrix, and driver contract suites.
5. **Operational IDE (v0.6+):** session/lock explorer, query plans, diagnostics, crash recovery, accessibility audit, plugin boundary, signed installers, and release support policy.

The safe-operations track is implemented and verified. The large-data track is now active; the remaining tracks are intentionally listed as separate deliverables so one green UI panel cannot be mistaken for product parity.

---

### Task 1: Add the read-only connection contract

**Files:**
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/core/src/inMemoryDriver.ts`
- Modify: `apps/desktop/src/nativeDriver.ts`
- Test: `apps/desktop/src/store.test.ts`

**Interfaces:**
- Add `readOnly?: boolean` to `DriverConfig`.
- Add `readOnly: boolean` to `ConnectionProfile`.
- Add `readOnly: boolean` to the native `ConnectionSummary` contract consumed by `TauriDatabaseDriver.connect()`.
- Add `isReadOnly(): boolean` to `DatabaseDriver` so the UI cannot infer policy from vendor names.

- [ ] **Step 1: Write the failing contract tests**

Add tests that connect an `InMemoryDriver` with `{ readOnly: true }`, assert `driver.isReadOnly()` is true, and assert a write-shaped statement is rejected while a `SELECT` remains executable. Add a store test that a read-only connection leaves `canEditResults` false after connection state is applied.

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `pnpm test -- apps/desktop/src/store.test.ts`

Expected: FAIL because the shared driver contract has no read-only state.

- [ ] **Step 3: Implement the shared and preview contract**

Store the flag on `InMemoryDriver`, return it from `isReadOnly()`, and reject mutations in the preview with a stable error message. Pass `readOnly` across `TauriDatabaseDriver.connect()` and return the native summary value instead of guessing in React.

- [ ] **Step 4: Run the focused tests and typecheck**

Run: `pnpm test -- apps/desktop/src/store.test.ts && pnpm typecheck`

Expected: PASS with the original query/store tests unchanged and the new read-only tests green.

- [ ] **Step 5: Commit the contract slice**

```bash
git add packages/shared/src/index.ts packages/core/src/inMemoryDriver.ts apps/desktop/src/nativeDriver.ts apps/desktop/src/store.test.ts
git commit -m "feat: add read-only driver contract"
```

### Task 2: Enforce read-only in native SQLite and PostgreSQL

**Files:**
- Modify: `apps/desktop/src-tauri/src/models.rs`
- Modify: `apps/desktop/src-tauri/src/driver_registry.rs`
- Modify: `apps/desktop/src-tauri/src/sqlite_driver.rs`
- Modify: `apps/desktop/src-tauri/src/postgres_driver.rs`
- Modify: `apps/desktop/src-tauri/src/driver.rs`
- Test: `apps/desktop/src-tauri/src/sqlite_driver.rs`
- Test: `apps/desktop/src-tauri/src/driver_registry.rs`

**Interfaces:**
- `ConnectionConfig.read_only: bool` is passed into both native constructors.
- `ConnectionSummary.read_only` reports the enforced mode.
- SQLite uses SQLx pool `after_connect` to set `PRAGMA query_only = ON` for every pooled connection; the seeded `:memory:` fixture is populated before enabling the pragma.
- PostgreSQL adds `default_transaction_read_only=on` to `PgConnectOptions` when enabled, including the cancellation pool’s cloned options.
- The native tests execute a write against an isolated test database and assert failure in read-only mode, then confirm normal `SELECT` metadata still works.

- [ ] **Step 1: Add native failing tests**

Extend the SQLite registry contract test with a read-only configuration, execute `UPDATE orders SET status = 'blocked'`, expect an error, then select the row and assert its value is unchanged. Add a summary assertion for `read_only == true`.

- [ ] **Step 2: Run the native test and confirm failure**

Run: `PATH="/Users/uulab/.cargo/bin:$PATH" cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml driver_registry::tests::sqlite_read_only_rejects_writes`

Expected: FAIL until the config reaches the driver and the pool policy is enabled.

- [ ] **Step 3: Implement SQLite enforcement**

Pass the flag through `DriverRegistry::connect`, configure `SqlitePoolOptions::after_connect` for file-backed pools, seed the in-memory fixture before enabling `PRAGMA query_only`, store the mode on `SqliteDriver`, and expose it through the summary/driver contract.

- [ ] **Step 4: Implement PostgreSQL enforcement**

Apply `options([("default_transaction_read_only", "on")])` to the connect options before creating both the execution and cancellation pools. Keep the existing cancellation state machine unchanged.

- [ ] **Step 5: Run all native verification**

Run: `PATH="/Users/uulab/.cargo/bin:$PATH" cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check && cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`

Expected: PASS with the existing 19 native tests plus the new enforcement cases.

- [ ] **Step 6: Commit the native enforcement slice**

```bash
git add apps/desktop/src-tauri/src/models.rs apps/desktop/src-tauri/src/driver_registry.rs apps/desktop/src-tauri/src/sqlite_driver.rs apps/desktop/src-tauri/src/postgres_driver.rs apps/desktop/src-tauri/src/driver.rs
git commit -m "feat: enforce native read-only connections"
```

### Task 3: Make read-only mode a complete connection-manager workflow

**Files:**
- Modify: `apps/desktop/src/store.ts`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/connectionProfiles.ts`
- Modify: `apps/desktop/src/connectionProfiles.test.ts`
- Modify: `apps/desktop/src/styles.css`
- Modify: `docs/connections.md`
- Modify: `docs/results.md`
- Modify: `ROADMAP.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- The connection dialog includes a `Read-only session` toggle and persists that boolean in secret-free profiles.
- The store exposes `readOnlyConnection: boolean` and updates it only after a successful connection summary.
- Result editing, edit staging, and `Review & Apply` are disabled with an actionable message when the active connection is read-only.
- The status bar and connection selector show a `READ ONLY` badge; switching profiles resets the previous policy only after the replacement connection succeeds.

- [ ] **Step 1: Add UI/store failing tests**

Test profile normalization round-trips `readOnly: true`, test a failed replacement preserves the previous read-only state, and test a successful normal profile clears the badge.

- [ ] **Step 2: Implement profile and store state**

Add the boolean to profile serialization, build `DriverConfig.readOnly`, consume `ConnectionSummary.readOnly`, and preserve the current connection on failed replacement as before.

- [ ] **Step 3: Implement the editor safety boundary**

Make `canEditResults` require `!readOnlyConnection`, clear staged edits when the mode changes, disable edit/apply controls, and add the badge/copy in the status bar and connection dialog.

- [ ] **Step 4: Update docs and roadmap**

Document that read-only is enforced by the database connection, not only by UI state. Mark the roadmap item complete only after native tests prove both SQLite and PostgreSQL behavior.

- [ ] **Step 5: Run the full frontend and repository gates**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm verify && git diff --check`

Expected: PASS with no secret-bearing fixtures and no changed release metadata.

- [ ] **Step 6: Commit the end-to-end safety slice**

```bash
git add apps/desktop/src/store.ts apps/desktop/src/App.tsx apps/desktop/src/connectionProfiles.ts apps/desktop/src/connectionProfiles.test.ts apps/desktop/src/styles.css docs/connections.md docs/results.md ROADMAP.md CHANGELOG.md
git commit -m "feat: ship read-only connection workflow"
```

### Task 4: Establish the next parity gates without fake completion

**Files:**
- Modify: `ROADMAP.md`
- Modify: `README.md`
- Modify: `docs/README.md`
- Create: `docs/parity-matrix.md`
- Create: `docs/decisions/ADR-0014-database-ide-parity-gates.md`

- [x] **Step 1: Write the capability matrix**

For each of DBeaver, pgAdmin, phpMyAdmin, and SQL Developer, map QueryX workflows to `available`, `partial`, or `planned`; include evidence links to tests or user docs. Do not use a marketing percentage.

- [x] **Step 2: Define release gates for the next three tracks**

Require a reproducible large-result benchmark, schema diff preview with rollback SQL, and a driver contract suite before marking those tracks complete.

- [x] **Step 3: Add the matrix to the docs index and roadmap**

Make the matrix the source of truth for parity claims and link it from README and ROADMAP.

- [x] **Step 4: Run link/format checks and commit the evidence docs**

Run: `pnpm format:check && pnpm verify`

```bash
git add README.md ROADMAP.md docs/README.md docs/parity-matrix.md docs/decisions/ADR-0014-database-ide-parity-gates.md
git commit -m "docs: add database ide parity gates"
```

### Task 5: Ship the first large-data grid slice

**Files:**
- Create: `apps/desktop/src/resultGrid.ts`
- Test: `apps/desktop/src/resultGrid.test.ts`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/styles.css`
- Modify: `docs/results.md`
- Modify: `ROADMAP.md`
- Modify: `CHANGELOG.md`

- [x] Add a bounded virtual row window with overscan and top/bottom scroll spacers.
- [x] Preserve global logical row indices for selection and clipboard ranges while only mounting rows near the viewport.
- [x] Keep arbitrary-query results honest: virtualization reduces DOM work, loaded pages remain in memory, and non-pageable SQL falls back to the normal driver path.
- [x] Add deterministic boundary tests for small sets, large-set windows, and end-of-list clamping.
- [x] Add conservative dialect-aware server paging for single SELECT/WITH queries, original-SQL history preservation, and incremental result-grid loading.
- [x] Add metadata-safe table-browser server filtering/sorting with deterministic primary-key tie-breakers and literal wildcard escaping.
- [ ] Add streamed driver cursors, progress/cancellation telemetry, and server-side filtering for arbitrary queries in the next large-data slices.

### Task 6: Ship the initial MySQL/MariaDB breadth slice and evidence matrix

**Files:**
- Create: `apps/desktop/src-tauri/src/mysql_driver.rs`
- Create: `docs/mysql-driver.md`
- Create: `docs/parity-matrix.md`
- Create: `docs/decisions/ADR-0014-database-ide-parity-gates.md`
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/store.ts`
- Modify: `ROADMAP.md`
- Modify: `README.md`

- [x] Implement native SQLx MySQL/MariaDB connect, query, transaction, disconnect, and basic information_schema metadata paths.
- [x] Connect MySQL/MariaDB to the saved profile and connection dialog flow with native read-only enforcement and capability gating.
- [x] Add deterministic Rust/TypeScript coverage and an opt-in live MySQL contract test that never embeds credentials.
- [x] Document supported scope and limitations instead of claiming complete MySQL/MariaDB parity.
- [x] Add the evidence-gated DBeaver/pgAdmin/phpMyAdmin/SQL Developer capability matrix and ADR.
- [x] Add MySQL/MariaDB foreign keys, routines, and relation triggers; event triggers, streaming, cancellation, SSH/certificate configuration, and hosted integration coverage remain pending.

### Task 7: Ship the first schema-compare slice

**Files:**
- Create: `packages/core/src/schemaDiff.ts`
- Test: `packages/core/src/schemaDiff.test.ts`
- Create: `docs/schema-compare.md`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/styles.css`
- Modify: `ROADMAP.md`

- [x] Compare session-local metadata baselines for tables, columns, and indexes.
- [x] Generate PostgreSQL/MySQL migration preview SQL and mark SQLite column alterations for manual review.
- [x] Add Explorer and command-palette actions without automatic execution; open preview in a normal SQL tab.
- [x] Add deterministic tests and document destructive/dependency-ordering limitations.
- [x] Add same-dialect cross-connection compare using temporary read-only metadata connections.
- [x] Add foreign-key/view diffing, dialect-aware SQL/manual-review markers, and deterministic create/remove object-category ordering.
- [x] Add metadata dependency-graph ordering and reverse rollback SQL preview with manual-review fallbacks.
- [x] Add driver-specific read-only privilege preflight SQL and local preview history with forward/rollback recall.
- [x] Add explicit transactional apply, applied-status confirmation, and native durable migration history in the app-local workspace snapshot.

### Task 8: CSV import vertical slice

- [x] Parse quoted CSV with headers, multiline cells, duplicate/width validation, and row-level errors.
- [x] Map CSV columns to table metadata types and generate dialect-aware INSERT batches.
- [x] Add desktop file picker, mapping controls, five-row preview, read-only gating, and transactional execution.
- [x] Add deterministic tests and document transforms/progress as remaining scope.
- [x] Extend the same wizard to JSON arrays/NDJSON and driver-specific ignore-conflict SQL.
- [x] Add mapped conflict-key selection and dialect-specific transactional upsert SQL with unique-index warnings.

### Task 9: Deliver the first ERD exploration slice

- [x] Build a deterministic bounded graph from table/view metadata, foreign keys, and direct view dependencies.
- [x] Add command-palette access, search, zoom, keyboard navigation, and click-through to the Inspector.
- [x] Document the 120-relation bound and keep lazy loading, layout persistence, export, and editing as planned scope.

### Task 10: Deliver the first object-specific DDL form

- [x] Add a validated table creation plan for PostgreSQL, MySQL/MariaDB, and SQLite with quoted identifiers and composite primary keys.
- [x] Add command-palette access, editable column rows, SQL preview, explicit transaction apply, read-only gating, and metadata refresh.
- [x] Document the table-form boundary while keeping alteration, drop, view, index, and constraint forms planned.
- [x] Add selected-table add-column form with duplicate/type validation, dialect-aware ALTER TABLE preview, explicit transaction apply, and metadata refresh.
- [x] Add selected-table type/nullability editing and non-primary-key drop planning with PostgreSQL/MySQL execution and SQLite manual-review boundaries.
- [x] Add selected-table ordered index-create form with UNIQUE support, validation, redundancy warnings, SQL preview, and explicit apply.
- [x] Add selected-table regular index-drop form with dialect-aware SQL and primary-index manual-review protection.
- [x] Add metadata-aware view-create form with SELECT/WITH-only validation, duplicate-name checks, dialect-aware SQL preview, explicit transaction apply, read-only gating, and metadata refresh.
- [x] Add selected-view alter/drop forms with dependency warnings, dialect-specific replacement SQL, explicit transaction batches, read-only gating, and metadata refresh.
- [x] Add selected-table named foreign-key add/drop forms with composite-column mapping, referential-action validation, dialect-aware SQL, SQLite manual-review boundaries, and metadata refresh.

## Final verification for this plan

Run all of the following before calling the first safety track complete:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm verify
PATH="/Users/uulab/.cargo/bin:$PATH" pnpm check:native
PATH="/Users/uulab/.cargo/bin:$PATH" pnpm test:native
PATH="/Users/uulab/.cargo/bin:$PATH" pnpm --filter @queryx/desktop tauri build --no-bundle
git diff --check
```

The first track is complete only when the native binary builds, read-only writes fail at the database/runtime layer, failed reconnection preserves the active session, and the documentation matrix does not call partial workflows complete.
