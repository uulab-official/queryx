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

- UI state: tabs, editor text, selected table, result view, filters, running status, toasts.
- Driver state: connection lifecycle, query execution, metadata, transactions, capabilities.
- Local persistence: connections without secrets, history, favorites, settings, workspace indexes.
- Secrets: OS keychain only; passwords are not written to SQLite or workspace files.

## Native driver selection

The browser preview keeps `InMemoryDriver`; Tauri creates `TauriDatabaseDriver` with the selected driver kind. The native registry factory is the only vendor-selection boundary. Native connections live behind `Arc<dyn DatabaseDriver>`, so execute, metadata, transaction, and disconnect handlers remain vendor-neutral.

PostgreSQL passwords cross only the local Tauri IPC boundary and remain in process memory for the current session. They are not placed in Zustand, localStorage, SQLite, logs, or connection summaries.

The next integration steps are:

1. Add a native file picker and saved SQLite connection profiles.
2. Store saved profile secrets in the OS keychain.
3. Add cancellation and long-query progress channels.
4. Add MySQL through the same factory and contract suite.
5. Expand the metadata contract to indexes, views, triggers, and DDL.
