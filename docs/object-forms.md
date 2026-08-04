# Object Forms

QueryX now provides table-focused object-specific DDL forms from the command palette: **Create table from form** and **Add column to selected table**.

The form supports:

- schema selection from the current metadata snapshot;
- table and column names with dialect-aware identifier quoting;
- database type text, required/nullability, single-column primary keys, and composite primary keys;
- duplicate-name, missing-field, and unsafe type-fragment validation;
- generated SQL preview in a normal query tab;
- explicit one-statement transaction apply followed by metadata refresh.

The add-column form additionally checks the selected table for duplicate names and generates a dialect-aware `ALTER TABLE ... ADD COLUMN` statement. It supports required/nullability and leaves defaults, generated values, and constraints in the editable SQL preview.

The form never creates a table merely because a field changes. **Create table** asks for confirmation and is disabled for read-only connections or invalid input. The SQL preview remains editable for defaults, foreign keys, indexes, generated columns, partitions, and vendor-specific clauses.

Table type changes, column drops, primary-key changes, view, index, constraint, routine, and trigger forms remain planned. Use [schema compare](schema-compare.md) for reviewed multi-object changes and [DDL workflow](ddl-workflow.md) for catalog-rendered definitions.
