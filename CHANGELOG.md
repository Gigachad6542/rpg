# Changelog

Material user-visible, data-format, security, and release-process changes are
recorded here. Dates use `YYYY-MM-DD`; versions must match `package.json`,
`src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`.

## [Unreleased]

### Added

- Private local-first RPG runtime with branch-scoped state lineage, mock and
  BYOK/local providers, card/lore/persona workflows, SQLite continuity,
  backup/restore, import/export, and redacted diagnostics.
- Windows MSI/NSIS and Apple Silicon macOS release lanes with fail-closed
  signing/notarization inputs, checksums, SBOM, provenance, and attestations.
- Normal Windows NSIS install/reinstall/uninstall verification, eleven
  functional browser journeys, two zero-violation automated WCAG A/AA
  journeys across both themes and key dialogs, and a third journey for 320
  CSS-pixel reflow and forced colors.
- Independent previous-release Authenticode publisher/timestamp, checksum,
  provenance, tag-commit, and semantic-version verification before packaged
  migration, plus an explicitly non-promotable signed bootstrap lane.
- Keyboard-safe runtime replacement, restore-point, and persona-deletion
  confirmations with modal alerts, safe default focus, Escape cancellation,
  focus restoration, and reversible local snapshots.
- Contrast-safe light/dark theme tokens and standards-compatible definition
  lists across navigation, onboarding, cards, lorebooks, runtime, and Settings.
- Viewport-bounded onboarding, zero-minimum responsive grids, stacked mobile
  persona actions, system-color theme tokens, and a keyboard-focusable
  scrollable transcript for constrained and high-contrast layouts.

### Security

- OS-keychain references for hosted desktop provider keys, scoped Tauri
  commands, endpoint/size/time limits, export sanitization, and migration
  backups.
- Immutable commit pins for all 26 GitHub Actions dependencies in the CI and
  release workflows.
- pnpm 11.7.0 release tooling with frozen-lockfile supply-chain verification
  and an exact `esbuild@0.25.12` lifecycle-script allowlist.

### Release status

No public release has been published. Current builds and all `0.1.0` evidence
are controlled-beta candidates; hosted signing, notarization, clean-runner
evidence, previous-version migration, live-provider evaluation, attestation
eligibility, licensing, and public support remain promotion gates.
