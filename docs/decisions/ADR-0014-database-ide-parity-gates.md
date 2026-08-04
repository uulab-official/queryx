# ADR-0014: Use Evidence-Gated Database IDE Parity

## Status

Accepted

## Context

QueryX is often compared with DBeaver, pgAdmin, phpMyAdmin, and SQL Developer. A collection of visually similar panels is not enough to establish parity: each tool has different database breadth, schema operations, import/export behavior, transaction semantics, and operational workflows. A marketing percentage would hide the gaps that matter most when a user is working against production data.

## Decision

Track parity by user workflow using `available`, `partial`, and `planned` states. A workflow can be `available` only when its implementation, tests, documentation, and recovery behavior are present in the repository. Database-specific gaps remain explicit in the driver capability and metadata contracts.

The matrix is maintained in [parity-matrix.md](../parity-matrix.md). Every roadmap release gate must link to implementation evidence and must preserve honest partial states when only one database or scale tier is supported.

## Consequences

- Product decisions prioritize complete connect → query → inspect → edit/export workflows over isolated controls.
- Unsupported vendor features remain hidden or clearly marked instead of appearing as broken UI.
- Release notes can state exactly which database and scale combinations were verified.
- The project can improve toward DBeaver/pgAdmin/phpMyAdmin/SQL Developer breadth without claiming equivalence before the evidence exists.
