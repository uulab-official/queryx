# QueryX

QueryX is a dependency-free interactive prototype for the local-first database IDE described in the product brief.

The product direction and implementation gates are tracked in [ROADMAP.md](ROADMAP.md). The documentation structure and writing plan live in [docs/DOCUMENTATION_PLAN.md](docs/DOCUMENTATION_PLAN.md).

## Run locally

Open `index.html` directly, or serve the folder for a browser-friendly local origin:

```bash
python3 -m http.server 4173
```

Then visit `http://localhost:4173`.

## Included in this slice

- VS Code-inspired dark IDE shell with Explorer, editor, results, and Inspector panels
- Seeded PostgreSQL query and result grid
- Run, format, filter, sort, and JSON result interactions
- Schema tree collapse/expand and table switching with column metadata
- Local-first status messaging and no-network static runtime
- Command, theme, settings, and new-connection affordances with toast feedback

## Project direction

This prototype is intentionally frontend-only. The next implementation milestone adds the Tauri 2 desktop shell, Rust driver contract, SQLite/PostgreSQL connectivity, shared result models, and local storage boundaries described in the roadmap.
