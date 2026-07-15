# Current Claims and Release Repair Evidence

Date: 2026-07-14
Scope: current-state claim reconciliation, packaged local-provider discovery,
release identity, browser smoke, packaged product flow, and coverage policy.

## Result

The current working tree's last full `pnpm verify:release` run passed. A later
focused extension added and directly passed a normal current-user NSIS
install/reinstall/uninstall lifecycle. Public-launch proof is still incomplete
because the local run was unsigned, used no Apple runner, did not execute the
exact-commit hosted workflow, did not use a clean VM, and did not upgrade from a
previous signed semantic version.

The packaged discovery defect is closed. The renderer command now appears in
the Tauri build manifest, default window capability, generated permissions and
schemas, release contract tests, and the hosted packaged product-flow driver.

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

Result: PASS in 183.5 seconds.

```text
TypeScript: passed
ESLint: passed
Vitest: 69 files / 620 tests passed
Coverage: 91.57% statements, 88.36% branches, 93.79% functions, 91.57% lines
Phase 1 deterministic eval: passed
Phase 1.1 deterministic eval: passed; 100 lore decisions; 3 campaigns; 0 live calls
Vite build: passed; main app chunk 486.13 kB / 137.16 kB gzip
Playwright: 1 passed
pnpm production audit: no known vulnerabilities
Rust audit: exit 0 with 18 allowed warnings
Rust tests: 34 passed; 1 signed-release-only Keychain test ignored
Rust clippy: passed with warnings denied
Windows MSI and NSIS: built
Packaged executable smoke: passed
Administrative-extraction SQLite smoke: passed
```

## Packaged WebView proof

Command shape:

```text
pnpm desktop:product-flow -PreviousMsi <current.msi> -CurrentMsi <current.msi> -EvidenceDir <ignored-dir>
```

Result: PASS in 13.6 seconds. This same-package run exercised onboarding,
provider setup, creation, play, close/reopen, SQLite continuity, backup restore,
runtime export, and the new packaged discovery invocation. It is direct current
package proof, not previous-version migration proof.

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
5. Decompose the oversized application controller and UI test suite while
   expanding browser/accessibility acceptance coverage.
