# Runtime Import Accessibility TDD Evidence — 2026-07-14

## Scope

The final runtime-import replacement step previously appeared as an inline
region. It required an explicit click, but it did not move or contain keyboard
focus, did not provide an Escape-to-cancel path, and did not restore focus to
the review control. This slice makes the destructive boundary modal and
keyboard complete without changing import parsing, restore-point creation, or
snapshot hydration.

## RED checkpoint

Commit `9c139c0` (`test: require safe runtime import review`) added the missing
contract first.

```text
pnpm exec vitest run tests/app/RuntimeImportReviewDialog.test.tsx
FAIL: ../../src/app/RuntimeImportReviewDialog could not be resolved
```

The tests require an `alertdialog`, `aria-modal`, safe initial focus on Cancel,
forward and reverse focus wrapping, Escape cancellation, explicit destructive
application, the restore-point notice, and opener focus restoration.

## GREEN implementation

Commit `ed90d95` (`feat: make runtime import confirmation accessible`) adds the
focused dialog component and integrates it into Settings. The replacement
action remains connected to the existing `captureRestorePoint()` call before
snapshot hydration. Commit `38517dc` updates the remaining browser contracts
after the complete gate found two stale selectors.

Focused component and integration result:

```text
pnpm exec vitest run tests/app/RuntimeImportReviewDialog.test.tsx tests/app/SettingsSection.test.tsx tests/ui/App.data.test.tsx
3 files / 13 tests passed
pnpm typecheck
PASS
pnpm lint
PASS
```

Browser acceptance result:

```text
pnpm exec playwright test tests/e2e/critical-journeys.spec.ts --grep "runtime export review"
1 passed
```

The first complete release run correctly failed 10/11 Playwright journeys
because the restore-point journey still requested the retired action label.
After removing every stale selector, both affected journeys passed together:

```text
pnpm exec playwright test tests/e2e/critical-journeys.spec.ts --grep "invalid runtime imports|reviewed runtime replacement"
2 passed
```

## Complete verification

`pnpm verify:release` then passed from the beginning in 258.2 seconds with
commit `38517dc` checked out:

- TypeScript and ESLint passed.
- 87 Vitest files / 667 tests passed.
- Coverage passed at 91.84% statements/lines, 88.78% branches, and 93.39%
  functions.
- Both deterministic eval lanes passed with zero live-provider calls.
- Vite built 1,694 modules; the main app chunk was 491.17 kB / 138.58 kB gzip.
- All 11 Playwright journeys passed in 10.8 seconds.
- The production dependency audit reported no known vulnerabilities.
- Rust audit passed with 18 allowed warnings and the two scoped `quick-xml`
  exceptions.
- 34 Rust tests passed; the signed-release-only Keychain smoke remained
  intentionally ignored; strict clippy passed.
- MSI and NSIS bundles, executable smoke, extracted-MSI persistence smoke, and
  the normal NSIS install/reinstall/persistent relaunch/uninstall lifecycle all
  passed.

Latest local artifacts:

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| MSI | 5,885,952 | `afe5dcc1c6eea3613bc8819c57d3dc50b5f066e445634e0b495c1dc253ad1290` |
| NSIS | 4,189,667 | `8d62ae37c3fd7a09a17192fcf0892beaced7315e9df9e9d8c78ed19deeacc765` |
| Release executable | 15,366,144 | `e066f6052941479cc7d4e3c3651dd853be29a45d62ba38b81fb503955aad9c7d` |

The lifecycle record completed at `2026-07-15T03:11:13.0950372Z`; all five
install, persistence, registration-removal, and directory-removal assertions
were true.

## Evidence boundary

The ARIA and keyboard contract is verified in component tests and Chromium,
but no native screen-reader compatibility claim is made. The rebuilt Windows
artifacts remain unsigned local development packages, and this accessibility
slice does not change the canonical 82/100 controlled-beta readiness rating or
the hosted release blockers in the production plan.
