# Windows Installer Lifecycle TDD Evidence

Date: 2026-07-14  
Scope: stale Windows bundle prevention and a normal current-user NSIS
install/reinstall/uninstall release gate.

## Result

The local Windows installer lifecycle passes. The gate refuses to run when a
matching uninstall registration or orphaned install directory already exists,
requires exactly one canonical current-version NSIS artifact, and leaves no
product registration or install directory behind.

This is real installer behavior on the development Windows profile. It is not
evidence of a clean VM, a non-development machine, Authenticode trust, or an
upgrade from a previous semantic version.

## RED checkpoints

Command:

```text
pnpm exec vitest run tests/release/windowsInstallerLifecycle.test.ts
```

Initial result: 3 tests failed. The repo had no lifecycle command, did not clear
stale bundle output before building, and had no normal installer harness.

The first direct lifecycle run then exposed a strict-mode registry edge case:
unrelated uninstall entries without `DisplayName` caused enumeration to fail.
A regression expectation required safe property lookup before that fix landed.

## GREEN checkpoints

Focused contract command:

```text
pnpm exec vitest run tests/release/windowsInstallerLifecycle.test.ts tests/release/releaseWorkflow.test.ts
```

Result: 2 files / 10 tests passed.

Direct product command:

```text
pnpm desktop:installer-lifecycle
```

Result: PASS in 10.4 seconds. The evidence record reports:

- canonical `Local-First RPG_0.1.0_x64-setup.exe` selected;
- SHA-256 captured;
- current-user uninstall registration and expected install location verified;
- installed executable launched and created isolated SQLite data;
- same-version repair/reinstall completed without moving the installation;
- the second launch retained the database;
- silent uninstall completed;
- uninstall registration removed; and
- install directory removed.

Ignored local evidence:
`release-evidence/windows/installer-lifecycle/windows-installer-lifecycle.json`.

The latest complete `pnpm verify:release` run passed in 252.8 seconds:
86 files / 665 tests, 91.81% statements/lines, 88.75% branches, 93.45%
functions, deterministic evals, Playwright, dependency/Rust audits, 34 Rust
tests with the signed-release Keychain smoke ignored, clippy, clean MSI/NSIS
packaging, executable and MSI-payload smokes, and this installer lifecycle.

## Implementation

- `scripts/desktop-build.mjs` removes the generated release bundle directory
  before every build, preventing older product/version installers from entering
  signing, checksum, or upload selection.
- `scripts/desktop-installer-lifecycle.ps1` is fail-closed around existing user
  state and performs the real lifecycle with cleanup in `finally`.
- `pnpm verify:release` includes `pnpm desktop:installer-lifecycle` after package
  build and payload smokes.

## Remaining release proof

1. Run the same lifecycle from the exact release commit on a clean hosted or VM
   Windows profile with signed artifacts.
2. Exercise an actual previous signed version through install and upgrade, then
   run the migration/backup/restore/export product flow.

## Hosted CI extension

RED: `tests/release/windowsInstallerLifecycle.test.ts` failed because routine
Windows CI stopped after the executable smoke and retained no lifecycle record.

GREEN: the Windows `verify` job now runs the MSI-payload smoke followed by the
normal installer lifecycle on its clean hosted profile, then uploads
`windows-installer-lifecycle-evidence` for 30 days even when a later step fails.
This workflow contract is locally verified; it becomes hosted evidence only
after an authorized push produces a successful current-commit run.
