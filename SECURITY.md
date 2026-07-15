# Security Policy

## Supported builds

The current `0.1.x` line is a private controlled beta. Only the latest build
shared by the maintainer is supported; older local builds should be upgraded
before triage unless the report is specifically about migration or rollback.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability.

No public security intake is available for this private beta. Authorized testers should
contact the repository owner through the private channel that supplied the
build and include the version, affected platform, impact, and minimal
reproduction. The maintainer must move the report into a restricted security
record before sharing it with other contributors.

Do not include real API keys, complete runtime databases, private chat text, or
unredacted diagnostics. Revoke any credential that may have been exposed.

The maintainer will aim to acknowledge a report within three business days,
confirm severity/scope, prepare a regression test and fix, and coordinate
disclosure only after affected users have a safe upgrade path.

## High-priority scope

- plaintext provider-secret persistence or renderer key exposure;
- arbitrary command, path, URL, or file access across the Tauri boundary;
- silent save loss, unsafe migration, or backup/restore corruption;
- import, export, diagnostics, or log disclosure of private runtime content;
- provider endpoint or local-network trust-boundary bypass; and
- installer, updater, signing, or release-provenance compromise.

Public distribution remains blocked until a public security contact or enabled
private vulnerability-reporting destination is verified from outside the
maintainer account.
