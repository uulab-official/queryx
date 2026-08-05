# Database Connections

## What it does

The native QueryX desktop app can connect directly to SQLite files, PostgreSQL servers, and MySQL/MariaDB servers. Open the connection dialog from the **+** button in Explorer, the current connection selector, or the connection status in the editor tabs.

## Before you start

- Run the Tauri desktop app, not only the browser preview.
- Make sure the database host is reachable from your computer.
- Use a database account with the minimum privileges required for your work.

## Quick start

For PostgreSQL, select the driver and enter a connection name, host, port, database, username, optional password, and SSL mode. Choose **Test connection** to open a temporary driver, load metadata, and close it without replacing the active connection. Choose **Connect** after the test passes to switch the editor to the new native connection.

For MySQL or MariaDB, select **MySQL / MariaDB** and enter the host, port (default `3306`), database, username (default `root`), optional password, and SSL mode. QueryX loads tables, views, columns, row-count estimates, and indexes through `information_schema`.

For SQLite, select SQLite and enter `:memory:` for a temporary database or an absolute database file path.

## Options and behavior

- `Prefer` tries TLS first and can fall back when the server does not support it.
- `Require` requires an encrypted PostgreSQL or MySQL connection.
- `Disable` is intended for trusted local development servers.
- The prior connection stays active until the replacement connection and its metadata both load successfully.
- **Save profile** stores reusable non-secret fields. **Duplicate** creates a safe copy for environment variants, and **Delete** removes a saved profile.
- **Read-only session** is a connection policy, not just a UI preference. SQLite enables `PRAGMA query_only`, PostgreSQL enables `default_transaction_read_only`, and MySQL sets a read-only transaction session plus rejects non-read statements at the native driver boundary.
- On native desktop, profiles are stored in the QueryX app-local data directory. The optional password is stored separately in the platform OS keychain; only a `passwordStored` marker is persisted with the profile. The browser preview uses localStorage as a development fallback and never stores passwords.
- All three drivers return the same result and metadata shapes to the UI; unsupported vendor-specific metadata is represented as an empty capability area until implemented.

## Safety and privacy

Connections go directly from the local Tauri process to the selected database. QueryX has no relay server and does not send connection data to a QueryX service. Native passwords are held in memory for the current pool and, only when explicitly enabled, in the platform OS keychain; they are not written to localStorage, SQLite, workspace files, history, logs, or connection summaries.

Saved profiles never contain passwords. On native desktop, enable **Store in OS keychain** to load the password when selecting the profile after restart. Disable it or delete the profile to remove the keychain entry. Browser preview always asks for the password for the current session.

## Troubleshooting

- A timeout usually means the host or port is unreachable or blocked by a firewall.
- Authentication failures should be resolved by checking the username, password, database access rule, and server authentication configuration.
- If TLS negotiation fails on a local test server, use `Disable`; keep `Require` for production networks where encryption is mandatory.
- QueryX keeps the current connection when a replacement connection fails, so you can correct the fields and retry.
- A successful connection test does not change the active connection. This makes it safe to validate credentials or a copied environment profile before switching workspaces.

## Related

- [PostgreSQL Driver](postgres-driver.md)
- [SQLite Driver](sqlite-driver.md)
- [MySQL/MariaDB Driver](mysql-driver.md)
- [Driver API](driver-api.md)
