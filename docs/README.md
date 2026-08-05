# QueryX Documentation

Use this index to find the shortest path for your task. Documentation describes the current alpha behavior; planned features are clearly marked rather than presented as available.

## Use QueryX

- [Getting Started](getting-started.md) — prerequisites, native startup, first connection, first query
- [Connections](connections.md) — SQLite/PostgreSQL/MySQL/SQL Server fields, TLS, credential behavior
- [SSH Tunnels](ssh-tunnels.md) — bastion forwarding, authentication boundary, host-key verification, and troubleshooting
- [Session Explorer](session-explorer.md) — native activity/process inspection, lock graph, long-running diagnostics, redacted audit history, wait events, cancellation, and safety boundaries
- [SQL Editor](sql-editor.md) — tabs, completion, shortcuts, cancellation
- [DDL Workflow](ddl-workflow.md) — inspect, edit, preview, execute, recover, and refresh metadata safely
- [Object Forms](object-forms.md) — table creation form, validation, SQL preview, and safe apply boundaries
- [Schema Compare](schema-compare.md) — capture a baseline, review metadata changes, and open migration SQL safely
- [Results and CSV Export](results.md) — table/JSON views, filter, sort, native save, data safety
- [CSV Import](import.md) — header mapping, typed preview, validation, and transactional batch import
- [Metadata Explorer](metadata-explorer.md) — schemas, relations, routines, triggers, and dependency navigation
- [Entity Relationship Diagram](erd.md) — bounded schema graph, relationship edges, filtering, zoom, and Inspector navigation
- [Routine Inspector](routine-inspector.md) — overload identity, functions/procedures/aggregates/window functions, read-only PostgreSQL DDL, safety, and recovery
- [Trigger Inspector](trigger-inspector.md) — activation modes, events, owner navigation, and read-only DDL
- [Event Trigger Inspector](event-trigger-inspector.md) — database-scoped PostgreSQL DDL events, tags, function navigation, and reconstructed DDL
- [Dependency Inspector](dependency-inspector.md) — Depends on / Used by semantics, navigation, and driver coverage
- [Troubleshooting](troubleshooting.md) — setup, connection, rendering, export, and build recovery

## Understand the system

- [Architecture](architecture.md) — trust boundaries and package responsibilities
- [Driver API](driver-api.md) — shared contracts and capabilities
- [SQLite Driver](sqlite-driver.md), [PostgreSQL Driver](postgres-driver.md), [MySQL/MariaDB Driver](mysql-driver.md), and [SQL Server Driver](sqlserver-driver.md)
- [Database IDE Capability Matrix](parity-matrix.md) — evidence-gated comparison and release gates
- [Architecture decisions](decisions/) — rationale for foundational choices

## Contribute and operate

- [Testing Guide](testing.md) — local and CI quality gates
- [Release Process](release-process.md) — versioning, release evidence, rollback
- [Desktop Updates](updates.md) — signed updater feed, GitHub Actions release, secrets, and rollback
- [Documentation Plan](DOCUMENTATION_PLAN.md) — information architecture and writing rules
- [Contributing](../CONTRIBUTING.md), [Security](../SECURITY.md), and [Roadmap](../ROADMAP.md)
