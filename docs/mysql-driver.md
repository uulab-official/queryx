# MySQL / MariaDB Driver

QueryX includes an initial native MySQL/MariaDB driver for the common connect → inspect → query → browse workflow. It uses SQLx over the local Tauri process; credentials and query results do not pass through a QueryX service.

## Supported now

- MySQL and MariaDB TCP connections with host, port, database, username, password, and `Prefer`/`Require`/`Disable` SSL modes;
- direct query execution and explicit single-document transactions;
- SELECT/SHOW/DESCRIBE/EXPLAIN result normalization, including common numeric, date/time, JSON, and binary values;
- information_schema metadata for tables, views, columns, approximate table row counts, indexes, foreign keys, routines, triggers, and direct relation dependencies;
- read-only sessions: the pool requests read-only transactions and the native driver rejects non-read statements before execution;
- capability reporting for transactions, explain, and editing.

## Deliberate limitations

The initial driver does not yet expose MySQL/MariaDB event triggers, server-side cancellation, streaming cursors, SSH tunnels, or certificate-file configuration. Trigger definitions currently expose the catalog action statement rather than a reconstructed `CREATE TRIGGER` statement. These are tracked as separate roadmap gates. An empty Inspector section means the metadata contract does not claim support; it is not evidence that the database has no such objects.

MySQL `information_schema.tables.table_rows` is an engine-dependent estimate, not an exact `COUNT(*)`. Use an explicit query when an exact count matters.

## Optional integration test

The deterministic native tests cover SQL classification, configuration validation, and result-statement detection without requiring a server. To run the live contract test, provide a disposable database through environment variables:

```bash
QUERYX_TEST_MYSQL_DATABASE=queryx_contract \
QUERYX_TEST_MYSQL_HOST=127.0.0.1 \
QUERYX_TEST_MYSQL_PORT=3306 \
QUERYX_TEST_MYSQL_USER=queryx \
QUERYX_TEST_MYSQL_PASSWORD='session-only' \
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml mysql_driver::tests::mysql_contract_when_test_database_is_available
```

The test runs a read-only health query and confirms that a write-shaped statement is rejected. Do not commit these values or place real production credentials in CI fixtures.

## Related

- [Connections](connections.md)
- [Driver API](driver-api.md)
- [Roadmap](../ROADMAP.md)
