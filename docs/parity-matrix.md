# Database IDE Capability Matrix

This matrix is the source of truth for QueryX parity claims. It compares workflows, not brand reputation or a percentage score. `Available` means the workflow is implemented and covered by a repository gate; `Partial` means a usable slice exists but important vendor or scale cases remain; `Planned` means there is no supported end-to-end workflow yet.

| Workflow | QueryX | DBeaver baseline | pgAdmin baseline | phpMyAdmin baseline | SQL Developer baseline | QueryX evidence |
| --- | --- | --- | --- | --- | --- |
| Local-first direct connection | Partial — SQLite, PostgreSQL, MySQL/MariaDB, and initial SQL Server/Oracle | Available | Available | Available | Available | [connections](connections.md), [drivers](driver-api.md) |
| SQL editor, tabs, completion, formatting | Partial — strong editor slice, dialect parser pending | Available | Available | Partial | Available | [SQL editor](sql-editor.md), [testing](testing.md) |
| Query cancellation | Partial — PostgreSQL and MySQL/MariaDB; SQL Server and Oracle cancellation remain planned | Available | Available | Partial | Available | [Session Explorer](session-explorer.md), native tests |
| Result grid, filter, sort, copy, export | Partial — virtualized loaded pages, SQL Server/Oracle OFFSET/FETCH plus 100-row server paging for single SELECT/WITH queries, table-browser server filter/sort, and all native drivers' 256-row streaming; arbitrary-query server filtering remains pending | Available | Available | Available | Available | [results](results.md), [SQL Server driver](sqlserver-driver.md), [Oracle driver](oracle-driver.md), `resultGrid.test.ts`, `queryPaging.test.ts`, `queryStream.test.ts`, `tableBrowse.test.ts`, native driver contracts |
| Table browsing and keyed edits | Partial — SQLite/PostgreSQL/MySQL/SQL Server/Oracle metadata-safe browsing, with SQL Server/Oracle atomic edit batches and PK/index/composite-FK metadata; routine/trigger edit forms remain pending | Available | Available | Available | Available | [results](results.md), [SQL Server driver](sqlserver-driver.md), [Oracle driver](oracle-driver.md), `tableBrowse.test.ts`, `tableRowInsert.test.ts`, `csvExport.test.ts`, edit-batch tests |
| Read-only safety boundary | Available for SQLite/PostgreSQL/MySQL/SQL Server/Oracle initial drivers | Available | Available | Available | Available | [connections](connections.md), native read-only tests |
| Schema/object explorer | Partial — broad SQLite/PostgreSQL metadata, MySQL basics, SQL Server tables/views/columns/databases/schemas/routines/triggers, and Oracle tables/views/columns/databases/schemas plus PK/index/composite-FK/dependency metadata | Available | Available | Available | Available | [metadata explorer](metadata-explorer.md), [SQL Server driver](sqlserver-driver.md), [Oracle driver](oracle-driver.md) |
| ER diagram | Partial — deterministic bounded tables/views graph with FK/view edges, filter, zoom, and Inspector navigation; lazy loading, layout persistence, export, and editing pending | Available | Available | Partial | Available | [ERD](erd.md), [roadmap](../ROADMAP.md) |
| DDL inspect → edit → transaction | Partial — safe handoff plus table/column/index/foreign-key create/drop forms, view create/alter/drop, and type-nullability editing; rename/index-alter/CHECK/unique constraint forms pending | Available | Available | Available | Available | [DDL workflow](ddl-workflow.md), [object forms](object-forms.md) |
| Schema diff and migration history | Partial — same-dialect dependency-ordered SQL Server/Oracle-compatible table/column/view SQL, rollback, privilege-preflight, explicit transactional apply, and native applied ledger; richer vendor breadth pending | Available | Partial | Partial | Available | [schema compare](schema-compare.md), [roadmap](../ROADMAP.md) |
| Session and lock explorer | Partial — native PostgreSQL/MySQL/MariaDB/SQL Server session list, point-in-time lock-wait graph, threshold-based long-running query diagnostics, and redacted local session audit history; safe query cancellation remains PostgreSQL/MySQL-only and server wait statistics remain planned | Available | Available | Partial | Available | [session explorer](session-explorer.md), `longRunningDiagnostics.test.ts`, `sessionAudit.test.ts`, native driver tests |
| Import wizard and type mapping | Partial — CSV/JSON mapping, validation, preview, transactional error-mode batches; SQL Server/Oracle ignore/upsert conflict generation remains explicitly gated pending MERGE design | Available | Partial | Available | Available | [CSV import](import.md), [SQL Server driver](sqlserver-driver.md), [Oracle driver](oracle-driver.md), [roadmap](../ROADMAP.md) |
| SSH tunnels, keychain, certificate files | Partial — native OpenSSH local forwarding, OS-keychain password storage, and PostgreSQL/MySQL/MariaDB CA/client certificate paths; managed jump-host chains remain planned | Available | Partial | Partial | Available | [connections](connections.md), [ssh tunnels](ssh-tunnels.md), [architecture](architecture.md) |
| Signed release and OTA update path | Available — repository workflow and signed updater contract | Varies by distribution | Varies by distribution | Varies by distribution | Varies by distribution | [updates](updates.md), GitHub Actions workflows |

## Release gates

QueryX must not mark the product bar complete until the following evidence exists:

- large-result benchmark with memory, render, cancellation, and export measurements;
- schema diff preview with dependency ordering, rollback SQL, and migration history tests;
- every advertised driver passing the shared connection/query/metadata/read-only contract, plus hosted integration coverage where the database is available;
- documented recovery behavior for failed connections, cancelled queries, conflicts, and failed schema changes.

The current product is therefore a credible local-first alpha with a growing daily-driver workflow, not yet a full replacement for every workflow in DBeaver, pgAdmin, phpMyAdmin, or SQL Developer.
