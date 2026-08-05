# ADR-0015: Use SQLite for the native workspace store

- Status: Accepted
- Date: 2026-08-05

## Context

The original alpha stored the native workspace snapshot and reusable connection profiles as JSON files under the app-local data directory. That boundary restored tabs and profiles, but it did not provide transactional writes, a durable migration ledger, or one local store for the daily IDE workflow. The project brief explicitly calls for SQLite-backed local storage while keeping passwords in the OS keychain.

## Decision

Use one app-local `workspace.sqlite` database for native, non-secret workspace state:

- `workspace_schema_migrations` records the native storage schema version;
- `workspace_snapshots` stores the versioned tabs/history/favorites/migration/audit snapshot as one JSON document; and
- `workspace_connection_profiles` stores the normalized, secret-free reusable profiles as one JSON document.

The database is opened with one connection, foreign keys enabled, and WAL journaling. Schema creation and future migrations run inside a transaction. Snapshot/profile writes use a single SQLite upsert, so a process crash cannot leave a partially written JSON file. The browser preview keeps localStorage because it has no native app-data directory.

Existing `workspace.json` and `connection-profiles.json` files are read only as a one-time compatibility migration. If no native SQLite row exists, a valid browser snapshot can also be copied into the native store. Subsequent native writes go only to SQLite.

Passwords, keychain material, query result rows, and live driver connections are not stored in this database. A profile may retain only the boolean keychain-presence marker; the password itself remains in the platform credential store or the current process session.

## Consequences

Native workspace recovery now has a transactional, versioned local boundary and can evolve without introducing another persistence mechanism. The JSON document inside SQLite keeps the current TypeScript/Rust snapshot contract additive while settings, named workspaces, and crash-recovery journals are designed. SQLite does not yet provide multi-workspace selection or field-level history; those are explicit follow-up migrations.

## Verification

- Rust tests create an in-memory SQLite store, run the schema migration, round-trip a snapshot, verify the migration ledger, and confirm profile storage is separate.
- The frontend first reads the native commands, then migrates legacy JSON or browser localStorage only when the native row is absent.
- The native profile normalizer strips passwords before the profile JSON reaches the command boundary.
