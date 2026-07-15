# Phase 2 Shipped Desktop Evidence

Date: 2026-07-13  
Scope: packaged Windows continuity, release signing gates, macOS evidence lane,
exact-commit CI promotion, provenance, SBOM, and rollback policy.

## Result

The Phase 2 release machinery is implemented and locally verified. The Windows
product flow passed against administratively extracted payloads from two
different real MSI packages. It did not exercise normal Windows install,
upgrade, repair, or uninstall behavior. The public release is **not yet proven**:
this Windows session had no production signing
certificate, no Apple runner or credentials, and no authorized hosted workflow
or publication run.

## Follow-up verification (2026-07-14)

The original dated results below remain historical. The latest full release run
passed in 224.8 seconds with 85 files / 657 tests, 91.81% statements/lines,
88.75% branches, and 93.45% functions. Ten Playwright journeys, both deterministic evals,
production build, JS/Rust audits, 34 Rust tests, clippy, MSI/NSIS packaging,
executable smoke, administrative-extraction persistence smoke, and the normal
NSIS lifecycle all passed.
On 2026-07-14, a separate normal current-user NSIS lifecycle also passed install,
same-version reinstall, persistent relaunch, uninstall registration removal,
and install-directory cleanup. That later result does not turn this historical
two-package administrative-extraction run into clean-VM or previous-version
upgrade proof.

That review found a real packaged regression: the renderer invoked
`discover_local_text_providers`, but the command was missing from the Tauri
build manifest and default window capability. The command is now registered,
granted, covered by a cross-surface regression test, and invoked by the hosted
packaged product-flow driver. A same-package current-MSI flow passed in 13.8
seconds on 2026-07-14; this proves current packaged command execution and
continuity, not previous-version migration.

## RED checkpoint

Commit: `a9f2a10` (`test: define phase 2 shipped desktop release gates`)

Command:

```text
pnpm exec vitest run tests/release/phase2Release.test.ts
```

Expected result: 5 tests failed because the product-flow driver, SBOM and
provenance generators, signed hosted workflow, macOS Keychain/DMG evidence, and
updater/rollback policy did not exist.

## GREEN checkpoint

Commit: `9080b57` (`feat: add phase 2 shipped desktop release proof`)

Focused contract result:

```text
2 test files passed
11 tests passed
```

Full release result:

```text
pnpm verify:release
PASS in 153.6 seconds
68 test files / 600 tests passed
91.49% statements / 88.20% branches / 94.25% functions / 91.49% lines
Playwright browser E2E: 1 passed
Production dependency audit: no known vulnerabilities
Rust advisory audit: completed with 18 allowed warnings
Rust tests: 32 passed, 1 ignored macOS release-only Keychain test
Rust clippy: passed with -D warnings
Windows MSI and NSIS: built
Packaged executable smoke: passed
Administrative-extraction isolated-profile smoke: passed
```

Additional executable checks:

- All four new Node release scripts passed `node --check`.
- Both PowerShell scripts parsed successfully.
- The macOS DMG smoke passed `bash -n` syntax validation.
- `REQUIRE_SIGNED_RELEASE=1` without Windows certificate/timestamp inputs exited
  1 before building, proving the local public-release guard fails closed.
- CycloneDX 1.6 SBOM generation produced 529 npm and Cargo components and 530
  dependency entries.
- Clean-commit provenance bound two Windows artifacts and their checksums to
  exact source commit `9080b57bddfe508f4a26caba6c8bf2e8b8a78a85` and the
  generated SBOM hash.

## Packaged Windows product flow

Command:

```text
pnpm desktop:product-flow -PreviousMsi <previous.msi> -CurrentMsi <current.msi> -EvidenceDir <dir>
```

Result: 5/5 steps passed in 2.9 seconds of recorded app operations (10.8
seconds including MSI extraction and process orchestration).

The previous package was built from commit `a3e8b49`; the current candidate was
built from the Phase 2 checkout. Their MSI hashes were different:

```text
previous  7839e7a4c6701a8af0f8975603e0c1d5eab894854d81993f9acda5e32dbceee4
current   be32a198745a4c96b02e1bcbca52393b08445f88afbcb8af20d2f2ecb5aa2bc9
```

Verified through the packaged WebView2 UI:

1. First-run onboarding opened.
2. The local mock provider was activated without a secret or paid call.
3. `Phase 2 Migration RPG` was created and played.
4. `PHASE2_DURABLE_MARKER` survived close/reopen into the current package.
5. `PHASE2_TRANSIENT_MARKER` was added after migration.
6. The current product-generated rotating SQLite startup backup was retained
   and restored while the app was closed.
7. The restored current package contained the durable marker, excluded the
   transient marker, and exported a valid `rpg.runtime.export` bundle.

Retained local evidence includes three screenshots, three runtime exports, two
MSI administrative-extraction logs, application logs, the restored database, the product-generated
backup, file hashes, and `phase2-windows-product-flow.json`. Generated evidence
is intentionally ignored by Git.

### Previous-build qualification

No published GitHub release existed, and both source commits still declare
application version `0.1.0`. The local run therefore proves migration from a
different previous packaged commit, not from a previously published semantic
version. That historical commit's frozen lockfile also disagreed with its pnpm
override configuration; its isolated fixture build used pnpm 9.15.9 with
`--no-frozen-lockfile`, and that exception is recorded beside the MSI.

The hosted lane does not rebuild old source. It requires and downloads a real
previous signed stable MSI, so the public-release gate remains stricter than
this local fixture.

## Hosted and platform release controls

The hosted workflow now:

- requires a successful `ci.yml` run whose `head_sha` equals the exact release
  commit;
- imports a Windows PFX, configures SHA-256/timestamp signing, and verifies every
  release executable and installer with `Get-AuthenticodeSignature`;
- requires a previous signed stable MSI and runs the complete Windows product
  flow;
- builds the Apple Silicon DMG with Developer ID/notarization inputs, checks
  codesign, Gatekeeper, and the stapled ticket, and retains mounted-DMG SQLite
  evidence;
- runs an opt-in native macOS Keychain set/get/delete test with a generated fake
  value;
- generates platform-specific SHA-256 manifests, provenance files, and
  CycloneDX SBOMs, then creates GitHub artifact attestations;
- retains both platform evidence sets for 90 days; and
- publishes only from the tag job after the CI gate and both platform jobs pass.

## Security and operational review

- No real provider API key was used or written to evidence.
- The Keychain test value is explicitly fake, generated for the test, and
  deleted during cleanup.
- Signing secrets are read only from hosted secret storage; the imported PFX
  file is deleted after import.
- Automatic updates and automatic downgrades remain disabled. Rollback requires
  verified signed artifacts, a compatible backup, and an offline restore while
  the app is closed.
- Signing/notarization failure, missing exact-commit CI, missing previous MSI,
  failed migration/restore, missing SBOM/provenance, or failed attestation blocks
  publication.

## Evidence still required before public release

1. A hosted Windows run using the production signing certificate and timestamp
   service, with Authenticode evidence retained.
2. A real previous signed semantic-version MSI passing migration and restoration.
3. A hosted macOS run retaining the signed/notarized/stapled DMG, Gatekeeper,
   mounted-DMG continuity, and native Keychain evidence.
4. A successful publish workflow showing `ci.yml`, Windows, and macOS all passed
   for the same exact release commit.
