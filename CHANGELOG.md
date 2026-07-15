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
- Normal Windows NSIS install/reinstall/uninstall verification and four browser
  critical-journey tests.

### Security

- OS-keychain references for hosted desktop provider keys, scoped Tauri
  commands, endpoint/size/time limits, export sanitization, and migration
  backups.

### Release status

No public release has been published. Current builds and all `0.1.0` evidence
are controlled-beta candidates; hosted signing, notarization, clean-runner
evidence, licensing, and public support remain promotion gates.
