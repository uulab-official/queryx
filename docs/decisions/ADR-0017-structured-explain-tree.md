# ADR-0017: Normalize text execution plans into a shared tree

- Status: Accepted
- Date: 2026-08-06

## Context

Explain output was previously only visible as ordinary result rows. That is correct but makes parent/child operators and cost regressions difficult to scan, especially for PostgreSQL and MySQL users who expect a plan inspector.

## Decision

`packages/core/src/planTree.ts` recognizes explicit plan columns (`QUERY PLAN`, `EXPLAIN`, and `PLAN`), reads text rows, tracks indentation and `->` operator hierarchy, and extracts metrics only when the database reports them. The desktop result pane exposes the normalized nodes through a collapsible Plan view while preserving the raw Table/JSON views.

Unknown or vendor-specific plan shapes remain raw results rather than being guessed into a false tree. JSON plan normalization, graphical layout, cost limits, and additional driver contracts are separate extensions.

## Consequences

- Explain/Analyze results are more useful for daily query tuning without changing the driver or database contracts.
- The parser is dependency-free and deterministic in the browser preview and native desktop.
- The normalized tree is presentation data, not a replacement for the database's native plan or optimizer semantics.
