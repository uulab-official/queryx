# QueryX

QueryX is a local-first database IDE in active construction. The repository includes the first interactive UI slice plus a real pnpm workspace with typed driver and query-result contracts.

The product direction and implementation gates are tracked in [ROADMAP.md](ROADMAP.md). The documentation structure and writing plan live in [docs/DOCUMENTATION_PLAN.md](docs/DOCUMENTATION_PLAN.md).

The implementation foundation is documented in [docs/architecture.md](docs/architecture.md) and [docs/driver-api.md](docs/driver-api.md).

## Run locally

Install dependencies and start the actual React/Vite desktop frontend:

```bash
pnpm install
pnpm dev
```

Then visit the Vite URL shown in the terminal.

The original dependency-free preview can still be opened directly from `index.html`.

## Included in this slice

- VS Code-inspired dark IDE shell with Explorer, editor, results, and Inspector panels
- Seeded PostgreSQL query and result grid
- Run, format, filter, sort, and JSON result interactions
- Schema tree collapse/expand and table switching with column metadata
- Local-first status messaging and no-network static runtime
- Command, theme, settings, and new-connection affordances with toast feedback

## Project direction

The desktop frontend currently uses an in-memory PostgreSQL-shaped driver so the workflow is real without pretending a database connection is already production-ready. The next milestone adds the Tauri 2 shell, Rust driver bridge, SQLite/PostgreSQL connectivity, and local storage boundaries described in the roadmap.
