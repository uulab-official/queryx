# QueryX Architecture

## Current implementation

The repository is a pnpm workspace with one app and two shared packages:

```text
apps/desktop/       React + TypeScript + Vite UI
packages/shared/    driver-neutral types and result contracts
packages/core/      driver implementations and database orchestration
```

The desktop app uses Zustand for UI state. The current `InMemoryDriver` is a deterministic PostgreSQL-shaped driver that lets the UI workflow run without connecting to an external database. It is an integration seam, not a production database implementation.

## Runtime boundary

The target runtime is Tauri 2:

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

The UI must never branch on database vendor details to render a result. Driver-specific behavior belongs behind `DatabaseDriver`, `DatabaseMetadata`, and `QueryResult` contracts.

## State boundaries

- UI state: tabs, editor text, selected table, result view, filters, running status, toasts.
- Driver state: connection lifecycle, query execution, metadata, transactions, capabilities.
- Local persistence: connections without secrets, history, favorites, settings, workspace indexes.
- Secrets: OS keychain only; passwords are not written to SQLite or workspace files.

## Next integration step

Replace `InMemoryDriver` at the Tauri command boundary with a Rust implementation that satisfies the same shared behavior:

1. Connect and validate a local SQLite database.
2. Return the common result model for a read query.
3. Expose metadata for the Explorer.
4. Add cancellation and transaction commands.
5. Add contract tests that run for every driver.
