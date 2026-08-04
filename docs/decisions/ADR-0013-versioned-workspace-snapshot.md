# ADR-0013: Use a versioned workspace snapshot before the SQLite migration

## Status

Accepted for the current alpha; SQLite migration remains planned.

## Context

The desktop shell already restores query tabs, history, and favorites in the browser preview, but a native restart previously rebuilt that state from renderer `localStorage`. That made the primary IDE workflow depend on a webview storage implementation and left the native connection profile boundary inconsistent with the rest of the workspace.

The workspace schema is still changing while settings, cross-profile workspaces, and OS-keychain integration are not implemented. Moving directly to SQLite would add migrations before the data contract has stabilized.

## Decision

Store one versioned, secret-free `workspace.json` snapshot in the Tauri app-local data directory. Version 1 contains:

- query tabs, active tab ID, SQL text, titles, and dirty state;
- the latest 20 query history entries; and
- the latest 50 SQL favorites.

The browser preview uses the same logical snapshot through localStorage. When the native file is absent, QueryX reads a valid browser snapshot once and writes it to the native boundary. A corrupt or incompatible snapshot is ignored and the default tab is recreated. Restoring a snapshot never executes SQL.

Passwords and connection secrets are excluded by type and are not migrated. Connection profiles continue to use their separate secret-free app-local file until OS-keychain support is available.

## Consequences

Native restart/recovery now has one durable boundary without prematurely committing to a database schema. The snapshot is easy to inspect and migrate during the alpha, but it does not yet provide transactional writes, settings namespaces, multiple workspaces, or crash-safe journaling. Those requirements are the entry criteria for the planned SQLite migration.

## Verification

- Browser round-trip tests cover tabs, active selection, history, favorites, empty-history deletion, and fallback behavior.
- The store loads the workspace before the first metadata refresh/query, preventing a startup query from overwriting restored SQL.
- Repository verification and native Tauri builds remain required for every storage change.
