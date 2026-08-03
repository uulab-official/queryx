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
4. Run `pnpm run verify`, `pnpm run typecheck`, `pnpm run test`, and `pnpm run build`.
5. Run the manual smoke checklist from `docs/testing.md`.
6. Commit with `release: vX.Y.Z` and create a signed tag `vX.Y.Z`.
7. Publish release notes with known issues and rollback/migration guidance.

## Rollback

If a release can corrupt local workspace state or changes destructive-query behavior, stop distribution, document the impact in `CHANGELOG.md`, and publish a rollback or migration path before continuing.
