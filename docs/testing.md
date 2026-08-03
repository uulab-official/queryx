# QueryX Testing Guide

## Test layers

QueryX uses a small, explicit test pyramid:

1. **Contract tests** validate driver behavior that every database implementation must provide.
2. **Core unit tests** validate query safety, metadata mapping, result normalization, and transaction behavior.
3. **Type checks** prevent the UI, shared contracts, and driver packages from drifting apart.
4. **Production build checks** verify that the desktop frontend can be bundled from a clean install.
5. **Manual smoke checks** cover the high-value UI path: connect state → run query → filter/sort result → inspect table.

The desktop preview also has a Safe Mode smoke path: replace the editor query with an UPDATE or DELETE without WHERE, press Cmd/Ctrl+Enter, confirm the warning, then choose Cancel, Run in Transaction, or Execute Anyway. This is a UI contract preview; native transaction semantics belong to the Rust driver.

## Local commands

```bash
pnpm install
pnpm run verify
pnpm run typecheck
pnpm run test
pnpm run build
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm --filter @queryx/desktop tauri build --no-bundle
```

`pnpm run verify` checks version alignment and local Markdown links. The same commands run in GitHub Actions.

The PostgreSQL contract test is environment-selective. Set `QUERYX_TEST_POSTGRES_DATABASE` plus any required host, port, username, and password variables before `cargo test` to exercise a live disposable server. When the database variable is absent, no external connection is attempted and the offline suite remains deterministic. See [PostgreSQL Driver](postgres-driver.md).

## Driver contract checklist

Every driver must test:

- connect success and actionable connection failure
- execute success with normalized columns and rows
- execution time, affected rows, warnings, and error shape
- cancellation behavior
- metadata for databases, schemas, tables, columns, indexes, and views
- transaction success, rollback on failure, and disconnect cleanup
- capability reporting without vendor checks in the UI

## Safety checks

The query safety analyzer is intentionally conservative. It flags UPDATE and DELETE statements without a WHERE clause and does not attempt to estimate rows. The production Rust layer must use a parser or database-backed plan before showing an affected-row estimate.

No test fixture may contain real credentials, production connection strings, or personal data. Use synthetic database names and deterministic rows.
