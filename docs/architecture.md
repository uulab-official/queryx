# QueryX Architecture

## Current implementation

The repository is a pnpm workspace with one app, its native runtime, and two shared packages:

```text
apps/desktop/       React + TypeScript + Vite UI
  src-tauri/        Tauri 2 + Rust + SQLx native runtime
packages/shared/    driver-neutral types and result contracts
packages/core/      driver implementations and database orchestration
```

The desktop app uses Zustand for UI state. The current `InMemoryDriver` is a deterministic PostgreSQL-shaped driver that lets the UI workflow run without connecting to an external database. It is an integration seam, not a production database implementation.

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

## Next integration step

The browser preview keeps `InMemoryDriver`; Tauri selects `TauriSqliteDriver`, which invokes Rust commands and maps their serialized response to the same shared behavior. The next integration steps are:

1. Add a native file picker and saved SQLite connection profiles.
2. Add cancellation and long-query progress channels.
3. Extract a Rust driver trait shared by SQLite, PostgreSQL, and MySQL.
4. Add PostgreSQL with OS-keychain credentials.
5. Run the same contract test suite for every native driver.
