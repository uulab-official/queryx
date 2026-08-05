# QueryX

[![CI](https://github.com/uulab-official/queryx/actions/workflows/ci.yml/badge.svg)](https://github.com/uulab-official/queryx/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-alpha-orange.svg)](ROADMAP.md)

QueryX is an open-source, local-first database IDE for developers who want a fast SQL workflow without sending database credentials, queries, or results through a vendor cloud. The long-term product goal is a focused, extensible alternative to general-purpose tools such as DBeaver and Oracle SQL Developer: the ergonomics of a modern code editor with database-grade safety and metadata tooling.

> QueryX is alpha software. Use a least-privilege database account and review destructive statements before running them against important data.

## Why QueryX

- **Local first:** the desktop process connects directly to your database. There is no QueryX relay service.
- **Safe by default:** UPDATE and DELETE without a WHERE clause are intercepted before execution.
- **Driver neutral:** SQLite, PostgreSQL, and the initial MySQL/MariaDB driver share typed query, metadata, transaction, and capability contracts.
- **Editor centered:** Monaco provides SQL syntax highlighting, metadata completion, selections, tabs, and independent undo history.
- **Open and testable:** TypeScript and Rust quality gates run on Linux, macOS, and Windows in GitHub Actions.

## Current capabilities

| Area | Available now | Next production gate |
| --- | --- | --- |
| Connections | Native SQLite, PostgreSQL, and MySQL/MariaDB basics, TLS modes, CA/client certificate paths, OpenSSH local tunnels, saved profiles with optional OS-keychain passwords, read-only sessions, connection testing | Advanced vendor metadata |
| SQL editor | Monaco, multi-tab, metadata completion, selection execution | Dialect-aware parser, formatter, snippets |
| Results | Dynamic table/JSON view, virtualized loaded results, copy/export, 100-row server paging, table-browser filter/sort, all native drivers chunked streaming | Spill-to-disk, arbitrary-query server filtering |
| Safety | Destructive-query warning, native read-only sessions, explicit transaction sessions, transaction execution path | Parser-backed analysis, affected-row estimate |
| Metadata | Schemas, relations, keys, indexes, FK navigation, functions/procedures/aggregates/window functions, relation/event triggers, direct Depends on / Used by navigation, and safe DDL-to-SQL handoff | Schema-aware DDL diff and migration history |
| Operations | Native PostgreSQL/MySQL/MariaDB session explorer, point-in-time lock graph, and threshold-based long-running query diagnostics with safe query cancellation | Session history and server wait statistics |
| Runtime | Tauri 2, React, Rust, SQLx, signed updater integration, GitHub Release workflow | Platform notarization/codesigning and production key operations |

The detailed delivery order and acceptance gates are in the [product roadmap](ROADMAP.md).

Use the [database IDE capability matrix](docs/parity-matrix.md) for the evidence-based comparison with DBeaver, pgAdmin, phpMyAdmin, and SQL Developer.

## Quick start

Prerequisites: Node.js 22, pnpm 11, Rust stable, and the platform packages required by Tauri 2.

```bash
git clone https://github.com/uulab-official/queryx.git
cd queryx
pnpm install
pnpm --filter @queryx/desktop tauri:dev
```

QueryX starts with a seeded in-memory SQLite database. Open the connection dialog to choose a SQLite file, PostgreSQL server, or MySQL/MariaDB server. For frontend-only development, run `pnpm dev` and use the deterministic in-memory driver.

See [Getting Started](docs/getting-started.md) for platform setup and the first-query walkthrough.

Packaged desktop builds check for signed updates after startup. See [Desktop Updates](docs/updates.md) for the release feed, GitHub Actions secrets, and rollback procedure.

## Development

```bash
pnpm run verify
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run check:native
pnpm run test:native
pnpm --filter @queryx/desktop tauri build --no-bundle
```

The repository is a pnpm workspace:

```text
apps/desktop/          React/Vite UI and Tauri host
packages/shared/       Driver-neutral public contracts
packages/core/         Safety, export, and deterministic core logic
docs/                  User, contributor, architecture, and ADR docs
scripts/               Repository verification harness
```

Read the [architecture](docs/architecture.md), [driver API](docs/driver-api.md), and [testing guide](docs/testing.md) before changing a cross-layer contract.

## Documentation

The [documentation index](docs/README.md) routes users and contributors to setup, connections, SQL editing, results/export, troubleshooting, drivers, architecture, testing, and release operations.

## Contributing and security

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), follow the [Code of Conduct](CODE_OF_CONDUCT.md), and do not open a public issue for a suspected vulnerability—use the process in [SECURITY.md](SECURITY.md).

## License

QueryX is licensed under the [Apache License 2.0](LICENSE).
