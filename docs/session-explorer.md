# Session Explorer

The native desktop app includes a session explorer and point-in-time lock graph for PostgreSQL, MySQL/MariaDB, and SQL Server. Open either panel from the top-bar operations controls or the command palette after connecting to a native network database.

## What it shows

Each visible database session includes:

- database user, database name, client address, and application name when the server exposes them;
- active, idle, idle-in-transaction, waiting, or unknown state;
- current query text when permitted by the database role;
- query start time and elapsed duration when the server exposes them;
- wait event/type, such as a PostgreSQL lock wait or a MySQL metadata-lock wait;
- whether QueryX can request cancellation for that session.

PostgreSQL data comes from `pg_stat_activity`. MySQL/MariaDB data comes from `SHOW FULL PROCESSLIST`. SQL Server data comes from `sys.dm_exec_sessions`, `sys.dm_exec_requests`, and `sys.dm_exec_sql_text`. Visibility is controlled by the connected database account; QueryX does not elevate privileges or reconstruct hidden sessions.

## Safe cancellation

The **Cancel** action requests cancellation of the running query only:

- PostgreSQL uses `pg_cancel_backend(pid)`;
- MySQL/MariaDB uses `KILL QUERY connection_id`.
- SQL Server exposes activity and lock waits, but does not expose a query-only cancellation action yet; `KILL session_id` would terminate the connection and is intentionally not used.

QueryX does not terminate the database connection from this panel. The current QueryX session is protected from self-cancellation. A cancellation can still fail if the database role lacks the required privilege or if the query has already finished; the server error is shown in the dialog.

Refreshing the list is explicit, so the panel does not poll continuously or create hidden workload. Query text and session metadata stay inside the local native process and connected database boundary.

## Lock graph

The lock graph shows visible blocked → blocking relationships at refresh time:

- PostgreSQL reads `pg_locks` joined with `pg_stat_activity` and preserves the lock type, resource, requested/held modes, query text, and blocked-query age.
- MySQL 8 reads `performance_schema.data_lock_waits` and `data_locks`; MariaDB and older compatible installations fall back to `information_schema.innodb_lock_waits`, `innodb_locks`, and `innodb_trx` when those views are available.
- SQL Server reads `sys.dm_os_waiting_tasks` and joins visible request SQL text to show blocked → blocking relationships. Lock modes are left empty when the waiting-task view does not expose a stable held/requested mode pair.
- The **Cancel blocker** action routes through the same query-cancellation contract as the session explorer. It never uses `pg_terminate_backend`, `KILL CONNECTION`, or an equivalent connection-kill operation.

Database privileges and server configuration control which lock rows and query text are visible. If neither the Performance Schema nor InnoDB lock views are available, the driver reports the server error rather than presenting an invented empty graph.

## Long-running query diagnostics

The query diagnostics panel reuses the session snapshot and shows only `active` or `waiting` sessions whose observed duration is at least the selected local threshold: 5 seconds, 30 seconds, 1 minute, or 5 minutes. Results are ordered by duration and marked `elevated` or `critical` when they reach six times the threshold. The threshold is stored in local browser/app state; QueryX does not send telemetry or poll in the background. Refresh is explicit, and **Cancel query** uses the same query-only cancellation boundary as the session explorer.

## Redacted audit history

Every explicit session refresh can append a local observation to **Session audit history**. An observation stores the driver, local connection label, database/session identifiers, state, duration, wait event, a redacted query preview, and an eight-character query-shape fingerprint. Single/double-quoted, backtick-delimited, and dollar-quoted values, numeric literals, and SQL comment contents are replaced before persistence; raw query text is never copied into this audit trail.

Retention is configurable to **Off**, 1 day, 7 days, or 30 days. The history is capped at 500 observations, persists through the versioned native workspace snapshot or browser local storage, and has an explicit **Clear** action. This history is local-only and is not a replacement for a server-side audit log.

## Limitations

The current slice does not show server wait statistics. Oracle, SQLite, and browser preview intentionally do not claim session, lock, or query-diagnostics inspection. SQL Server session/lock rows are inspection-only; query cancellation remains unavailable until a safe query-only mechanism is implemented.
