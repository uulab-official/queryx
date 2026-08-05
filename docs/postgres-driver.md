# PostgreSQL Driver

## What it does

The native PostgreSQL driver uses SQLx and implements the shared QueryX `DatabaseDriver` contract. It supports pooled connections, direct and single-statement transactional execution, server-side cancellation, common PostgreSQL value normalization, and Explorer metadata for accessible databases, schemas, tables, views, columns, estimated row counts, primary keys, indexes, composite foreign keys, functions, procedures, aggregates, window functions, relation triggers, event triggers, and direct object dependencies.

PostgreSQL advertises `explain`. QueryX sends a single `EXPLAIN` statement through the existing execution and cancellation path, so PostgreSQL returns its text plan as normal result rows. The baseline action does not add `ANALYZE` and therefore does not execute the target statement.

## Routine catalog

One batched `pg_proc` query loads visible functions, procedures, aggregates, and window functions. QueryX uses routine OIDs only as opaque identities for the active metadata snapshot, identity arguments to distinguish overloads in the UI, and `pg_get_function_result` for return shapes. A `pg_aggregate` left join provides aggregate mode (`normal`, `ordered-set`, or `hypothetical-set`) and direct-argument count. `pg_get_functiondef` is limited to ordinary functions and procedures; aggregate and window entries intentionally have no executable DDL panel.

The DDL is reconstructed by PostgreSQL and may not preserve original comments, whitespace, or formatting. QueryX displays and copies it but never executes it automatically. Routine bodies remain within the local desktop process and the connected database boundary.

## Trigger catalog

One `pg_trigger` query returns non-internal triggers for loaded table, partition, and view kinds. QueryX derives timing/events/orientation from `tgtype`, UPDATE columns from `tgattr`, preserves every `tgenabled` mode, and extracts optional conditions from standardized `pg_get_triggerdef` DDL.

## Dependency catalog

Foreign-key and trigger-owner edges are normalized from the same metadata snapshot. Trigger-function edges use `pg_trigger.tgfoid`, so overloaded routine navigation resolves by OID instead of name. A batched `pg_rewrite`/`pg_depend` query reports direct view references to visible tables and views. The frontend receives only normalized edge kinds and never branches on PostgreSQL catalogs.

## Event trigger catalog

One batched `pg_event_trigger` query loads database-scoped event names, activation modes, optional command tags, and `evtfoid` function references. Routine OIDs and identity arguments keep function navigation consistent with the Routine Explorer. PostgreSQL `quote_ident` and `quote_literal` produce safe catalog values for the read-only reconstructed `CREATE EVENT TRIGGER` statement.

## Connection behavior

The connection dialog maps host, port, database, username, optional password, SSL mode, optional CA/client certificate/key file paths, and an optional SSH tunnel to `PgConnectOptions`. `Verify CA` maps to `verify-ca`; `Verify Full / Identity` maps to `verify-full`. The session explorer reads visible rows from `pg_stat_activity`, including state, wait event, query start, and duration. Query cancellation uses `pg_cancel_backend` and never terminates the selected backend; the current QueryX session cannot cancel itself. The pool uses the `QueryX` application name, at most five connections, and a ten-second acquisition timeout. Passwords are never returned in `ConnectionSummary`.

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

Only `QUERYX_TEST_POSTGRES_DATABASE` enables the live connection. Host, port, username, and password fall back to the driver's local defaults when omitted. The live harness also runs `pg_sleep(10)`, cancels it within three seconds, and creates isolated objects to verify composite foreign keys, overloaded functions, default arguments, TABLE returns, procedures, relation/event triggers, direct view references, dependency direction, opaque IDs, command tags, activation status, and reconstructed DDL. GitHub Actions runs this harness against a disposable PostgreSQL 17 service.

## Known limitations

- Cancellation uses `pg_cancel_backend` because SQLx 0.8 does not expose a protocol cancel token; PostgreSQL permission policies still apply.
- Explicit transaction sessions reserve one pooled PostgreSQL connection until commit or rollback. Queries, streams, and edit batches reuse that connection; disconnect rolls back an unfinished session.
- Object-specific DDL diff and applied-migration state are not yet part of the shared metadata model. The generic Schema Compare workflow provides dependency-aware diffing, rollback preview, and PostgreSQL privilege-preflight SQL. Inspector definitions for ordinary functions/procedures, relation triggers, and event triggers can be handed off to a normal SQL tab; aggregate/window entries remain inspection-only because PostgreSQL does not expose the same executable routine definition contract for those catalog kinds.
- PostgreSQL extension and geometric types currently use an unsupported-type marker.
- Saved credentials use the native OS keychain when explicitly enabled; the profile file stores only whether a keychain entry exists.

## Related

- [Database Connections](connections.md)
- [Driver API](driver-api.md)
- [Testing Guide](testing.md)
