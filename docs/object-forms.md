# Object Forms

QueryX now provides object-specific DDL forms from the command palette: **Create table from form**, **Add column to selected table**, **Edit columns in selected table**, **Create index on selected table**, **Add table constraint**, **Drop index on selected table**, **Rename index on selected table**, **Add foreign key to selected table**, **Drop foreign key from selected table**, **Create view from form**, **Edit definition of selected view**, and **Drop selected view**.

The form supports:

- schema selection from the current metadata snapshot;
- table and column names with dialect-aware identifier quoting;
- database type text, required/nullability, single-column primary keys, and composite primary keys;
- duplicate-name, missing-field, and unsafe type-fragment validation;
- generated SQL preview in a normal query tab;
- explicit one-statement transaction apply followed by metadata refresh.

The add-column form additionally checks the selected table for duplicate names and generates a dialect-aware `ALTER TABLE ... ADD COLUMN` statement. It supports required/nullability and leaves defaults, generated values, and constraints in the editable SQL preview.

The edit-columns form supports column renames, type and nullability changes, plus non-primary-key column removal. PostgreSQL, MySQL/MariaDB, SQL Server, and Oracle receive dialect-aware executable statements; SQL Server uses `sys.sp_rename` and MySQL/MariaDB uses `CHANGE COLUMN` when a rename is combined with type/nullability changes. SQLite rebuild-required renames and alterations are shown as manual review and cannot be applied from the form. Primary-key changes remain manual across drivers.

The index form supports ordered single- and multi-column indexes, UNIQUE indexes, duplicate-name validation, missing-column validation, and redundancy warnings. It generates dialect-aware `CREATE INDEX` SQL and applies it only after confirmation.

The table-constraint form supports named composite or single-column UNIQUE constraints and named CHECK constraints. It validates identifiers, duplicate/missing columns, redundant unique indexes, comments, delimiters, mutating/DDL keywords, and unbalanced CHECK parentheses. PostgreSQL, MySQL/MariaDB, SQL Server, and Oracle receive executable `ALTER TABLE ... ADD CONSTRAINT` SQL; SQLite shows a manual table-rebuild review because it cannot add table constraints with the current safe form boundary.

The drop-index form supports regular indexes and protects primary indexes. PostgreSQL/SQLite use schema-qualified `DROP INDEX`; MySQL/MariaDB uses `DROP INDEX ... ON table`. Primary-key removal remains a manual SQL operation.

The rename-index form validates the current index, new-name collisions, and no-op renames. PostgreSQL/Oracle use `ALTER INDEX ... RENAME TO`, MySQL/MariaDB uses `ALTER TABLE ... RENAME INDEX`, and SQL Server uses `sys.sp_rename`. Primary indexes and SQLite renames are shown as manual review and cannot be applied from the form.

The foreign-key forms support named single- and composite-column relationships, visible referenced tables, `ON UPDATE`/`ON DELETE` actions, duplicate/missing-column validation, and dialect-aware SQL. PostgreSQL uses `DROP CONSTRAINT`, MySQL/MariaDB uses `DROP FOREIGN KEY`, and SQLite additions/removals remain manual table-rebuild operations.

The create-view form accepts one read-only `SELECT` or `WITH` definition, checks schema/name collisions against the current metadata snapshot, rejects comments, delimiters, and mutating DML/DDL keywords, and applies the generated dialect-aware `CREATE VIEW` statement only after confirmation. The SQL preview can also be opened in a normal query tab for review or vendor-specific edits.

The edit-view form validates the replacement definition against the current view snapshot. PostgreSQL and MySQL/MariaDB use `CREATE OR REPLACE VIEW`; SQLite uses a two-statement drop/create transaction and displays a dependent-object warning because SQLite has no replace form. The drop-view form always previews quoted SQL and warns when the dependency graph reports known objects using the view; the database remains authoritative and may reject the operation.

Routine, relation-trigger, and PostgreSQL event-trigger inspectors provide **Edit form** in addition to **Edit in SQL**. The definition form keeps the catalog-rendered definition editable, rejects missing/non-DDL or multiple top-level definitions, previews the exact vendor definition, and applies it only after confirmation in one transaction. PostgreSQL, MySQL/MariaDB, SQL Server, and Oracle definitions are sent to the selected driver for final validation; SQLite definition replacement remains manual review. **Edit in SQL** remains available for vendor-specific multi-step work.

The form never creates a table merely because a field changes. **Create table** asks for confirmation and is disabled for read-only connections or invalid input. The SQL preview remains editable for defaults, foreign keys, indexes, generated columns, partitions, and vendor-specific clauses.

Broader index alteration and multi-object routine/trigger migration forms remain planned. Use [schema compare](schema-compare.md) for reviewed multi-object changes and [DDL workflow](ddl-workflow.md) for catalog-rendered definitions.
