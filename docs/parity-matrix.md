# Database IDE Capability Matrix

This matrix is the source of truth for QueryX parity claims. It compares workflows, not brand reputation or a percentage score. `Available` means the workflow is implemented and covered by a repository gate; `Partial` means a usable slice exists but important vendor or scale cases remain; `Planned` means there is no supported end-to-end workflow yet.

| Workflow | QueryX | DBeaver baseline | pgAdmin baseline | phpMyAdmin baseline | SQL Developer baseline | QueryX evidence |
| --- | --- | --- | --- | --- | --- |
| Local-first direct connection | Partial — SQLite, PostgreSQL, initial MySQL/MariaDB | Available | Available | Available | Available | [connections](connections.md), [drivers](driver-api.md) |
| SQL editor, tabs, completion, formatting | Partial — strong editor slice, dialect parser pending | Available | Available | Partial | Available | [SQL editor](sql-editor.md), [testing](testing.md) |
| Query cancellation | Partial — PostgreSQL only | Available | Available | Partial | Available | [PostgreSQL driver](postgres-driver.md), native tests |
| Result grid, filter, sort, copy, export | Partial — loaded-result virtualization; arbitrary SQL server paging pending | Available | Available | Available | Available | [results](results.md), `resultGrid.test.ts` |
| Table browsing and keyed edits | Partial — SQLite/PostgreSQL/MySQL basic keys; conflict-aware edits | Available | Available | Available | Available | [results](results.md), edit-batch tests |
| Read-only safety boundary | Available for SQLite/PostgreSQL/MySQL initial driver | Available | Available | Available | Available | [connections](connections.md), native read-only tests |
| Schema/object explorer | Partial — broad SQLite/PostgreSQL metadata, initial MySQL basics | Available | Available | Available | Available | [metadata explorer](metadata-explorer.md) |
| DDL inspect → edit → transaction | Partial — safe handoff, no object form builder | Available | Available | Available | Available | [DDL workflow](ddl-workflow.md) |
| Schema diff and migration history | Partial — session baseline and table/column/index SQL preview; ordering/history pending | Available | Partial | Partial | Available | [schema compare](schema-compare.md), [roadmap](../ROADMAP.md) |
| Import wizard and type mapping | Planned | Available | Partial | Available | Available | [roadmap](../ROADMAP.md) |
| SSH tunnels, keychain, certificate files | Planned | Available | Partial | Partial | Available | [connections](connections.md) |
| Signed release and OTA update path | Available — repository workflow and signed updater contract | Varies by distribution | Varies by distribution | Varies by distribution | Varies by distribution | [updates](updates.md), GitHub Actions workflows |

## Release gates

QueryX must not mark the product bar complete until the following evidence exists:

- large-result benchmark with memory, render, cancellation, and export measurements;
- schema diff preview with dependency ordering, rollback SQL, and migration history tests;
- every advertised driver passing the shared connection/query/metadata/read-only contract, plus hosted integration coverage where the database is available;
- documented recovery behavior for failed connections, cancelled queries, conflicts, and failed schema changes.

The current product is therefore a credible local-first alpha with a growing daily-driver workflow, not yet a full replacement for every workflow in DBeaver, pgAdmin, phpMyAdmin, or SQL Developer.
