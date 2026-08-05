# Database IDE Capability Matrix

This matrix is the source of truth for QueryX parity claims. It compares workflows, not brand reputation or a percentage score. `Available` means the workflow is implemented and covered by a repository gate; `Partial` means a usable slice exists but important vendor or scale cases remain; `Planned` means there is no supported end-to-end workflow yet.

| Workflow | QueryX | DBeaver baseline | pgAdmin baseline | phpMyAdmin baseline | SQL Developer baseline | QueryX evidence |
| --- | --- | --- | --- | --- | --- |
| Local-first direct connection | Partial — SQLite, PostgreSQL, initial MySQL/MariaDB | Available | Available | Available | Available | [connections](connections.md), [drivers](driver-api.md) |
| SQL editor, tabs, completion, formatting | Partial — strong editor slice, dialect parser pending | Available | Available | Partial | Available | [SQL editor](sql-editor.md), [testing](testing.md) |
| Query cancellation | Partial — PostgreSQL only | Available | Available | Partial | Available | [PostgreSQL driver](postgres-driver.md), native tests |
| Result grid, filter, sort, copy, export | Partial — virtualized loaded pages, 100-row server paging for single SELECT/WITH queries, table-browser server filter/sort, and all native drivers' 256-row streaming; arbitrary-query server filtering remains pending | Available | Available | Available | Available | [results](results.md), [SQLite driver](sqlite-driver.md), [MySQL driver](mysql-driver.md), `resultGrid.test.ts`, `queryPaging.test.ts`, `queryStream.test.ts`, `tableBrowse.test.ts`, native driver contracts |
| Table browsing and keyed edits | Partial — SQLite/PostgreSQL/MySQL primary-key browsing with dialect-aware server filter/sort, deterministic pagination, conflict-aware cell updates, default-aware row insertion, and guarded selected-row deletion; arbitrary-query identity pending | Available | Available | Available | Available | [results](results.md), `tableBrowse.test.ts`, `tableRowInsert.test.ts`, `csvExport.test.ts`, edit-batch tests |
| Read-only safety boundary | Available for SQLite/PostgreSQL/MySQL initial driver | Available | Available | Available | Available | [connections](connections.md), native read-only tests |
| Schema/object explorer | Partial — broad SQLite/PostgreSQL metadata, initial MySQL basics | Available | Available | Available | Available | [metadata explorer](metadata-explorer.md) |
| ER diagram | Partial — deterministic bounded tables/views graph with FK/view edges, filter, zoom, and Inspector navigation; lazy loading, layout persistence, export, and editing pending | Available | Available | Partial | Available | [ERD](erd.md), [roadmap](../ROADMAP.md) |
| DDL inspect → edit → transaction | Partial — safe handoff plus table/column/index/foreign-key create/drop forms, view create/alter/drop, and type-nullability editing; rename/index-alter/CHECK/unique constraint forms pending | Available | Available | Available | Available | [DDL workflow](ddl-workflow.md), [object forms](object-forms.md) |
| Schema diff and migration history | Partial — same-dialect dependency-ordered table/column/index/FK/view forward, rollback, privilege-preflight, explicit transactional apply, and native applied ledger; object forms and vendor breadth pending | Available | Partial | Partial | Available | [schema compare](schema-compare.md), [roadmap](../ROADMAP.md) |
| Import wizard and type mapping | Partial — CSV/JSON mapping, validation, preview, transactional batches, ignore-conflict, and key-based upsert; transforms, progress, and resumable batches pending | Available | Partial | Available | Available | [CSV import](import.md), [roadmap](../ROADMAP.md) |
| SSH tunnels, keychain, certificate files | Partial — native OpenSSH local forwarding, OS-keychain password storage, and PostgreSQL/MySQL/MariaDB CA/client certificate paths; managed jump-host chains remain planned | Available | Partial | Partial | Available | [connections](connections.md), [ssh tunnels](ssh-tunnels.md), [architecture](architecture.md) |
| Signed release and OTA update path | Available — repository workflow and signed updater contract | Varies by distribution | Varies by distribution | Varies by distribution | Varies by distribution | [updates](updates.md), GitHub Actions workflows |

## Release gates

QueryX must not mark the product bar complete until the following evidence exists:

- large-result benchmark with memory, render, cancellation, and export measurements;
- schema diff preview with dependency ordering, rollback SQL, and migration history tests;
- every advertised driver passing the shared connection/query/metadata/read-only contract, plus hosted integration coverage where the database is available;
- documented recovery behavior for failed connections, cancelled queries, conflicts, and failed schema changes.

The current product is therefore a credible local-first alpha with a growing daily-driver workflow, not yet a full replacement for every workflow in DBeaver, pgAdmin, phpMyAdmin, or SQL Developer.
