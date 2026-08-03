# Contributing to QueryX

Thank you for helping build a safer, local-first database IDE. Contributions can include bug reports, documentation, tests, drivers, accessibility improvements, and focused product changes.

## Before you start

- Search existing issues before opening a duplicate.
- Keep credentials, production connection strings, customer data, and proprietary SQL out of issues, fixtures, screenshots, and logs.
- For a vulnerability, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
- Large driver, storage, security, or plugin changes should start with an issue or ADR so the compatibility boundary is clear.

## Development setup

Install Node.js 22, pnpm 11, Rust stable, and the Tauri 2 prerequisites for your platform.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Run the native app with:

```bash
pnpm --filter @queryx/desktop tauri:dev
```

The browser workflow uses a deterministic in-memory driver. Native SQLite works without an external service. Live PostgreSQL tests are opt-in; see [docs/testing.md](docs/testing.md).

## Repository boundaries

- `packages/shared` owns driver-neutral types. Changes here require compatibility review.
- `packages/core` owns deterministic, platform-independent logic and unit tests.
- `apps/desktop/src` owns the React UI and Tauri bridge calls.
- `apps/desktop/src-tauri` owns secrets, native I/O, driver lifecycle, and database operations.
- `docs/decisions` records decisions that are difficult to reverse.

Do not move credentials or unrestricted filesystem/network access into the webview. New Tauri permissions must be minimal and documented.

## Quality checks

Run the complete local harness before submitting a change:

```bash
pnpm run verify
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run check:native
pnpm run test:native
pnpm --filter @queryx/desktop tauri build --no-bundle
```

Add tests for changed behavior. Driver changes must cover success, actionable failure, normalization, transactions, cancellation, metadata, and cleanup as applicable. User-visible changes must update the relevant guide and `CHANGELOG.md`.

## Pull requests

1. Keep one coherent change per pull request.
2. Explain the user problem, solution, safety/privacy impact, and verification evidence.
3. Include screenshots for visible UI changes and redact all connection details.
4. Mark unsupported or deferred behavior explicitly.
5. Use a conventional subject such as `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, or `chore:`.

By contributing, you agree that your contribution is licensed under Apache-2.0 and that you will follow the [Code of Conduct](CODE_OF_CONDUCT.md).
