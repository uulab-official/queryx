# Database Connections

## What it does

The native QueryX desktop app can connect directly to SQLite files, PostgreSQL servers, MySQL/MariaDB servers, SQL Server instances, and Oracle services. Open the connection dialog from the **+** button in Explorer, the current connection selector, or the connection status in the editor tabs.

## Before you start

- Run the Tauri desktop app, not only the browser preview.
- Make sure the database host is reachable from your computer.
- Use a database account with the minimum privileges required for your work.

## Quick start

For PostgreSQL, select the driver and enter a connection name, host, port, database, username, optional password, SSL mode, and optional certificate file paths. Choose **Test connection** to open a temporary driver, load metadata, and close it without replacing the active connection. Choose **Connect** after the test passes to switch the editor to the new native connection.

For MySQL or MariaDB, select **MySQL / MariaDB** and enter the host, port (default `3306`), database, username (default `root`), optional password, SSL mode, and optional CA/client certificate paths. QueryX loads tables, views, columns, row-count estimates, and indexes through `information_schema`.

For SQL Server, select **SQL Server** and enter the host, port (default `1433`), database (default `master`), SQL login (default `sa`), and password. QueryX uses SQL authentication over encrypted TDS by default, validates the server certificate against the platform trust store, and accepts an optional CA certificate path for a private authority. The initial SQL Server slice includes query execution, 256-row result streaming, explicit transactions, atomic edit batches, read-only sessions, SQL Server paging, tables/views/columns/database/schema metadata, inspection-only session/lock explorers, PK/index metadata, composite foreign keys, stored procedure/function metadata, and relation trigger inspection. Windows integrated authentication, AAD tokens, safe query cancellation, routine/trigger edit forms, and richer view dependency metadata are separate roadmap gates.

For Oracle, select **Oracle** and enter the host, port (default `1521`), service name in the **Database** field (for example `FREEPDB1`), username (default `system`), and password. QueryX uses the pure-Rust Tokio-based `oracle-rs` thin client; the initial slice includes query execution, 256-row result streaming, explicit transactions, atomic edit batches, read-only sessions, Oracle `OFFSET … FETCH` paging, users/tables/views/columns/database metadata, routine signatures, and table/view trigger inspection. SID/connect descriptors, wallets, proxy authentication, session/lock explorers, routine/trigger edit forms, and Oracle-specific MERGE import modes are separate roadmap gates.

For SQLite, select SQLite and enter `:memory:` for a temporary database or an absolute database file path.

## Options and behavior

- `Prefer` and `Require` use encrypted connections for SQL Server; SQL Server does not silently downgrade the TDS connection.
- For Oracle, every mode except `Disable` enables TLS with the configured host name; the initial driver accepts CA and client certificate/key paths. Fine-grained `Prefer`/`Require` behavior and wallet-based trust are planned.
- `Verify CA` requires TLS and verifies the server certificate against the configured CA file.
- `Verify Full / Identity` also verifies that the certificate identity matches the host name. PostgreSQL calls this `verify-full`; MySQL/MariaDB maps it to `VERIFY_IDENTITY`.
- `Disable` is intended for trusted local development servers.
- `CA certificate path` points to a PEM/CRT trust bundle. `Client certificate path` and `Client key path` configure mutual TLS when the server requires client authentication. QueryX stores these paths as profile metadata; private key contents never enter QueryX storage.
- **Connect through SSH tunnel** starts the local OpenSSH client with a loopback `-L` forward. The database `Host` and `Port` fields are the destination as seen from the SSH host; the SSH host is the bastion or jump server. Leave local port empty to let QueryX choose one.
- SSH tunnels use `BatchMode`, `ExitOnForwardFailure`, strict host-key checking, and keepalive options. QueryX never accepts, stores, or places SSH passwords/passphrases on a command line; use an agent or an agent-unlocked key according to your platform policy.
- The prior connection stays active until the replacement connection and its metadata both load successfully.
- **Save profile** stores reusable non-secret fields. **Duplicate** creates a safe copy for environment variants, and **Delete** removes a saved profile.
- **Read-only session** is a connection policy, not just a UI preference. SQLite enables `PRAGMA query_only`, PostgreSQL enables `default_transaction_read_only`, and MySQL sets a read-only transaction session plus rejects non-read statements at the native driver boundary.
- On native desktop, profiles are stored in the QueryX app-local data directory. The optional password is stored separately in the platform OS keychain; only a `passwordStored` marker is persisted with the profile. The browser preview uses localStorage as a development fallback and never stores passwords.
- All built-in drivers return the same result and metadata shapes to the UI; unsupported vendor-specific metadata is represented as an empty capability area until implemented.

## Safety and privacy

Connections go directly from the local Tauri process to the selected database. QueryX has no relay server and does not send connection data to a QueryX service. Native passwords are held in memory for the current pool and, only when explicitly enabled, in the platform OS keychain; they are not written to localStorage, SQLite, workspace files, history, logs, or connection summaries.

Saved profiles never contain passwords. On native desktop, enable **Store in OS keychain** to load the password when selecting the profile after restart. Disable it or delete the profile to remove the keychain entry. Browser preview always asks for the password for the current session.

## Troubleshooting

- A timeout usually means the host or port is unreachable or blocked by a firewall.
- Authentication failures should be resolved by checking the username, password, database access rule, and server authentication configuration.
- If TLS negotiation fails on a local SQL Server test server using a self-signed certificate, install the issuing CA or provide its CA path; use `Disable` only for a trusted local development server. Keep encrypted verification for production networks.
- A verify mode without a readable CA file will fail during connection creation. Check the path and file permissions in the native desktop process.
- If an SSH tunnel fails, check that the native `ssh` command is installed, the SSH user can authenticate non-interactively, the bastion's `known_hosts` entry is trusted, and the destination host/port is reachable from the bastion.
- QueryX keeps the current connection when a replacement connection fails, so you can correct the fields and retry.
- A successful connection test does not change the active connection. This makes it safe to validate credentials or a copied environment profile before switching workspaces.

## Related

- [PostgreSQL Driver](postgres-driver.md)
- [SQLite Driver](sqlite-driver.md)
- [MySQL/MariaDB Driver](mysql-driver.md)
- [SQL Server Driver](sqlserver-driver.md)
- [Oracle Driver](oracle-driver.md)
- [Driver API](driver-api.md)
