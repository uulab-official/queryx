# Trigger Inspector

## What it does

QueryX lists relation triggers under each schema's **Triggers** group for PostgreSQL and SQLite. Selecting a trigger shows its owner, timing, events, row/statement orientation, activation mode, optional condition, and database-rendered DDL without executing SQL.

PostgreSQL database-wide event triggers are a distinct object type under the connection root. See [Event Trigger Inspector](event-trigger-inspector.md).

## Quick start

1. Connect and expand **Schemas → schema → Triggers**.
2. Select a trigger. The owning relation appears beside the trigger in Explorer.
3. Review activation and event details in Inspector.
4. Select the owner link to navigate to its table or view.
5. Use **Copy DDL** when needed. Copying never inserts or executes the text.

## Driver behavior

PostgreSQL preserves all `tgenabled` modes: `origin`, `replica`, `always`, and `disabled`. It obtains timing/events from the catalog bitmask, UPDATE OF columns from `tgattr`, and extracts the optional condition from standardized `pg_get_triggerdef` DDL. Internal constraint triggers, system schemas, temporary relations, and unsupported relation kinds are excluded.

SQLite reads trigger ownership and SQL from `main.sqlite_master`. SQLite has no equivalent activation flag, so visible triggers report `enabled`; this does not mean PostgreSQL `always`. Timing and events are conservatively derived from the CREATE TRIGGER header. Unsupported syntax falls back to `unknown` while preserving the DDL.

## Safety and privacy

Trigger definitions can contain business logic and literals. They travel only between the connected database, native driver, and local UI. QueryX treats definitions as untrusted read-only text, does not log their bodies, and never executes them automatically.

Database-rendered DDL is not guaranteed to preserve the original comments or formatting. PostgreSQL reconstructs definitions; SQLite can normalize stored schema SQL.

## Troubleshooting

- **Missing trigger:** reconnect after creating it and verify catalog visibility. PostgreSQL internal and temporary triggers are intentionally hidden.
- **`origin` status:** the PostgreSQL trigger fires in normal origin/local sessions, not replica role sessions.
- **`unknown` timing/event:** QueryX could not safely parse the SQLite header; inspect the complete DDL.
- **Owner link unavailable:** the relation is outside the loaded catalog or unsupported relation kind.
- **Copy fails:** grant clipboard permission and retry; the DDL remains selectable.

## Related

- [Metadata Explorer](metadata-explorer.md)
- [Driver API](driver-api.md)
- [ADR-0007](decisions/ADR-0007-driver-neutral-trigger-metadata.md)
