# Remediation completion evidence - 2026-07-12

## Completed behavior

- In-flight visible and hidden generation can be stopped without committing messages or state.
- Imported lore regex runs in a bounded worker; failed or timed-out entries are disabled.
- Restore points persist locally, destructive changes checkpoint first, and runtime imports require review and confirmation.
- Generated image files are swept against active artifact IDs through a scoped Tauri command.
- Tavern V2 card export supports JSON and PNG round-trips, including embedded lore.
- Modal focus is trapped, Escape behavior is retained, and onboarding accurately discloses hosted-provider data flow.
- The redundant turn-state implementation was removed; runtime lineage is the single state/undo authority.
- The macOS release lane defines a mounted-DMG copy/launch/relaunch/SQLite-integrity smoke.
- pnpm supply-chain overrides and build allowlisting now use `pnpm-workspace.yaml`, which is honored by current pnpm.

## TDD checkpoints

Each behavior started with a focused failing test commit before its implementation commit. The new regression coverage includes generation cancellation, desktop abort handling, isolated lore regex, persisted restores, import review, image garbage collection, macOS packaging contracts, dialog accessibility, Tavern export round-trips, destructive-change checkpoints, and pnpm policy placement.

## Verification

`pnpm verify:release` passed on Windows after the remediation implementation:

- 54 Vitest files and 450 tests passed in the coverage lane.
- Coverage: 92.56% statements/lines, 88.94% branches, 94.02% functions.
- TypeScript, ESLint, frontend build, Playwright E2E, and production dependency audit passed.
- Rust advisory audit completed with the repository's 18 scoped allowed warnings.
- 28 Rust tests passed; clippy passed with warnings denied.
- Tauri produced MSI and NSIS bundles.
- Packaged executable smoke passed.
- Installed clean-profile smoke launched twice and created the scoped SQLite database.

After moving pnpm policy to the workspace config, `pnpm install --frozen-lockfile` and `pnpm verify` passed without the legacy pnpm-config warning. The final unit lane contains 54 files and 451 tests.

## Remaining external gates

The macOS smoke script and release workflow contract are locally verified, but the DMG smoke itself has not run on a macOS runner from this checkout. Keychain round-trip automation, Apple signing/notarization, Intel or universal-binary proof, pushing, and publishing remain external owner/hosted-runner actions.

The production build still reports a 551.72 kB main JavaScript chunk and a mixed static/dynamic Tauri API import warning. These are performance/packaging follow-ups, not failed release gates.
