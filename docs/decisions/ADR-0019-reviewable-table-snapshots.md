# ADR-0019: Reviewable loaded-row table snapshots

- Status: Accepted
- Date: 2026-08-06

## Context

QueryX can edit table rows and can preview high-risk DDL, but a user needs a local recovery artifact before changing a disposable or production-like schema. A full database dump is vendor-specific, potentially expensive, and requires a native backup/restore contract that QueryX does not yet have.

## Decision

QueryX adds a local SQL snapshot action for the selected table. It serializes the currently loaded table-browser rows, a best-effort `CREATE TABLE`, dialect-aware `INSERT` statements, and `BEGIN`/`COMMIT`. The header records the loaded row count and the metadata-reported row count, explicitly marking the snapshot complete or partial. Unrecognized catalog type labels cause the generated `CREATE TABLE` to be omitted rather than interpolated.

The Inspector exposes **Snapshot**. Safe Mode exposes the same action before `ALTER`, `DROP`, and `TRUNCATE` when a selected table and loaded table result are available. Neither path claims to produce a complete backup, and neither performs an automatic restore or database write.

## Consequences

- Users have a reviewable, portable starting point before high-risk schema work.
- Partial coverage is visible in the artifact and in the UI guidance, reducing the chance of treating the export as a full backup.
- Full database-native dump/restore, all-row streaming to disk, indexes, foreign keys, sequences, permissions, and vendor-specific restore semantics remain explicit roadmap work.
