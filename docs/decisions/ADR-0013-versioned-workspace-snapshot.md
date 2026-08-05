# ADR-0013: Use a versioned workspace snapshot before the SQLite migration

## Status

Superseded by [ADR-0015](ADR-0015-native-workspace-sqlite.md). The versioned snapshot contract remains the compatibility shape inside the native SQLite store.

## Context

The desktop shell already restores query tabs, history, and favorites in the browser preview, but a native restart previously rebuilt that state from renderer `localStorage`. That made the primary IDE workflow depend on a webview storage implementation and left the native connection profile boundary inconsistent with the rest of the workspace.

The workspace schema is still changing while settings and cross-profile workspaces are not implemented. Moving directly to SQLite would add migrations before the data contract has stabilized. OS-keychain storage is intentionally separate from this workspace decision.

## Decision

Store one versioned, secret-free `workspace.json` snapshot in the Tauri app-local data directory. Version 1 contains:

- query tabs, active tab ID, SQL text, titles, and dirty state;
- the latest 20 query history entries; and
- the latest 50 SQL favorites.

The browser preview uses the same logical snapshot through localStorage. When the native file is absent, QueryX reads a valid browser snapshot once and writes it to the native boundary. A corrupt or incompatible snapshot is ignored and the default tab is recreated. Restoring a snapshot never executes SQL.

Passwords and connection secrets are excluded by type and are not migrated. Connection profiles continue to use their app-local metadata file; native password values are stored separately in the OS keychain when enabled.

## Consequences

This decision established the JSON snapshot contract and the one-time migration rules that the SQLite store now consumes. It remains useful as the historical explanation for the v1 document shape; native persistence, transactional writes, and the migration ledger are defined by ADR-0015.

## Verification

- Browser round-trip tests cover tabs, active selection, history, favorites, empty-history deletion, and fallback behavior.
- The store loads the workspace before the first metadata refresh/query, preventing a startup query from overwriting restored SQL.
- Repository verification and native Tauri builds remain required for every storage change.
