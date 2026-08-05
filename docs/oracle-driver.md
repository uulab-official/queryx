# Oracle Driver

QueryX includes an initial native Oracle driver for the connect → query → inspect → edit workflow. It runs in the local Tauri process and uses the pure-Rust async thin client [`oracle-rs`](https://crates.io/crates/oracle-rs); credentials, SQL text, and result rows do not pass through a QueryX service.

## Supported now

- SQL authentication with host, port, Oracle service name, username, password, and OpenSSH local-forward tunnels;
- port `1521` by default, with the profile **Database** field interpreted as a service name such as `FREEPDB1`;
- encrypted TLS for every SSL mode except `Disable`, with optional CA and client certificate/key file paths;
- common Oracle scalar normalization: strings, integers, floating-point values, precision-preserving `NUMBER` strings, JSON, dates, timestamps, booleans, and binary values as base64;
- native 256-row result streaming and Oracle `OFFSET … FETCH` paging for single `SELECT`/`WITH` statements;
- explicit begin/commit/rollback sessions on one held connection;
- atomic edit batches with exact affected-row conflict checks and rollback on mismatch or failure;
- read-only session enforcement at the native driver boundary;
- users, database name, tables, approximate row counts, views, and table/view columns from Oracle catalog views;
- primary-key columns, ordered normal/function-based indexes, composite foreign keys, referential actions, deferrability, and FK dependency edges from `ALL_CONSTRAINTS`, `ALL_CONS_COLUMNS`, `ALL_INDEXES`, and related catalog views;
- standalone and package procedure/function signatures from `ALL_PROCEDURES` and `ALL_ARGUMENTS`, including subprogram-stable snapshot IDs, overload-safe argument lists, `IN`/`OUT`/`IN OUT` directions, and return types;
- table and view trigger inspection from `ALL_TRIGGERS`, including owner navigation, DML events, before/after/instead-of timing, row/statement orientation, enabled/disabled status, conditions, and catalog-rendered description/body text;
- Oracle-safe identifier quoting, `VARCHAR2(4000)` browse casts, `ADD`/`MODIFY` DDL previews, and numeric boolean literals in SQL export.

## Deliberate limitations

The first Oracle slice does not advertise cancellation, sessions, lock graphs, or view dependency metadata. Routine definitions are not reconstructed as executable `CREATE OR REPLACE` DDL yet; the Inspector exposes the authoritative signature and argument metadata. Trigger definitions combine Oracle's catalog description and body text, so they are read-only inspection text rather than a promise of byte-for-byte recreate SQL. SID/connect-descriptor profiles, wallet authentication, proxy authentication, fine-grained SSL mode semantics, and Oracle-specific `MERGE` conflict import modes are planned. CSV/JSON imports in `error` conflict mode are supported through transactional batches; `ignore` and `upsert` return an actionable error rather than emitting unreviewed Oracle-specific SQL.

The profile currently models one service name, not a full Oracle Net connect descriptor. For RAC, wallets, TCPS aliases, or SID-based installations, use an SSH/local listener endpoint that exposes a service name or wait for the dedicated connection-profile work.

## Verification

The repository checks the driver through Rust compilation, Clippy with warnings denied, shared TypeScript contracts, Oracle-specific browse/paging/export tests, and the native build gate. Set `QUERYX_TEST_ORACLE_SERVICE` plus optional `QUERYX_TEST_ORACLE_HOST`, `QUERYX_TEST_ORACLE_PORT`, `QUERYX_TEST_ORACLE_USER`, and `QUERYX_TEST_ORACLE_PASSWORD` to run the live read-only health/metadata contract against a disposable Oracle XE/Free container or instance; production credentials must never be placed in fixtures or CI logs.

## Related

- [Connections](connections.md)
- [Routine Inspector](routine-inspector.md)
- [Trigger Inspector](trigger-inspector.md)
- [Driver API](driver-api.md)
- [Database IDE Capability Matrix](parity-matrix.md)
- [Roadmap](../ROADMAP.md)
