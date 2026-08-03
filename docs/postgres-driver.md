# PostgreSQL Driver

## What it does

The native PostgreSQL driver uses SQLx and implements the shared QueryX `DatabaseDriver` contract. It supports pooled connections, direct and single-statement transactional execution, common PostgreSQL value normalization, and Explorer metadata for accessible databases, schemas, tables, columns, estimated row counts, and primary keys.

## Connection behavior

The connection dialog maps host, port, database, username, optional password, and SSL mode to `PgConnectOptions`. The pool uses the `QueryX` application name, at most five connections, and a ten-second acquisition timeout. Passwords are never returned in `ConnectionSummary`.

## Result mapping

- integer, floating-point, and boolean values → JSON primitives
- `numeric` → JSON string to preserve arbitrary precision
- text and UUID → JSON string
- JSON/JSONB → JSON value
- dates, times, and timestamps → ISO-compatible strings
- bytea → base64 string
- common boolean, integer, and text arrays → JSON arrays
- unsupported types → `<TYPE>` marker plus a result warning

## Live contract test

Use a disposable PostgreSQL database with synthetic data. Do not point this harness at production.

```bash
export QUERYX_TEST_POSTGRES_DATABASE=queryx_test
export QUERYX_TEST_POSTGRES_HOST=localhost
export QUERYX_TEST_POSTGRES_PORT=5432
export QUERYX_TEST_POSTGRES_USERNAME=queryx
export QUERYX_TEST_POSTGRES_PASSWORD=local-test-only
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml postgres_driver
```

Only `QUERYX_TEST_POSTGRES_DATABASE` enables the live connection. Host, port, username, and password fall back to the driver's local defaults when omitted.

## Known limitations

- Query cancellation is not connected to PostgreSQL cancellation tokens yet.
- Multi-statement interactive transaction sessions need a dedicated transaction ID.
- Indexes, views, functions, triggers, and DDL are not yet part of the shared metadata model.
- PostgreSQL extension and geometric types currently use an unsupported-type marker.
- Saved credentials must wait for OS keychain integration.

## Related

- [Database Connections](connections.md)
- [Driver API](driver-api.md)
- [Testing Guide](testing.md)
