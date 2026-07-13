# Installing on macOS

Public macOS packages are Apple Silicon DMGs for macOS 11 or newer. Download a
DMG only from a completed release whose hosted evidence confirms Developer ID
signing, notarization, stapling, Gatekeeper acceptance, mounted-DMG persistence,
and native Keychain behavior.

## Download and install

1. Open the repository's **Releases** page.
2. Download `Local-First RPG_<version>_aarch64.dmg` together with
   `SHA256SUMS-macos.txt`, `release-provenance-macos.json`, and
   `sbom-macos.cdx.json`.
3. Verify the checksum:

   ```bash
   cd ~/Downloads
   shasum -a 256 -c SHA256SUMS-macos.txt
   ```

4. Open the DMG and drag **Local-First RPG** into **Applications**.
5. Launch it normally. A public release must not require bypassing Gatekeeper or
   removing quarantine attributes.

API keys are stored through the macOS Keychain rather than renderer storage. The
hosted release lane verifies a generated set/get/delete Keychain round trip and
retains only the test result—not the value.

## Updating or rolling back

Updates are manual in Phase 2: download and verify the new release, close the
app, then replace the application. Automatic update and downgrade are disabled.
Before any rollback, follow [Updater and Rollback Policy](updater-rollback-policy.md);
never open a database migrated by a newer release with an older incompatible
binary.

## Local development build

A developer may create an unsigned local-only build on a Mac:

```bash
brew install node pnpm
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
pnpm install --frozen-lockfile
pnpm verify:version
pnpm desktop:build
```

The DMG is written to `src-tauri/target/release/bundle/dmg/`. An unsigned local
build is not eligible for public publication and is not covered by the hosted
release evidence.
