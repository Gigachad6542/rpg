# Current Claims and Release Repair Evidence

Date: 2026-07-14
Scope: current-state claim reconciliation, packaged local-provider discovery,
release identity, browser smoke, packaged product flow, and coverage policy.

## Result

The current working tree's full `pnpm verify:release` run passed, including the
normal current-user NSIS install/reinstall/uninstall lifecycle. Public-launch proof is still incomplete
because the local run was unsigned, used no Apple runner, did not execute the
exact-commit hosted workflow, did not use a clean VM, and did not upgrade from a
previous signed semantic version.

The packaged discovery defect is closed. The renderer command now appears in
the Tauri build manifest, default window capability, generated permissions and
schemas, release contract tests, and the hosted packaged product-flow driver.

After that full local run, the hosted release contract received an additional
fail-closed repair at commit `8159691`. Previous Windows artifacts are no longer
trusted merely because they were downloaded from a repository release: the
workflow verifies the exact publisher and timestamp, checksum manifest,
provenance identity and artifact digest, release-tag commit, and strict older
semantic version before execution. A separately confirmed bootstrap prerelease
can establish the first signed migration baseline, but its retained metadata
explicitly says it is not migration or public-readiness proof. The current
private user-owned repository remains ineligible for GitHub private artifact
attestations, so release intent now fails before credentials are consumed.

## RED checkpoints

Commit `1ee34e4` (`test: cover desktop ACL and release identity regressions`):

- 3 intended failures reproduced the missing discovery manifest/capability
  contract and legacy public release artifact/title names.
- No unrelated test failed.

The pre-fix browser release run also failed because the smoke expected the old
onboarding title. A direct packaged WebView invocation returned:

```text
Command discover_local_text_providers not allowed by ACL
```

Commit `8486afd` (`test: cover packaged discovery product flow`):

- the Phase 2 release contract failed because the hosted product-flow driver
  still used the old onboarding title and did not exercise discovery.

## GREEN checkpoints

Commit `7a2c469` (`fix: restore packaged provider discovery`):

- added `discover_local_text_providers` to `src-tauri/build.rs`;
- granted `allow-discover-local-text-providers` to the main window;
- regenerated Tauri permissions and schemas;
- aligned the browser smoke with `Welcome to Local-First RPG`;
- renamed public release artifacts/titles to `Local-First RPG`; and
- raised coverage floors from 72% to 90% statements/lines/functions and 85%
  branches.

Commit `1be72b7` (`fix: verify discovery in packaged product flow`):

- retained legacy onboarding-title support only for previous-package migration;
- added a real packaged Tauri invocation of `discover_local_text_providers`; and
- fails the hosted flow on an ACL error, missing bridge, or non-array result.

## Current release-gate evidence

Command:

```text
pnpm verify:release
```

Latest result: PASS in 268.2 seconds with accessibility and pnpm 11 migration
commit `d95f9e0` checked out.

```text
TypeScript: passed
ESLint: passed
Vitest: 88 files / 669 tests passed
Coverage: 91.85% statements, 88.79% branches, 93.49% functions, 91.85% lines
Phase 1 deterministic eval: passed
Phase 1.1 deterministic eval: passed; 100 lore decisions; 3 campaigns; 0 live calls
Vite build: passed; main app chunk 491.98 kB / 138.87 kB gzip
Playwright: 13 passed, including two zero-violation automated WCAG A/AA journeys
pnpm production audit: no known vulnerabilities
Rust audit: exit 0 with 18 allowed warnings
Rust tests: 34 passed; 1 signed-release-only Keychain test ignored
Rust clippy: passed with warnings denied
Windows MSI and NSIS: built
Packaged executable smoke: passed
Administrative-extraction SQLite smoke: passed
Normal current-user NSIS install/reinstall/uninstall lifecycle: passed
Tested NSIS SHA256: 076cd9648ac52ee35e99871d1684517f2fcad02e6818fc304f4cf4f7eaa4675b
```

## Packaged WebView proof

Command shape:

```text
pnpm desktop:product-flow -PreviousMsi <previous.msi> -CurrentMsi <current.msi> -EvidenceDir <ignored-dir>
```

Result: PASS in 14.9 seconds against the freshly built 5,885,952-byte MSI
(`1b7489a8c0b1174dddf4cb01b65ae771026ab195bb4ba0b28c5e8382998df951`).
This different-commit, same-version run exercised onboarding,
provider setup, creation, play, close/reopen, SQLite continuity, backup restore,
runtime export, and the new packaged discovery invocation. It is direct current
package proof, not published semantic-version migration proof.

The older documentation example included an extra `--`; pnpm forwarded it to
PowerShell and the script rejected it as an ambiguous parameter. The canonical
command no longer includes that token.

## Claim reconciliation

- `docs/production-plan.md` is the canonical current readiness source.
- Dated TDD files retain their original counts and are labeled or amended as
  historical evidence rather than silently rewritten.
- `desktop:installed-smoke` and the Windows product flow are described as MSI
  administrative extraction, not a normal installed-app lifecycle.
- `desktop:installer-lifecycle` is separately described as a real current-user
  NSIS lifecycle on the local development profile, not clean-machine or
  previous-version proof.
- `Local-First RPG` is the public product/release name. Legacy binary, crate,
  environment-variable, database, and migration identifiers remain stable to
  avoid breaking existing installations and evidence.
- No live-provider quality result, signed hosted release, Apple package result,
  clean-machine installer result, or previous-version upgrade is claimed.

## Remaining objective gaps

1. Run the exact-commit hosted signing/notarization/publish workflow and retain
   evidence from both platforms.
2. Repeat the passing normal Windows lifecycle on a clean VM or
   non-development machine and add a true previous-version upgrade.
3. Run migration/restore from a previous signed semantic-version package.
4. Execute the paid live-provider evaluation with blind scoring and explicit
   cost limits.
5. Continue decomposing the oversized application controller and large feature
   modules while expanding settings accessibility acceptance coverage. The
   former 4,752-line UI suite is already split into five domain suites.
6. Resolve GitHub attestation eligibility (public repository or eligible
   Enterprise Cloud organization) or approve and review an equivalent
   attestation backend; do not bypass the preflight.
