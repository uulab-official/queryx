# Troubleshooting

## The desktop app does not build

Confirm Node.js 22, pnpm 11, and Rust stable are available, then install the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/). On Linux, missing WebKitGTK packages are the most common native build failure. Run `pnpm install --frozen-lockfile`, then retry `pnpm --filter @queryx/desktop tauri:dev`.

## The browser opens but database connections do not work

`pnpm dev` is a frontend-only workflow with an in-memory driver. Start the Tauri app for native SQLite and PostgreSQL connections:

```bash
pnpm --filter @queryx/desktop tauri:dev
```

## PostgreSQL cannot connect

- Verify host, port, database, username, and server access rules.
- Use `Require` when the server requires TLS.
- Use `Disable` only for a trusted local server that does not support TLS.
- Confirm a firewall, VPN, container network, or DNS rule is not blocking the host.
- QueryX keeps the previous connection active when a replacement connection fails; correct the fields and retry.

## A query will not cancel

PostgreSQL advertises native cancellation. SQLite currently does not, so its Run control remains non-cancellable once execution begins. For PostgreSQL, Escape or the Cancel button requests server-side cancellation; network/server timing can delay acknowledgement.

## Results are slow or memory usage grows

The alpha keeps returned rows in memory and has no virtualized grid. Add a deterministic `ORDER BY` and `LIMIT`, narrow selected columns, or aggregate on the server. Do not use the alpha for unbounded production-table browsing.

## CSV export fails

- Confirm the query returned columns; affected-row-only statements cannot be exported.
- Choose a writable path in the native save dialog.
- On macOS or Windows, check whether the destination is protected by operating-system policy.
- The exported set is the visible, locally filtered/sorted set. Clear the filter if the row count is lower than expected.

The active result remains available after a save failure, so choose another location and retry.

## Repository verification fails

`pnpm run verify` checks package versions, required project files, and local Markdown links. Fix the exact missing file, version mismatch, or broken relative target shown in the output. Run the full checklist in [Testing Guide](testing.md) before opening a pull request.

## Report a problem

Use the GitHub bug template with the operating system, commit/version, database family and version, reproducible synthetic SQL, expected behavior, actual behavior, and relevant redacted logs. Report suspected vulnerabilities privately through [SECURITY.md](../SECURITY.md).
