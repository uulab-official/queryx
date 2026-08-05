# Data Compare and Controlled Synchronization

QueryX can compare one selected table between the active connection and another saved connection using the same driver. It generates a reviewable synchronization plan and can apply only the selected changes to the target in one native transaction.

## Workflow

1. Connect to the source database and select a table with a primary key.
2. Open Cmd/Ctrl+K and choose **Compare selected table data**.
3. Choose a saved target profile for the same driver. Enter the target password for this session, or use its existing OS-keychain entry.
4. QueryX opens the target read-only for comparison, checks the target table and primary-key shape, and reads both row sets.
5. Select or clear individual INSERT, UPDATE, and DELETE changes.
6. Choose **Open SQL preview** to review/edit the generated statements, or **Apply selected** to run them through the target's native transaction batch.

The active connection is the source of truth. A missing source row becomes a target DELETE; a missing target row becomes an INSERT; and differing non-key columns become an UPDATE. The target table must contain every source column and the same ordered primary-key definition.

## Safety boundary

- Comparison executes only bounded `COUNT(*)` and `SELECT` reads on source and target.
- Comparison is capped at 10,000 rows. A count mismatch, incomplete result, duplicate key, missing key, or missing target column blocks synchronization.
- UPDATE and DELETE predicates include the captured target values, not only the primary key. If a target row changed after comparison, the affected-row check fails and the native batch rolls back.
- DELETE changes are explicitly marked destructive and require the same confirmation as other synchronization changes.
- A read-only target profile can be compared and previewed, but its Apply action is disabled.
- Passwords remain in the current process or OS keychain; target configuration is held only in memory for the comparison session.

## Current limits

The first slice compares one table at a time and requires a primary key. It does not yet stream multi-million-row comparisons, compare views or arbitrary query results, reconcile LOB-specific values, or synchronize across different database dialects. These are separate parity gates because they require a disk-backed sort/hash strategy and vendor-specific value semantics.

## Related

- [Results and CSV Export](results.md)
- [Schema Compare](schema-compare.md)
- [DDL Workflow](ddl-workflow.md)
- [Driver API](driver-api.md)
- [Roadmap](../ROADMAP.md)
