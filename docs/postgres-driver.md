# PostgreSQL Driver

## What it does

The native PostgreSQL driver uses SQLx and implements the shared QueryX `DatabaseDriver` contract. It supports pooled connections, direct and single-statement transactional execution, server-side cancellation, common PostgreSQL value normalization, and Explorer metadata for accessible databases, schemas, tables, views, columns, estimated row counts, primary keys, indexes, composite foreign keys, functions, procedures, and relation triggers.

## Routine catalog

One batched `pg_proc` query loads visible ordinary functions and procedures. QueryX uses routine OIDs only as opaque identities for the active metadata snapshot, identity arguments to distinguish overloads in the UI, `pg_get_function_result` for return shapes, and `pg_get_functiondef` for read-only database-rendered DDL. Aggregates and window functions are excluded.

The DDL is reconstructed by PostgreSQL and may not preserve original comments, whitespace, or formatting. QueryX displays and copies it but never executes it automatically. Routine bodies remain within the local desktop process and the connected database boundary.

## Trigger catalog

One `pg_trigger` query returns non-internal triggers for loaded table, partition, and view kinds. QueryX derives timing/events/orientation from `tgtype`, UPDATE columns from `tgattr`, preserves every `tgenabled` mode, and displays `pg_get_expr` conditions plus `pg_get_triggerdef` DDL.

## Connection behavior

The connection dialog maps host, port, database, username, optional password, and SSL mode to `PgConnectOptions`. The pool uses the `QueryX` application name, at most five connections, and a ten-second acquisition timeout. Passwords are never returned in `ConnectionSummary`.

## Query cancellation

Every native execution is prepared with a random query UUID before it starts. The driver tracks the UUID through pending, running, cancelling, cancelled, and finished states. Once running, the state contains only the PostgreSQL backend PID; SQL text and credentials are never stored in the cancellation registry.

SQLx 0.8 does not expose PostgreSQL's protocol cancellation token, so QueryX uses a separate lazy one-connection control pool and executes `SELECT pg_cancel_backend($1)` with a bound integer PID. The same database identity is used, keeping PostgreSQL's normal authorization rules in force. The execution connection is not returned to the main pool until a cancellation request has completed, which prevents a delayed signal from cancelling a later query on a reused backend.

The Cancel button and Escape shortcut are shown only when the active driver reports the `cancel` capability. A PostgreSQL role that cannot cancel the target backend will return a cancellation failure instead of silently claiming success.

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

Only `QUERYX_TEST_POSTGRES_DATABASE` enables the live connection. Host, port, username, and password fall back to the driver's local defaults when omitted. The live harness also runs `pg_sleep(10)`, cancels it within three seconds, and creates isolated schemas to verify composite foreign keys plus overloaded functions, default arguments, TABLE returns, procedures, opaque IDs, and reconstructed DDL. GitHub Actions runs this harness against a disposable PostgreSQL 17 service.

## Known limitations

- Cancellation uses `pg_cancel_backend` because SQLx 0.8 does not expose a protocol cancel token; PostgreSQL permission policies still apply.
- Multi-statement interactive transaction sessions need a dedicated transaction ID.
- Event triggers, dependencies, aggregates/window functions, and editable DDL are not yet part of the shared metadata model.
- PostgreSQL extension and geometric types currently use an unsupported-type marker.
- Saved credentials must wait for OS keychain integration.

## Related

- [Database Connections](connections.md)
- [Driver API](driver-api.md)
- [Testing Guide](testing.md)
