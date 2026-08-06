# ADR-0016: Use a structure-aware Safe Mode scanner before parser-backed analysis

- Status: Accepted
- Date: 2026-08-06

## Context

QueryX must warn before a broad `UPDATE` or `DELETE`, but the first implementation searched the raw SQL text with regular expressions. That could treat `WHERE` inside a string, comment, or nested subquery as a guard, and it could miss a later dangerous statement in a multi-statement document. A full parser for five database families is not yet part of the shared runtime.

## Decision

The shared core now tokenizes the executed SQL for Safe Mode. It skips comments, string literals, quoted identifiers, SQL Server bracket identifiers, and PostgreSQL dollar-quoted strings; tracks parenthesis depth; identifies UPDATE/DELETE statement candidates without treating CTE or column names as commands; checks every DML candidate for a WHERE at the same statement depth; and recognizes high-risk TRUNCATE/DROP/ALTER operations. The UI displays the exact pending SQL and offers Cancel, Run in Transaction, or Execute Anyway.

The scanner remains conservative and deliberately does not estimate affected rows. Parser-backed statement analysis and database-backed plan estimates are separate roadmap items.

## Consequences

- Common cross-dialect Safe Mode false negatives caused by text matching are removed and the behavior is covered by deterministic unit tests.
- The core remains dependency-free and usable in the browser preview and native desktop.
- The scanner is not a complete SQL parser; vendor-specific DML, `MERGE`, and deeper DDL risk analysis still require explicit capability-aware work.
- A future parser can replace the tokenizer behind the same `inspectQuerySafety` contract without changing the UI boundary.
