# Schema Compare and Migration Preview

QueryX can compare a captured metadata baseline with a later metadata refresh, or inspect a saved same-dialect connection through a temporary read-only connection. This is a review workflow: it generates migration SQL but never executes it automatically.

## Workflow

1. Connect to the target database and wait for metadata to load.
2. In Explorer, choose **⇄** or open the command palette and choose **Capture schema baseline**.
3. Apply or inspect a schema change outside the baseline, then choose **Refresh metadata**.
4. Choose **⇄** again or **Compare schema** from the command palette.
5. Review additive, destructive, dependency-ordered, and manual-review changes. Choose **Open SQL preview** to put the generated migration text in a new SQL tab, or **Open rollback** to inspect the reverse preview.
6. Review, edit, and execute the SQL through the existing Safe Mode or **Run in Transaction** workflow.

To compare another saved connection, choose **Compare connection** in the diff dialog. Select a saved profile for the active driver and enter its password for the current session when needed. QueryX reads only metadata, disconnects the temporary driver, and keeps the active query connection unchanged.

## Current coverage

The comparison engine detects added/removed tables, added/removed/changed columns, added/removed indexes, foreign keys, and views. It emits dialect-aware SQL for PostgreSQL and MySQL/MariaDB. SQLite foreign-key changes and view replacements are marked **MANUAL REVIEW REQUIRED** because SQLite does not provide a safe generic `ALTER TABLE ... ADD/DROP CONSTRAINT` or `CREATE OR REPLACE VIEW` path.

Table creation includes the available primary-key columns. Preview statements use the metadata dependency graph: additive changes wait for referenced tables/views, while destructive changes remove dependent foreign keys/views before their referenced objects. Category priorities remain the deterministic fallback for independent changes. Rollback preview is generated in reverse dependency order when the driver can express the inverse operation; unavailable inverses are marked for manual review. Privilege preflight and a persistent migration ledger are still planned.

The baseline lives in the active desktop session only. Switching the active connection clears it so a snapshot from one database cannot accidentally be compared with another. Cross-dialect comparison is intentionally blocked because generated migration SQL must target a known dialect.

## Safety

- No SQL is sent by Capture or Compare.
- Dependency ordering and rollback preview do not execute or validate SQL against the target; use a least-privilege account and review the final tab before applying it.
- Generated `DROP TABLE`, `DROP COLUMN`, `DROP INDEX`, `DROP VIEW`, foreign-key removals, and type/nullability changes are marked destructive.
- Manual-review changes are emitted as comments instead of executable SQL.
- Open SQL preview creates a normal query tab, preserving the same history, Safe Mode, transaction, and read-only boundaries as other SQL.

## Related

- [DDL Workflow](ddl-workflow.md)
- [Results and CSV Export](results.md)
- [Roadmap](../ROADMAP.md)
