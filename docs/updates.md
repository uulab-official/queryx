# Desktop Updates

## What it does

QueryX desktop checks the signed GitHub Release feed shortly after startup. When a newer compatible release is available, the update button in the top-right toolbar changes to the new version. Selecting it downloads, verifies, installs, and relaunches QueryX.

The browser preview does not install updates. It shows a desktop-only notice when the update control is selected.

## Release feed

The Tauri updater reads:

```text
https://github.com/uulab-official/queryx/releases/latest/download/latest.json
```

The GitHub Actions release workflow creates that manifest and the platform-specific signed artifacts when a matching `vX.Y.Z` tag is pushed. The tag must match `VERSION`, the workspace manifests, and `apps/desktop/src-tauri/tauri.conf.json`.

## Signing setup

Updater signatures are separate from Apple notarization and Windows Authenticode certificates. Every production updater build must use the same private updater key; the public key is committed in `apps/desktop/src-tauri/tauri.conf.json` and is used by the app to verify artifacts.

Generate a key once on a trusted machine and keep the private file out of Git:

```bash
pnpm --filter @queryx/desktop tauri signer generate \
  -w "$HOME/.config/queryx/queryx-updater.key"
```

In the GitHub repository settings, add these Actions secrets:

- `TAURI_SIGNING_PRIVATE_KEY`: the complete contents of `queryx-updater.key`.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the key password, when one was configured. Omit or leave empty for an unencrypted key.

Treat the key as a production credential. Rotating it requires shipping a new application version with the new public key before publishing updates signed by the new key.

## Publishing

1. Update all version sources and `CHANGELOG.md`.
2. Run the full local verification commands from [the release process](release-process.md).
3. Create and push a signed version tag:

   ```bash
   git tag -s v0.1.1 -m "QueryX v0.1.1"
   git push origin v0.1.1
   ```

4. Confirm the `Release` workflow completes on Linux, macOS (Apple Silicon and Intel), and Windows.
5. Confirm the release contains installers, `.sig` files, and `latest.json` before testing the in-app update from the previous version.

The workflow can also be run manually for an existing version tag. It refuses a tag/version mismatch so a release cannot accidentally publish artifacts with an ambiguous version.

## Safety and rollback

Updates are signature-checked before installation. QueryX does not silently replace a running process: the user chooses the update, then the app relaunches after installation. If a release is faulty, stop publishing it and publish a higher version containing the fix; clients should not be pointed at an unsigned or manually modified artifact. Keep the previous release available for users who need to reinstall or roll back manually.

Platform signing and notarization remain a separate v1.0 release gate. Without those platform credentials, the release workflow can produce signed updater artifacts but the operating system may still show an install trust warning.

## Troubleshooting

- **No update button:** verify the app is a packaged Tauri build and that the latest release has `latest.json`.
- **Signature verification failed:** confirm the release uses the private key paired with the committed public key; never disable verification.
- **Workflow fails before packaging:** check the two updater secrets and that the pushed tag exactly matches the configured version.
- **macOS or Windows warns about the publisher:** configure Apple Developer ID/notarization or Windows code-signing secrets; updater signing alone does not establish OS publisher trust.
