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

The latest `pnpm verify:release` passed from the beginning in 223.3 seconds with
commit `0bc5a10` checked out:

- TypeScript and ESLint passed.
- 96 Vitest files / 693 tests passed.
- Coverage passed at 92.18% statements/lines, 89.05% branches, and 93.65%
  functions.
- Both deterministic eval lanes passed with zero live-provider calls.
- Vite built 1,702 modules without a size warning; the main app chunk was
  444.91 kB / 128.89 kB gzip with validation split separately.
- All 14 Playwright journeys passed in 15.8 seconds, including three
  accessibility journeys for zero-violation WCAG A/AA scans, 320 CSS-pixel
  reflow, and forced colors.
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
| MSI | 5,885,952 | `90c5cc4299e68a121f534c5fc0ce41fa028ed2aa0ad3a600b2d0c9f708242b79` |
| NSIS | 4,192,136 | `844ff82302ede2e283a10526b287ff76682054c25bef84a2fa19fdf7da8f3956` |
| Release executable | 15,370,240 | `f8e9e87beb5636321578f2ecda074f21cc1478af555ee042ad1e0327189db5e0` |

The lifecycle record completed at `2026-07-15T05:59:08.3401248Z`; all five
install, persistence, registration-removal, and directory-removal assertions
were true.

## Evidence boundary

The ARIA and keyboard contract is verified in component tests and Chromium,
but no native screen-reader compatibility claim is made. The rebuilt Windows
artifacts remain unsigned local development packages. The broader automated
WCAG/reflow/forced-colors lane raises the canonical controlled-beta readiness
rating to 85/100 but
does not clear the hosted release blockers in the production plan.
