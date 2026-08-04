# QueryX Release Process

## Version source of truth

The version is recorded in `VERSION` and must match the root package plus every workspace package manifest. The repository verification script fails when these values drift.

## Version rules

- `0.x.y` is used while the public API and storage formats are still evolving.
- Increment `y` for backward-compatible fixes and documentation-only releases with user impact.
- Increment `x` for a new milestone or a breaking change to the driver/plugin contract.
- Move to `1.0.0` only after the v1.0 stability gates in `ROADMAP.md` are complete.
- Never silently change workspace or persisted-storage behavior; add a migration note.

## Release checklist

1. Update `VERSION` and all workspace package versions.
2. Move the relevant `Unreleased` entries into a dated version section in `CHANGELOG.md`.
3. Update `ROADMAP.md` status and supported driver capabilities.
4. Run `pnpm run verify`, `pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`, and `pnpm run build`.
5. Run the manual smoke checklist from `docs/testing.md`.
6. Commit with `release: vX.Y.Z` and create a signed tag `vX.Y.Z`.
7. Push the tag to GitHub. The [Release workflow](../.github/workflows/release.yml) builds Linux, macOS, and Windows installers, signs updater artifacts, publishes `latest.json`, and attaches the files to the GitHub Release.
8. Publish release notes with known issues and rollback/migration guidance.

## GitHub Actions and OTA prerequisites

The release workflow is intentionally tag-driven and requires `contents: write`. Before the first release, configure `TAURI_SIGNING_PRIVATE_KEY` and, when applicable, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` as GitHub Actions secrets. The committed updater public key and the private key must be a pair. See [Desktop Updates](updates.md) for key generation, feed behavior, and troubleshooting.

The desktop app checks the feed after startup and provides a versioned update action in the top-right toolbar. It downloads and installs only after the user selects the action, then relaunches. The browser preview has no update installation capability.

## Rollback

If a release can corrupt local workspace state or changes destructive-query behavior, stop distribution, document the impact in `CHANGELOG.md`, and publish a rollback or migration path before continuing.
