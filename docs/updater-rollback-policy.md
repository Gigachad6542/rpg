# Updater and Rollback Policy

Status: automatic application updates are disabled for Phase 2. Public release
promotion is fail-closed until the exact release commit and both packaged
platform lanes produce the evidence described below.

## Promotion policy

A release may be published only when all of these are true:

- Hosted `ci.yml` completed successfully for the exact release commit.
- The Windows MSI/NSIS artifacts are Authenticode-signed and timestamped.
- The macOS DMG is Developer ID signed, notarized, stapled, and accepted by
  Gatekeeper.
- The Windows previous-version migration, backup restoration, and complete
  packaged product flow passed using administratively extracted payloads from
  real signed MSI packages. The previous MSI must first pass exact trusted
  publisher/timestamp verification, checksum verification, provenance
  repository/product/version/artifact verification, tag-to-source-commit
  binding, and strict older-version ordering.
- A clean non-development Windows machine completed the normal install, upgrade,
  repair, and uninstall lifecycle; `msiexec /a` evidence alone is insufficient.
- The macOS mounted-DMG persistence smoke and native Keychain round trip passed.
- Platform SHA-256 manifests, commit-bound provenance, a CycloneDX SBOM, and
  GitHub artifact attestations were retained with the release evidence.

The normal candidate workflow enforces these requirements before its publish
job. Its separately confirmed bootstrap mode may publish only a clearly labeled
signed prerelease baseline; that baseline has no migration proof and cannot be
promoted as public-ready. A
failed, cancelled, skipped, or missing prerequisite must not be overridden by
publishing artifacts manually.

## Update policy

Phase 2 uses manual, user-initiated replacement installs from a verified release
page. The application does not poll an update service, download executables, or
apply an update in the background. No updater signing private key is stored in
the repository or desktop application.

Before enabling Tauri's updater in a later phase, the project must define and
test offline updater-key custody, public-key pinning, key rotation and recovery,
release-channel isolation, signature verification, and a revocation drill. The
updater manifest must bind the exact version, platform, download URL, signature,
and published checksum to the promoted release commit.

## Rollback policy

No automatic downgrade is permitted. An older binary must never be launched
against a database already migrated to a newer, incompatible schema.

For an approved rollback:

1. Stop distribution and close every running application instance.
2. Preserve the current database and export, then locate the backup captured
   before the failed update.
3. Verify the signed previous release, its timestamped trusted publisher,
   checksum, tag-bound provenance, and attestation.
4. Confirm its database/schema compatibility in the packaged migration fixture.
5. Install the signed previous release and restore the compatible backup while
   the application is closed.
6. Reopen, verify continuity, and retain a rollback evidence record.

If schema compatibility cannot be proven, keep the current binary installed and
recover through a supported current-version restore or import path. Do not
force-copy a newer database into an older release.

## Incident and revocation policy

If a signing certificate, notarization credential, updater key, artifact, or
release account may be compromised, stop publication immediately. Revoke the
affected credential, remove the affected release from distribution, preserve
the evidence, rotate credentials, rebuild from a reviewed exact commit, and run
the full promotion lane again. Document the scope, affected hashes, replacement
release, and user recovery steps before resuming distribution.
