# Session Explorer

The native desktop app includes a session explorer for PostgreSQL and MySQL/MariaDB. Open it from the top-bar activity control or the command palette after connecting to a native network database.

## What it shows

Each visible database session includes:

- database user, database name, client address, and application name when the server exposes them;
- active, idle, idle-in-transaction, waiting, or unknown state;
- current query text when permitted by the database role;
- query start time and elapsed duration when the server exposes them;
- wait event/type, such as a PostgreSQL lock wait or a MySQL metadata-lock wait;
- whether QueryX can request cancellation for that session.

PostgreSQL data comes from `pg_stat_activity`. MySQL/MariaDB data comes from `SHOW FULL PROCESSLIST`. Visibility is controlled by the connected database account; QueryX does not elevate privileges or reconstruct hidden sessions.

## Safe cancellation

The **Cancel** action requests cancellation of the running query only:

- PostgreSQL uses `pg_cancel_backend(pid)`;
- MySQL/MariaDB uses `KILL QUERY connection_id`.

QueryX does not terminate the database connection from this panel. The current QueryX session is protected from self-cancellation. A cancellation can still fail if the database role lacks the required privilege or if the query has already finished; the server error is shown in the dialog.

Refreshing the list is explicit, so the panel does not poll continuously or create hidden workload. Query text and session metadata stay inside the local native process and connected database boundary.

## Limitations

The current slice does not yet draw a blocker/blocked lock graph, retain session history, show server wait statistics, or provide configurable long-query alerts. Those are separate operational IDE roadmap items. SQLite and browser preview intentionally do not claim session inspection.
