# Release Packaging

Phase 2 is a fail-closed shipped-product lane. The workflow builds signed
Windows and macOS packages from the exact release commit, retains packaged-app
evidence, and publishes only after both platforms and hosted CI pass.

The lane is implemented in `.github/workflows/release.yml`; it is not proof by
itself. A release is proven only by a successful hosted run with real signing
credentials, a previous signed Windows MSI, and retained artifacts.

## Local gates

Run the appropriate gate from a clean checkout:

```bash
pnpm install --frozen-lockfile
pnpm e2e:install
cargo install cargo-audit --locked
pnpm verify:release
```

On macOS, use `pnpm verify:release:mac`. Local unsigned builds remain useful for
development, but they are not public release candidates.

`pnpm desktop:build` is a signing-aware wrapper. When
`REQUIRE_SIGNED_RELEASE=1`, it fails before building unless the platform signing
and notarization inputs are present. The hosted release jobs always set that
flag.

## Hosted release contract

The tag or manually dispatched workflow performs these gates in order:

1. Query `ci.yml` and require a successful hosted run whose `head_sha` is the
   exact release commit.
2. Build and verify timestamped Authenticode Windows artifacts.
3. Download the previous stable signed MSI, administratively extract both MSI
   payloads into isolated roots, and run the complete packaged flow:
   first run, provider setup, create, play, close/reopen, migration continuity,
   backup restore, and runtime export.
4. Build the macOS DMG with Developer ID signing and Apple notarization, validate
   the stapled ticket and Gatekeeper acceptance, mount and relaunch the DMG, and
   execute a native Keychain set/get/delete round trip.
5. Generate per-platform CycloneDX SBOMs, SHA-256 manifests, commit-bound
   provenance, and GitHub artifact attestations.
6. Upload platform artifacts and evidence for 90 days. Only then may the tag job
   publish the release.

Required Windows configuration:

- `WINDOWS_CERTIFICATE_BASE64` secret
- `WINDOWS_CERTIFICATE_PASSWORD` secret
- `WINDOWS_TIMESTAMP_URL` repository variable

Required macOS configuration:

- `APPLE_CERTIFICATE` secret
- `APPLE_CERTIFICATE_PASSWORD` secret
- `APPLE_ID` secret
- `APPLE_PASSWORD` app-specific-password secret
- `APPLE_TEAM_ID` secret

Secrets must not be copied into logs, evidence, release notes, source, or test
fixtures.

## Retained evidence

Windows evidence includes MSI administrative-extraction logs, screenshots, the three runtime
exports, the product-generated startup backup hash, migration/restore assertions,
AuthentiCode results, and `phase2-windows-product-flow.json`.

macOS evidence includes DMG attach/copy/launch logs, SQLite continuity results,
codesign and Gatekeeper results, `stapler validate`, and the native Keychain
round-trip result. The Keychain test uses a generated fake value and deletes it
in cleanup.

Release metadata is platform-specific to prevent asset-name collisions:

```text
SHA256SUMS-windows.txt
release-provenance-windows.json
sbom-windows.cdx.json
SHA256SUMS-macos.txt
release-provenance-macos.json
sbom-macos.cdx.json
```

The artifacts remain under `src-tauri/target/release/bundle/`; local evidence is
written beneath ignored `release-evidence/`.

## Windows packaged product flow

The hosted lane supplies two real MSI files to:

```powershell
pnpm desktop:product-flow -PreviousMsi <old.msi> -CurrentMsi <new.msi> -EvidenceDir <dir>
```

Each MSI is administratively extracted to its own temporary install root. The
driver launches the packaged WebView2 application with an isolated Windows
profile and attaches Playwright over a loopback CDP port. It uses the local mock
provider, so no paid call or provider secret is needed. It then proves that a
durable marker survives migration, a transient post-backup marker is removed by
restore, the restored database is healthy, and the final exported runtime has
the expected state. The current package must also successfully invoke
`discover_local_text_providers` through the real Tauri bridge.

This flow proves packaged payload behavior, not Windows Installer lifecycle
behavior. A public release still needs a clean-machine install, upgrade, repair,
and uninstall run using normal MSI/NSIS installation rather than `msiexec /a`.

## Publication and rollback

Do not publish a release when either platform job, the exact-commit CI gate,
signature validation, migration/restore flow, SBOM/provenance generation, or
attestation fails. Follow [Updater and Rollback Policy](updater-rollback-policy.md)
for manual updates, schema-safe rollback, and credential revocation.
