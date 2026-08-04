# ADR-0011: Use a safe editor handoff for DDL changes

- Status: Accepted
- Date: 2026-08-03

## Context

QueryX already reconstructs useful DDL for PostgreSQL functions, procedures, relation triggers, and event triggers. An object-specific Apply action would need privilege preflight, generated SQL diffing, vendor-specific transactional semantics, rollback guarantees, migration history, and recovery UI. Implementing that boundary prematurely would make the Inspector both a catalog viewer and a mutation engine.

Users still need a practical way to take an inspected definition into their normal SQL workflow. The existing editor already owns SQL text, tabs, Safe Mode, transaction execution, errors, cancellation, and local history behavior.

## Decision

Keep Inspector DDL read-only and add an explicit **Edit in SQL** handoff:

1. The Inspector sends the reconstructed definition to the app shell.
2. The shell creates a new query tab and sets its SQL text.
3. No execution occurs during selection, copy, or handoff.
4. The user reviews or edits the statement and explicitly chooses **Run in Transaction**.
5. The existing native transaction command owns commit and rollback. Errors preserve the SQL tab for correction.
6. **Refresh metadata** loads a new driver snapshot after a change; it never executes user SQL.

The shared metadata model remains additive. Aggregate/window routines without an executable database-rendered definition do not offer the handoff. No object-specific create/alter/drop command or migration ledger is added in this slice.

## Consequences

- DDL changes use one familiar SQL execution path and one transaction state machine.
- Selecting or copying catalog text cannot mutate the database.
- The editor can support review, undo, correction, and ordinary query history without a second DDL state model.
- Users must review reconstructed SQL and understand database-specific transactional DDL behavior.
- Generic schema diffing, privilege-preflight SQL, dependency ordering, rollback preview, and local preview history now live in Schema Compare. Applied-migration confirmation, native durable history, and object-specific previews remain explicit roadmap work.

## Verification

- TypeScript and browser smoke checks confirm that **Edit in SQL** opens a new tab without a result or automatic execution.
- The transaction action remains available in the editor and routes through the native transaction command.
- Documentation links and the roadmap identify the workflow and its limits.
