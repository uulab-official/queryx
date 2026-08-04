# Workspaces

## What it does

QueryX keeps the everyday query workflow close to the user: query history and favorites are available in the Explorer sidebar, and saved SQL can be recalled into the active tab without executing it. **Quick Open** searches both collections from Cmd/Ctrl+P.

## Before you start

The current alpha stores query tabs, history, and favorites in browser-local storage for the preview renderer. Tabs, active-tab selection, dirty state, and SQL text are restored after a reload or reopening the preview profile. This is a convenience layer, not the final native workspace database.

Connection profiles follow a separate secret-free boundary: the native desktop stores up to 50 reusable profiles in its app-local data directory, while the browser preview uses localStorage. Profile files contain driver, endpoint, database, username, and TLS mode only. Passwords are entered per session and are never migrated into the profile file.

## Quick start

1. Run a query. Successful, failed, and cancelled executions appear under **Recent queries**.
2. Select the SQL you want to keep and click the ♡ button in the editor toolbar.
3. Reopen it from **Favorites** in the Explorer. QueryX replaces the active tab text but never runs the saved SQL automatically.
4. Click the filled heart again, or use Cmd/Ctrl+K → **Remove favorite**, to remove it.

For a larger workspace, press Cmd/Ctrl+P or click the Explorer search icon. Type part of a query label, SQL statement, or “favorite”/“recent” to narrow the list, then press Enter to load the selected query.

Favorites are deduplicated by normalized SQL text and capped at 50 entries. Labels are generated from the first non-comment line; SQL comments and the query body remain unchanged.

## Options and behavior

- Recent history keeps the latest 20 distinct SQL statements and records execution status.
- Use the `•••` action beside **Recent queries** to clear the entire locally stored history after confirmation. Favorites and open query tabs are not affected.
- Favorites keep the latest saved statements and their local creation time.
- Cmd/Ctrl+K includes **Save favorite** or **Remove favorite** for the active document.
- Cmd/Ctrl+P opens Quick Open; it merges favorites first and then distinct recent queries, de-duplicated by SQL text.
- Query tabs and active-tab selection are restored locally, up to 20 tabs. A corrupted or older snapshot is ignored and the default Daily revenue tab is recreated. Restored SQL is never executed automatically; run it explicitly after review.
- Recalling a favorite marks the active tab dirty so the user can review the change before running it.
- The sidebar shows the first three favorites and recent entries; Quick Open searches the full stored lists. An empty history shows an explicit empty state rather than demo records.

## Safety and privacy

Saving, recalling, or clearing local history never connects to a database. Recalling a favorite never executes SQL. Query text stays in the local renderer storage. Passwords and connection secrets are not included in favorites, history, localStorage, workspace files, or logs.

The browser-local query persistence is best-effort and can be cleared by the host profile. Native SQLite storage for tabs, history, favorites, settings, migrations, cross-profile workspaces, and OS-keychain integration remain planned for v0.2.

## Troubleshooting

If a favorite disappears after clearing site data or changing the preview profile, save it again. If local storage is unavailable or full, QueryX continues to work in memory and shows no secret-bearing fallback.

## Related

- [SQL Editor](sql-editor.md)
- [Connections](connections.md)
- [Architecture](architecture.md)
- [Roadmap](../ROADMAP.md)
