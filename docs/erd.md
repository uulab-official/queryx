# Entity Relationship Diagram

QueryX can open a bounded ERD from the current metadata snapshot. Use **Open ERD** from the command palette after connecting.

The diagram currently includes:

- tables and views from the active connection;
- primary-key markers, database-reported column types, and the first eight columns per node;
- directional foreign-key edges between visible tables;
- direct view-reference edges reported by the driver;
- relation search, zoom, keyboard focus, and click-through to the Inspector.

The graph is deterministic and capped at 120 relations so opening a large catalog does not create an unbounded SVG or IPC payload. Filtering hides unrelated nodes and edges while preserving the snapshot layout. Refresh metadata and reopen the diagram after external schema changes.

This is an exploration surface, not a schema designer. QueryX does not yet move nodes, save or export diagrams, lazy-load large schemas, infer relationships from arbitrary view SQL, or execute DDL from the canvas. Use the [DDL workflow](ddl-workflow.md) and [schema compare](schema-compare.md) for reviewed SQL changes.

Driver coverage follows the metadata contract: PostgreSQL and SQLite provide the broadest relation graph; MySQL/MariaDB provides the current table/view/foreign-key/dependency slice. Hidden objects remain hidden when catalog permissions prevent the driver from returning them.

## Verification

The core layout is covered by deterministic tests for stable node ordering, foreign-key and view-reference edges, and bounded-graph behavior. UI smoke coverage should confirm: connect → open command palette → Open ERD → filter → select a node → Inspector.
