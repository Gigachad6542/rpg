# Settings Destructive-Action Accessibility TDD Evidence — 2026-07-14

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

## Follow-up: restore and persona deletion

Commit `dec488b` (`test: require safe settings destructive actions`) added a
second RED contract. Both tests failed because the first click immediately
called the restore or persona-deletion callback.

Commit `fe248f5` (`feat: make settings destructive actions reversible`)
centralizes the keyboard-safe destructive dialog and applies it to runtime
imports, restore points, and persona deletion. A restore now captures the
current runtime immediately before applying the selected snapshot, so the
restore operation itself can be undone.

```text
pnpm exec vitest run tests/app/SettingsDestructiveActions.test.tsx tests/app/RuntimeImportReviewDialog.test.tsx tests/app/SettingsSection.test.tsx tests/ui/App.chat-lore.test.tsx
4 files / 27 tests passed
pnpm exec playwright test tests/e2e/critical-journeys.spec.ts --grep "reviewed runtime replacement"
1 passed
```

The browser journey verifies safe initial focus, explicit confirmation, the
restored runtime, and the newly captured pre-restore state appearing as another
named restore point.

## Complete verification

The latest `pnpm verify:release` passed from the beginning in 262.4 seconds with
commit `fe248f5` checked out:

- TypeScript and ESLint passed.
- 88 Vitest files / 669 tests passed.
- Coverage passed at 91.85% statements/lines, 88.80% branches, and 93.49%
  functions.
- Both deterministic eval lanes passed with zero live-provider calls.
- Vite built 1,695 modules; the main app chunk was 492.20 kB / 138.89 kB gzip.
- All 11 Playwright journeys passed in 10.9 seconds.
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
| MSI | 5,885,952 | `669c74097275ddad2b53d46215587377b2e81cc5c27fa0ad54fa0dc5047f02ed` |
| NSIS | 4,194,074 | `0a30b1126ea1a49276568466db0567f015ff94f04dfd0a4fbf861b7d72678a68` |
| Release executable | 15,366,144 | `eb32067fd415b250a2c0c3a9c46f15b9071a71b1ac61622aa2b82b33348bb822` |

The lifecycle record completed at `2026-07-15T03:21:44.7330881Z`; all five
install, persistence, registration-removal, and directory-removal assertions
were true.

## Evidence boundary

The ARIA and keyboard contract is verified in component tests and Chromium,
but no native screen-reader compatibility claim is made. The rebuilt Windows
artifacts remain unsigned local development packages, and this accessibility
work does not change the canonical 82/100 controlled-beta readiness rating or
the hosted release blockers in the production plan.
