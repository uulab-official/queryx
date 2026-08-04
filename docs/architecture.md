# QueryX Architecture

## Current implementation

The repository is a pnpm workspace with one app, its native runtime, and two shared packages:

```text
apps/desktop/       React + TypeScript + Vite UI
  src-tauri/        Tauri 2 + Rust + SQLx native runtime
packages/shared/    driver-neutral types and result contracts
packages/core/      driver implementations and database orchestration
```

The desktop app uses Zustand for UI state. The `InMemoryDriver` is a deterministic PostgreSQL-shaped browser fallback. The Tauri runtime uses production SQLx drivers for SQLite and PostgreSQL behind the same native trait and command API.

## Runtime boundary

The active native runtime is Tauri 2:

```text
React UI
  ↓ typed commands/events
Tauri bridge
  ↓
Rust core
  ├─ driver implementations (sqlx)
  ├─ local storage (SQLite)
  └─ OS keychain
```

The UI must never branch on database vendor details to render a result. Driver-specific behavior belongs behind `DatabaseDriver`, `DatabaseMetadata`, and `QueryResult` contracts. Safe Mode currently uses a shared conservative analyzer in the preview; the native layer must replace it with parser-backed analysis before production execution.

## State boundaries

- UI state: tabs, editor text, selected database object, result view, filters, running status, toasts.
- Driver state: connection lifecycle, query execution, metadata, transactions, capabilities.
- Local persistence: connections without secrets, tabs, history, favorites, settings, workspace indexes. The browser preview currently provides best-effort tab/history/favorite storage; native Tauri SQLite workspace migrations remain a v0.2 boundary.
- Secrets: OS keychain only; passwords are not written to SQLite or workspace files.

## Editor boundary

Each query tab owns a stable Monaco model URI. Switching tabs swaps models rather than replacing editor text, preserving cursor state and undo/redo history inside Monaco. Zustand owns serializable tab text and active-tab state; Monaco owns ephemeral editor internals. Closed-tab and unmount cleanup explicitly dispose models and editor subscriptions.

The Monaco implementation is loaded through a React lazy boundary. The base application shell remains a small initial bundle while Monaco, SQL tokenization, and the editor worker load as a separate cached chunk.

## Native driver selection

The browser preview keeps `InMemoryDriver`; Tauri creates `TauriDatabaseDriver` with the selected driver kind. The native registry factory is the only vendor-selection boundary. Native connections live behind `Arc<dyn DatabaseDriver>`, so prepare, execute, cancel, metadata, transaction, and disconnect handlers remain vendor-neutral.

Each execution receives an opaque UUID. The frontend maps `AbortSignal` to generic prepare, execute, and cancel commands. PostgreSQL keeps a per-connection active-query state machine and uses a separate one-connection control pool to call parameterized `pg_cancel_backend($1)`. The execution connection is retained until an in-flight cancellation request completes, preventing a late signal from targeting a later query that reused the same backend PID. SQLite does not advertise the `cancel` capability.

PostgreSQL passwords cross only the local Tauri IPC boundary and remain in process memory for the current session. They are not placed in Zustand, localStorage, SQLite, logs, or connection summaries.

The next integration steps are:

1. Add a native file picker and saved SQLite connection profiles.
2. Store saved profile secrets in the OS keychain.
3. Add long-query progress channels and timeout policies.
4. Add MySQL through the same factory and contract suite.
5. Expand the metadata contract from current indexes, views, foreign keys, functions, procedures, aggregates, window functions, relation triggers, event triggers, and dependency edges to schema-aware DDL diffing and migration history. The current safe editor handoff is documented in [ADR-0011](decisions/ADR-0011-safe-ddl-editor-handoff.md).
6. Add structured plan trees and explicit `EXPLAIN ANALYZE` controls on top of the current non-executing Explain slice documented in [ADR-0012](decisions/ADR-0012-non-executing-explain-slice.md).
7. Keep result-grid clipboard serialization in the shared core so browser preview, native results, and future virtualized grids share TSV quoting and null semantics.

## Related decisions

- [ADR-0002: Use a driver-neutral native registry](decisions/ADR-0002-native-driver-contract.md)
- [ADR-0003: Use a driver-owned PostgreSQL cancellation control plane](decisions/ADR-0003-postgres-query-cancellation.md)
- [ADR-0006: Add overload-safe routine metadata](decisions/ADR-0006-overload-safe-routine-metadata.md)
- [ADR-0010: Preserve callable identity while adding PostgreSQL aggregate/window kinds](decisions/ADR-0010-postgresql-callable-kinds.md)
- [ADR-0007: Model relation triggers as top-level metadata](decisions/ADR-0007-driver-neutral-trigger-metadata.md)
- [ADR-0008: Return a driver-owned object dependency snapshot](decisions/ADR-0008-driver-owned-dependency-snapshot.md)
- [ADR-0009: Model event triggers as database-scoped objects](decisions/ADR-0009-database-scoped-event-triggers.md)
- [ADR-0011: Use a safe editor handoff for DDL changes](decisions/ADR-0011-safe-ddl-editor-handoff.md)
- [ADR-0012: Reuse the execution path for non-executing EXPLAIN plans](decisions/ADR-0012-non-executing-explain-slice.md)
