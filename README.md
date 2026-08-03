# QueryX

QueryX is a local-first database IDE in active construction. The repository includes the first interactive UI slice plus a real pnpm workspace with typed driver and query-result contracts.

The product direction and implementation gates are tracked in [ROADMAP.md](ROADMAP.md). The documentation structure and writing plan live in [docs/DOCUMENTATION_PLAN.md](docs/DOCUMENTATION_PLAN.md).

The implementation foundation is documented in [docs/architecture.md](docs/architecture.md), [docs/driver-api.md](docs/driver-api.md), [docs/connections.md](docs/connections.md), [docs/sqlite-driver.md](docs/sqlite-driver.md), and [docs/postgres-driver.md](docs/postgres-driver.md).

## Run locally

Install dependencies and start the actual React/Vite desktop frontend:

```bash
pnpm install
pnpm dev
```

Then visit the Vite URL shown in the terminal.

Run the native Tauri shell with the real Rust/SQLx SQLite and PostgreSQL drivers:

```bash
pnpm --filter @queryx/desktop tauri:dev
```

Rust stable plus the platform prerequisites from the Tauri 2 setup guide are required.

The original dependency-free preview can still be opened directly from `index.html`.

## Included in this slice

- VS Code-inspired dark IDE shell with Explorer, editor, results, and Inspector panels
- Real SQLite and PostgreSQL connections in the native desktop runtime
- Session-only connection dialog with host, port, database, user, password, and SSL mode
- Dynamic query results for arbitrary columns with table and JSON views
- Run, format, filter, sort, and JSON result interactions
- Schema tree collapse/expand and table switching with column metadata
- Local-first status messaging and no-network static runtime
- Connection status, failure feedback, and schema-aware Explorer metadata

## Project direction

The browser frontend uses an in-memory PostgreSQL-shaped fallback. The Tauri runtime opens a seeded SQLite `:memory:` database by default and can switch to a real PostgreSQL server from the connection dialog. Saved profiles, OS keychain integration, query cancellation, and broader metadata remain on the roadmap.
