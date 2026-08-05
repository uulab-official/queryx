# MySQL / MariaDB Driver

QueryX includes an initial native MySQL/MariaDB driver for the common connect → inspect → query → browse workflow. It uses SQLx over the local Tauri process; credentials and query results do not pass through a QueryX service.

## Supported now

- MySQL and MariaDB TCP connections with host, port, database, username, password, `Prefer`/`Require`/`Verify CA`/`Verify Full`/`Disable` SSL modes, and optional CA/client certificate/key file paths;
- direct query execution, one-shot document transactions, and reusable explicit transaction sessions;
- SELECT/SHOW/DESCRIBE/EXPLAIN result normalization, including common numeric, date/time, JSON, and binary values;
- information_schema metadata for tables, views, columns, approximate table row counts, indexes, foreign keys, routines, triggers, and direct relation dependencies;
- read-only sessions: the pool requests read-only transactions and the native driver rejects non-read statements before execution;
- capability reporting for transactions, explain, streaming, cancellation, and editing;
- explicit sessions reserve one pooled MySQL/MariaDB connection until commit or rollback; disconnect rolls back unfinished work.
- 256-row native result chunks for single row-returning statements, with incremental Tauri delivery and the same result contract as PostgreSQL;
- active-query cancellation through a separate local control connection using `KILL QUERY` against the execution connection ID.

## Deliberate limitations

The initial driver does not yet expose MySQL/MariaDB event triggers or managed SSH jump-host chains. Native OpenSSH local forwarding is available for the common single-bastion workflow. SQLite remains the only built-in driver without native cancellation. Trigger definitions currently expose the catalog action statement rather than a reconstructed `CREATE TRIGGER` statement. These are tracked as separate roadmap gates. An empty Inspector section means the metadata contract does not claim support; it is not evidence that the database has no such objects.

`Verify CA` maps to SQLx `VerifyCa`; `Verify Full / Identity` maps to `VerifyIdentity`. The CA path is passed to SQLx as `ssl_ca`, while the client certificate and key paths are passed to `ssl_client_cert` and `ssl_client_key`. The session explorer reads visible rows from `SHOW FULL PROCESSLIST`; the lock graph first reads MySQL 8 Performance Schema lock waits and falls back to the MariaDB/legacy InnoDB lock views when available. The cancel action uses `KILL QUERY` and never kills the connection itself.

MySQL `information_schema.tables.table_rows` is an engine-dependent estimate, not an exact `COUNT(*)`. Use an explicit query when an exact count matters.

## Optional integration test

The deterministic native tests cover SQL classification, configuration validation, and result-statement detection without requiring a server. To run the live contract test, provide a disposable database through environment variables:

```bash
QUERYX_TEST_MYSQL_DATABASE=queryx_contract \
QUERYX_TEST_MYSQL_HOST=127.0.0.1 \
QUERYX_TEST_MYSQL_PORT=3306 \
QUERYX_TEST_MYSQL_USER=queryx \
QUERYX_TEST_MYSQL_PASSWORD='session-only' \
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml mysql_driver
```

The test runs a read-only health query, verifies capability reporting, streams 300 synthetic rows in multiple chunks, cancels a disposable `SLEEP` query, and confirms that a write-shaped statement is rejected. Do not commit these values or place real production credentials in CI fixtures.

## Related

- [Connections](connections.md)
- [Driver API](driver-api.md)
- [Roadmap](../ROADMAP.md)
