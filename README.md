# QueryX

[![CI](https://github.com/uulab-official/queryx/actions/workflows/ci.yml/badge.svg)](https://github.com/uulab-official/queryx/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-alpha-orange.svg)](ROADMAP.md)

QueryX is an open-source, local-first database IDE for developers who want a fast SQL workflow without sending database credentials, queries, or results through a vendor cloud. The long-term product goal is a focused, extensible alternative to general-purpose tools such as DBeaver and Oracle SQL Developer: the ergonomics of a modern code editor with database-grade safety and metadata tooling.

> QueryX is alpha software. Use a least-privilege database account and review destructive statements before running them against important data.

## Why QueryX

- **Local first:** the desktop process connects directly to your database. There is no QueryX relay service.
- **Safe by default:** UPDATE and DELETE without a WHERE clause are intercepted before execution.
- **Driver neutral:** SQLite and PostgreSQL share typed query, metadata, transaction, and capability contracts.
- **Editor centered:** Monaco provides SQL syntax highlighting, metadata completion, selections, tabs, and independent undo history.
- **Open and testable:** TypeScript and Rust quality gates run on Linux, macOS, and Windows in GitHub Actions.

## Current capabilities

| Area | Available now | Next production gate |
| --- | --- | --- |
| Connections | Native SQLite and PostgreSQL, TLS modes, session-only passwords | Saved profiles and OS keychain |
| SQL editor | Monaco, multi-tab, metadata completion, selection execution | Dialect-aware parser, formatter, snippets |
| Results | Dynamic table/JSON view, local filter/sort, guarded CSV export | Virtualized streaming, copy modes, paging |
| Safety | Destructive-query warning, transaction execution path | Parser-backed analysis and affected-row estimate |
| Metadata | Schemas, relations, keys, indexes, FK navigation, routines, relation/event triggers, direct Depends on / Used by navigation, and read-only DDL | Aggregates/window functions, editable DDL |
| Runtime | Tauri 2, React, Rust, SQLx | Signed installers and automatic updates |

The detailed delivery order and acceptance gates are in the [product roadmap](ROADMAP.md).

## Quick start

Prerequisites: Node.js 22, pnpm 11, Rust stable, and the platform packages required by Tauri 2.

```bash
git clone https://github.com/uulab-official/queryx.git
cd queryx
pnpm install
pnpm --filter @queryx/desktop tauri:dev
```

QueryX starts with a seeded in-memory SQLite database. Open the connection dialog to choose a SQLite file or PostgreSQL server. For frontend-only development, run `pnpm dev` and use the deterministic in-memory driver.

See [Getting Started](docs/getting-started.md) for platform setup and the first-query walkthrough.

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
