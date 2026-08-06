# Execution plans

QueryX keeps the database's native plan output intact and adds a shared structured view when the response is a text plan.

## Workflow

1. Enter one SQL statement in the Monaco editor.
2. Choose **Explain** for a non-executing plan, or **Analyze** after reviewing the explicit execution warning.
3. Use **Table** or **JSON** to inspect the raw driver response.
4. Use **Plan** to inspect the parsed operator tree. Nodes can be collapsed and re-expanded; the view shows cost ranges, estimated rows, actual rows, and actual execution time when those metrics are reported.

Explain and Analyze remain one-statement actions. The active query is recorded in local history, and cancellation follows the selected driver's capability contract.

## Supported plan shape

The shared parser currently recognizes common PostgreSQL and MySQL/MariaDB text output:

- PostgreSQL `QUERY PLAN` rows with indentation, `->` child operators, `cost=...`, `rows=...`, `actual time=...`, and operator detail lines such as `Filter` and `Sort Key`.
- MySQL/MariaDB `EXPLAIN ANALYZE` rows with arrow-indented operators and cost/row metrics.

If a driver returns a plan format without recognizable text operators or metrics, QueryX keeps the raw result in Table/JSON and does not show a misleading Plan tab. SQLite virtual-machine rows, vendor-specific JSON plans, and graphical node layout are not yet normalized.

## Safety boundary

Non-executing Explain does not execute the target statement. Analyze does execute it and may invoke functions, write data, acquire locks, or consume production resources; QueryX requires explicit confirmation before sending the database-specific Analyze wrapper.

The Plan view is a presentation layer over the returned result. It does not replace the database optimizer, estimate missing metrics, or claim that a plan is comparable across database vendors.
