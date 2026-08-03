# ADR-0012: Reuse the execution path for non-executing EXPLAIN plans

- Status: Accepted
- Date: 2026-08-03

## Context

The driver contract already advertises an `explain` capability, and PostgreSQL and SQLite both support a non-executing `EXPLAIN` statement. The desktop toolbar previously displayed only a placeholder notification. A separate native plan command would duplicate query ID registration, cancellation, result normalization, history, and error handling before QueryX has a structured plan model.

## Decision

The baseline **Explain** action:

1. Requires the active driver to advertise `explain`.
2. Accepts the active SQL document as one statement and rejects multiple statements before execution.
3. Generates `EXPLAIN <statement>` only; it never generates `EXPLAIN ANALYZE`.
4. Reuses the existing `execute(sql, signal)` path, so result normalization, cancellation, errors, and local history remain consistent.
5. Renders plan rows in the existing result grid with the standard filter, sort, JSON, and export affordances.

The plan wrapper is implemented in the shared core package so browser preview and native execution follow the same validation. A future structured plan model may add visual graphs and explicit `EXPLAIN ANALYZE` controls without changing the safety boundary of this action.

## Alternatives considered

1. **Dedicated native explain command:** deferred because it duplicates the execution lifecycle and does not yet provide a structured cross-driver model.
2. **Frontend-only placeholder:** rejected because it leaves a declared capability unused and does not help users diagnose query performance.
3. **Generate EXPLAIN ANALYZE:** rejected for the baseline because it executes the target statement and can mutate data or consume production resources.

## Consequences

- Users get an actual plan in the existing result workflow for both supported drivers.
- Explain results inherit native cancellation and query history behavior.
- The current plan is text/row based; it is not a graphical plan tree.
- Multi-statement documents require selecting one statement before a future selection-aware Explain command can be added.
- `EXPLAIN ANALYZE`, buffers, timing, format selection, and cost limits remain explicit future controls.

## Verification

- Core tests cover empty input, quoted semicolons, single-statement wrapping, existing EXPLAIN rejection, and multi-statement rejection.
- In-memory browser results provide deterministic plan rows.
- Native drivers already expose `explain` and classify EXPLAIN as row-returning; the UI reuses the existing execution/cancellation path.
