# Getting Started

This guide gets the native QueryX alpha running and executes a first query against its seeded local SQLite database.

## Before you start

Install Node.js 22, pnpm 11, Rust stable, and the [Tauri 2 platform prerequisites](https://v2.tauri.app/start/prerequisites/). Linux requires WebKitGTK and the additional native packages listed by Tauri.

## Run the desktop app

```bash
git clone https://github.com/uulab-official/queryx.git
cd queryx
pnpm install
pnpm --filter @queryx/desktop tauri:dev
```

QueryX opens with a temporary, seeded SQLite database. Enter SQL in the active tab and press Ctrl+Enter on Windows/Linux or Cmd+Enter on macOS. A selection runs only the selected SQL; otherwise the complete active document runs.

Try:

```sql
SELECT *
FROM orders
ORDER BY day DESC;
```

Inspect the result as a table or JSON, filter locally, sort a column, and choose **Export** to save the visible rows as CSV.

## Connect your database

Open the connection dialog from the Explorer plus button or the current connection name. SQLite accepts `:memory:` or an absolute file path. PostgreSQL requires host, port, database, username, optional password, and an SSL mode.

Use a dedicated, least-privilege account. QueryX holds the password in memory for the session and asks again after restart because saved profiles and OS keychain integration are not yet implemented.

## Frontend-only development

```bash
pnpm dev
```

The browser preview uses deterministic in-memory data and supports browser CSV downloads. It does not create real SQLite/PostgreSQL connections.

## Verify the checkout

```bash
pnpm run verify
pnpm run typecheck
pnpm run test
pnpm run build
```

For native checks, continue with the commands in the [Testing Guide](testing.md). If startup or connection fails, use [Troubleshooting](troubleshooting.md).
