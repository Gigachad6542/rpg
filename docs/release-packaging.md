# Release Packaging

Phase 2 is a fail-closed shipped-product lane. The workflow builds signed
Windows and macOS packages from the exact release commit, retains packaged-app
evidence, and publishes only after both platforms and hosted CI pass.

The lane is implemented in `.github/workflows/release.yml`; it is not proof by
itself. A release is proven only by a successful hosted run with real signing
credentials, a cryptographically revalidated previous Windows release, and
retained artifacts. The current private, user-owned GitHub repository is not
eligible for GitHub's private-repository artifact-attestation service; the
workflow now rejects that account state before signing jobs consume credentials.

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

The candidate workflow performs these gates in order:

1. Validate the requested release mode and confirm that GitHub artifact
   attestation storage is supported for the repository/account combination.
2. Query `ci.yml` and require a successful hosted run whose `head_sha` is the
   exact release commit.
3. Build and verify timestamped Authenticode Windows artifacts, requiring every
   signer subject to equal the configured trusted publisher identity.
4. Normally install, relaunch across a same-version NSIS reinstall, and uninstall
   the current Windows package, retaining registry/filesystem lifecycle evidence.
5. Download the previous release MSI, `SHA256SUMS-windows.txt`, and
   `release-provenance-windows.json`. Before execution, independently require a
   valid timestamped Authenticode signature from the trusted publisher, an exact
   manifest digest, matching product/repository/platform/version provenance, a
   provenance artifact name/size/digest match, a provenance source commit equal
   to the release tag commit, and a semantic version strictly older than the
   candidate. Administratively extract both validated MSI payloads into isolated
   roots and run the complete packaged flow:
   first run, provider setup, create, play, close/reopen, migration continuity,
   backup restore, and runtime export.
6. Build the macOS DMG with Developer ID signing and Apple notarization, validate
   the stapled ticket and Gatekeeper acceptance, mount and relaunch the DMG, and
   execute a native Keychain set/get/delete round trip.
7. Generate per-platform CycloneDX SBOMs, SHA-256 manifests, commit-bound
   provenance, and GitHub artifact attestations.
8. Upload platform artifacts and evidence for 90 days. Only then may the tag job
   publish the release.

### First-release bootstrap

The candidate lane cannot honestly prove cross-version migration before any
signed release exists. Manual dispatch therefore offers a separate
`bootstrap-baseline` mode. It requires the exact `CREATE SIGNED BASELINE`
confirmation, exact-commit hosted CI, both signed platform lanes, and
attestations, then publishes a prerelease whose metadata states that it is only
a migration baseline. It deliberately skips previous-version migration and
cannot be promoted as public-ready. After creating it, bump every synchronized
manifest to a newer stable version and run the normal candidate lane with the
baseline tag explicitly supplied. Only that second run can close the migration
gate.

Required Windows configuration:

- `WINDOWS_CERTIFICATE_BASE64` secret
- `WINDOWS_CERTIFICATE_PASSWORD` secret
- `WINDOWS_TIMESTAMP_URL` repository variable
- `WINDOWS_PUBLISHER_SUBJECT` repository variable containing the exact trusted
  X.509 subject expected on current and previous release artifacts

Required macOS configuration:

- `APPLE_CERTIFICATE` secret
- `APPLE_CERTIFICATE_PASSWORD` secret
- `APPLE_ID` secret
- `APPLE_PASSWORD` app-specific-password secret
- `APPLE_TEAM_ID` secret

Secrets must not be copied into logs, evidence, release notes, source, or test
fixtures.

GitHub-hosted attestations also require either a public repository or a private
repository owned by an eligible GitHub Enterprise Cloud organization. The
current private personal repository fails this preflight by design. Do not
remove the gate to make a release run green; change repository/account state or
adopt and review an equivalent attestation backend first. See
[GitHub's artifact-attestation requirements](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations).

## Retained evidence

Windows evidence includes the normal NSIS lifecycle JSON, previous-release
signature and metadata verification JSON, MSI administrative-extraction logs,
screenshots, the three runtime exports, the product-generated startup backup
hash, migration/restore assertions, Authenticode results, and
`phase2-windows-product-flow.json`.

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

This flow proves cross-version packaged payload behavior; it remains separate
from `pnpm desktop:installer-lifecycle`, which proves normal current-package
NSIS registration, launch, same-version reinstall, persistent relaunch, and
uninstall. Public release still requires that lifecycle on a clean runner plus
an actual previous-version package for upgrade/migration evidence.

## Publication and rollback

Do not publish a candidate release when either platform job, the exact-commit CI
gate, prior-release authenticity chain, signature validation,
migration/restore flow, SBOM/provenance generation, or attestation fails. A
bootstrap prerelease is only the explicitly labeled first half of the two-release
sequence and does not relax candidate promotion. Follow [Updater and Rollback Policy](updater-rollback-policy.md)
for manual updates, schema-safe rollback, and credential revocation.
