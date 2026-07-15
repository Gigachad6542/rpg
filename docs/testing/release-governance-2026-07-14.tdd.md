# Release Governance TDD Evidence

Date: 2026-07-14  
Scope: controlled-beta security/support policy, contribution and conduct rules,
changelog discipline, and structured GitHub intake.

## RED

`pnpm exec vitest run tests/release/governance.test.ts` failed 2/2 because
`SECURITY.md`, `SUPPORT.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
`CHANGELOG.md`, the bug form, and the pull-request checklist were absent.

## GREEN

The added policy is honest about current boundaries:

- the repository and issue tracker are private;
- no public security intake is verified;
- normal bug reports require redacted evidence;
- security reports stay private;
- release claims require exact commands and retained proof; and
- no public release is recorded in the changelog.

Licensing and a public support/security destination remain owner/external
promotion gates. These files improve the local repository immediately and the
GitHub community profile only after an authorized push.
