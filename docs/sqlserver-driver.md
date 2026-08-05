# SQL Server Driver

QueryX includes an initial native SQL Server driver for the common connect → query → inspect → edit workflow. It runs in the local Tauri process and uses the async TDS client documented by [Tiberius](https://docs.rs/tiberius/latest/tiberius/); credentials, SQL text, and result rows do not pass through a QueryX service.

## Supported now

- SQL authentication with host, port, database, username, password, and OpenSSH local-forward tunnels;
- encrypted TDS/TLS by default with platform certificate validation and optional private CA path;
- direct SQL execution with common numeric, text, binary, GUID, decimal, XML, and temporal result values normalized across the shared QueryX result contract;
- native 256-row result streaming and SQL Server `OFFSET … FETCH` paging for single `SELECT`/`WITH` statements;
- explicit begin/commit/rollback sessions on one held connection;
- atomic edit batches with exact affected-row conflict checks and rollback on mismatch or failure;
- read-only session enforcement at the native driver boundary;
- `sys.*` and `INFORMATION_SCHEMA` metadata for databases, schemas, tables, approximate row counts, views, and columns;
- SQL Server-safe bracket identifier quoting in table browsing, SQL export, DDL previews, schema compare, and insert generation.

## Deliberate limitations

The first SQL Server slice does not advertise cancellation, sessions, lock graphs, routines, triggers, indexes, or foreign-key metadata until each has an authoritative catalog query and a contract test. Windows integrated authentication and AAD token authentication are also planned. CSV imports in `error` conflict mode are supported through transactional batches; `ignore` and `upsert` are rejected with an actionable message rather than generating PostgreSQL/MySQL syntax.

`Prefer` and `Require` both use encrypted TDS for SQL Server. `Disable` is available only for trusted local development. A self-signed server should be configured with its issuing CA path rather than bypassing certificate validation in production.

## Verification

The repository checks the driver through Rust compilation, Clippy with warnings denied, shared TypeScript contracts, SQL Server-specific browse/paging/export tests, and the native build gate. A live contract test should use a disposable SQL Server container or instance; production credentials must never be placed in fixtures or CI logs.

## Related

- [Connections](connections.md)
- [Driver API](driver-api.md)
- [Database IDE Capability Matrix](parity-matrix.md)
- [Roadmap](../ROADMAP.md)
