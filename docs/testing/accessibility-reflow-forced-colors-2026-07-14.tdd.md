# Accessibility Reflow and Forced-Colors Evidence

Date: 2026-07-14 (America/Los_Angeles)

## Scope

This tranche extends the zero-violation browser accessibility lane with a
standards-oriented 320 CSS-pixel reflow check and forced-colors emulation. It
does not claim that Chromium emulation replaces manual testing with Windows
High Contrast, a native WebView screen reader, magnification software, or
switch input.

## RED checkpoint

Commit `a78eb15` (`test: add reflow and forced-colors acceptance`) added a third
Playwright accessibility journey. It checks first-run onboarding and all five
primary product sections at a 320 by 720 CSS-pixel viewport, rejects horizontal
document overflow and visible interactive controls outside the viewport, then
runs the unfiltered WCAG A/AA Axe tag set on Settings and Runtime with forced
colors active.

The focused test failed against real product defects in sequence:

- the onboarding card exceeded the viewport and its primary action could not
  be reached by scrolling;
- the Cards grid imposed a 443px minimum content width, creating 164px of
  horizontal document overflow;
- the Settings persona layout created 49px of horizontal overflow;
- forced-colors emulation replaced surfaces with white while dark-theme
  foreground tokens remained active, producing unreadable text;
- the constrained runtime transcript became scrollable without being keyboard
  focusable.

No rule, selector, impact level, surface, or overflow class was excluded to
obtain GREEN.

## GREEN checkpoint

Commit `4938de1` (`fix: support constrained and forced-color layouts`) made the
production repairs:

- first-run onboarding now has a viewport-bounded scrolling region;
- responsive workspace tracks use a zero minimum and panels/file inputs can
  shrink to their available inline size;
- mobile actions wrap, persona rows stack, and persona controls use bounded
  equal-width tracks;
- forced-colors mode remaps theme tokens to system colors and removes decorative
  shadows without opting out of the user's color choice;
- the named chat transcript log is keyboard focusable whenever it becomes a
  scrollable region.

Focused verification:

```text
pnpm exec playwright test tests/e2e/accessibility.spec.ts --project=chromium
3 passed (22.1s)

pnpm typecheck
PASS

pnpm lint
PASS
```

## Complete release verification

The latest canonical gate passed from the beginning on product commit
`68b40c1f373124d6ddccca222242e31be199c751`:

```text
pnpm verify:release
PASS in 274.0 seconds
```

Integrated results:

- 90 Vitest files / 675 tests passed.
- Coverage was 91.93% statements/lines, 88.84% branches, and 93.55% functions.
- Both deterministic evals passed with `liveCallsMade: 0`.
- Vite built 1,697 modules; the main app chunk was 493.53 kB / 139.17 kB gzip.
- All 14 Playwright journeys passed in 22.4 seconds: eleven functional and
  three accessibility journeys.
- Production dependency audit reported no known vulnerabilities.
- Rust audit exited successfully with 18 allowed warnings and the two scoped
  `quick-xml` exceptions.
- 34 Rust tests passed, one signed-release-only Keychain smoke was ignored as
  designed, and strict clippy passed.
- MSI/NSIS packaging, executable smoke, extracted-MSI SQLite persistence, and
  normal NSIS install/reinstall/persistent relaunch/uninstall all passed.

Current local artifacts:

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| MSI | 5,885,952 | `a5cb3ab8989668e57560ff75147480809c6a89018e01c2561385c9a04781b1dc` |
| NSIS | 4,194,558 | `b937e9bca12b7c7211a7a078cf6c11ab8ed01329c427f57c2bd5b779c9e79930` |
| Release executable | 15,366,144 | `439e3b82ef9d3ab06193ac7b3272d44c0acd835f4eaff9df2547fc0c9c18f2c8` |

The installer-lifecycle record completed at
`2026-07-15T04:44:02.6313724Z`; all five lifecycle assertions were true. The
separate packaged WebView product flow passed in 14.6 seconds against the new
MSI and retained different-commit `0.1.0` package.

## Evidence boundary

The code now has automated browser evidence for 320 CSS-pixel reflow,
forced-colors system-token behavior, key keyboard flows, both visual themes,
and key dialogs. This is stronger acceptance evidence, not full WCAG
conformance or native assistive-technology certification. Hosted exact-commit
signing/notarization, clean-machine lifecycle, published prior-version
migration, live-provider quality, attestation eligibility, licensing, and
verified public support/security intake remain required before broad launch.

The canonical readiness score is therefore 85/100: controlled-beta capable,
not objectively ready for broad public release.
