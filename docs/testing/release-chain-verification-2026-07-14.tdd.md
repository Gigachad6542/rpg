# Trusted release-chain verification TDD evidence

Date: 2026-07-14

## Source and user journeys

The journeys were derived from the active production-readiness objective and
the existing Phase 2 release contract.

- As a release maintainer, I want every previous Windows package independently
  authenticated before execution so a compromised or mislabeled release asset
  cannot become a migration input.
- As a release maintainer with no prior signed version, I want an explicit
  bootstrap sequence so the first release does not deadlock or pretend to prove
  an impossible cross-version migration.
- As a reviewer, I want unsupported attestation/account state to fail before
  signing credentials are consumed.

## RED checkpoints

| Commit | Command | Intended result |
|---|---|---|
| `800b0f9` | `pnpm exec vitest run tests/release/previousReleaseVerification.test.ts tests/release/phase2Release.test.ts tests/release/releaseWorkflow.test.ts` | RED: 6 intended failures because the metadata/signature verifiers and bootstrap workflow did not exist |
| `0802d64` | `pnpm exec vitest run tests/release/previousReleaseVerification.test.ts` | RED: tag-commit binding remained absent with the verifier still unimplemented |
| `b5477f2` | `pnpm exec vitest run tests/release/previousReleaseVerification.test.ts` | RED: an absolute evidence directory failed in path normalization before Authenticode inspection |
| `735e31c` | `pnpm exec vitest run tests/release/releaseWorkflow.test.ts tests/release/phase2Release.test.ts` | RED: the immutable-action invariant failed on `actions/checkout@v4` while the other 13 tests passed |

## GREEN checkpoint

Commit `8159691` (`fix: verify the signed release chain`) implements:

- strict stable semantic-version parsing and older-than-candidate ordering;
- exact MSI SHA-256 verification against `SHA256SUMS-windows.txt`;
- provenance schema, platform, product, identifier, repository, version,
  artifact name/size/digest, and release-tag source-commit verification;
- exact trusted Windows publisher-subject matching and mandatory timestamping
  for previous and current signed artifacts;
- an explicit manual-only bootstrap baseline with typed confirmation and
  non-promotable evidence; and
- early rejection of GitHub account/repository states that cannot store the
  required artifact attestations.

Commit `9704a0e` (`security: pin workflow actions by commit`) additionally binds
all 26 `uses:` references in `ci.yml` and `release.yml` to the exact upstream
40-character commit resolved on 2026-07-14, while preserving readable version
comments for upgrade review.

## Test specification

| # | Guarantee | Test/command | Type | Result |
|---:|---|---|---|---|
| 1 | Matching older MSI, checksum, provenance, repository, and tag commit produce retained pass evidence | `previousReleaseVerification.test.ts` acceptance case | Integration | PASS |
| 2 | Checksum drift is rejected | checksum mismatch case | Negative integration | PASS |
| 3 | Same/newer previous versions are rejected | version-order case | Negative integration | PASS |
| 4 | Wrong repository, artifact digest, or tag commit is rejected | provenance adversarial cases | Negative integration | PASS |
| 5 | Absolute evidence paths reach signature inspection and unsigned input is rejected for Authenticode status | Windows PowerShell case | Platform integration | PASS |
| 6 | Hosted workflow requires publisher identity, prior metadata/signature checks, attestation permission, and both platform gates | `phase2Release.test.ts` | Contract | PASS |
| 7 | Bootstrap is manual, confirmed, prerelease-only, and explicitly not migration proof | `releaseWorkflow.test.ts` | Contract | PASS |
| 8 | Workflow YAML parses into six jobs | Python/PyYAML parse | Syntax | PASS |
| 9 | TypeScript and ESLint accept the final implementation | `pnpm typecheck`, `pnpm lint` | Static | PASS |
| 10 | Every CI/release action is immutable-commit pinned and both workflows still parse as YAML | immutable action contract plus PyYAML parse | Supply chain | PASS |

Immutable-action GREEN command:

```text
pnpm exec vitest run tests/release/releaseWorkflow.test.ts tests/release/phase2Release.test.ts
2 files / 14 tests passed
```

Focused GREEN command:

```text
pnpm exec vitest run tests/release/previousReleaseVerification.test.ts tests/release/phase2Release.test.ts tests/release/releaseWorkflow.test.ts
3 files / 19 tests passed
```

## Coverage and known gaps

The complete `pnpm verify:release` lane passed in 268.2 seconds with 88 test
files / 669 tests and 91.85% statements/lines, 88.79% branches, and 93.49%
functions. All thirteen Playwright journeys, Rust checks, package builds, desktop
smokes, and the normal NSIS lifecycle passed. The canonical production plan
retains the complete current evidence.
No local test can fabricate a trusted production certificate, Apple Developer
identity, GitHub attestation entitlement, previous signed release, or paid live
provider result. Those remain required hosted evidence rather than skipped tests.
