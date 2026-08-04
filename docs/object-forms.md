# Object Forms

QueryX now provides table-focused object-specific DDL forms from the command palette: **Create table from form**, **Add column to selected table**, **Edit columns in selected table**, and **Create index on selected table**.

The form supports:

- schema selection from the current metadata snapshot;
- table and column names with dialect-aware identifier quoting;
- database type text, required/nullability, single-column primary keys, and composite primary keys;
- duplicate-name, missing-field, and unsafe type-fragment validation;
- generated SQL preview in a normal query tab;
- explicit one-statement transaction apply followed by metadata refresh.

The add-column form additionally checks the selected table for duplicate names and generates a dialect-aware `ALTER TABLE ... ADD COLUMN` statement. It supports required/nullability and leaves defaults, generated values, and constraints in the editable SQL preview.

The edit-columns form supports type and nullability changes plus non-primary-key column removal. PostgreSQL and MySQL/MariaDB receive dialect-aware executable statements. SQLite rebuild-required changes are shown as manual review and cannot be applied from the form. Primary-key changes remain manual across drivers.

The index form supports ordered single- and multi-column indexes, UNIQUE indexes, duplicate-name validation, missing-column validation, and redundancy warnings. It generates dialect-aware `CREATE INDEX` SQL and applies it only after confirmation.

The form never creates a table merely because a field changes. **Create table** asks for confirmation and is disabled for read-only connections or invalid input. The SQL preview remains editable for defaults, foreign keys, indexes, generated columns, partitions, and vendor-specific clauses.

Column renames, index alteration/drop, view, constraint, routine, and trigger forms remain planned. Use [schema compare](schema-compare.md) for reviewed multi-object changes and [DDL workflow](ddl-workflow.md) for catalog-rendered definitions.
