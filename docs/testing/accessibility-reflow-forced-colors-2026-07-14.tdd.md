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
`0bc5a10ddd681e47c59c0a28594ea8b99714e2c2`:

```text
pnpm verify:release
PASS in 223.3 seconds
```

Integrated results:

- 96 Vitest files / 693 tests passed.
- Coverage was 92.18% statements/lines, 89.05% branches, and 93.65% functions.
- Both deterministic evals passed with `liveCallsMade: 0`.
- Vite built 1,702 modules without a size warning; the main app chunk was
  444.91 kB / 128.89 kB gzip with validation split separately.
- All 14 Playwright journeys passed in 15.8 seconds: eleven functional and
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
| MSI | 5,885,952 | `90c5cc4299e68a121f534c5fc0ce41fa028ed2aa0ad3a600b2d0c9f708242b79` |
| NSIS | 4,192,136 | `844ff82302ede2e283a10526b287ff76682054c25bef84a2fa19fdf7da8f3956` |
| Release executable | 15,370,240 | `f8e9e87beb5636321578f2ecda074f21cc1478af555ee042ad1e0327189db5e0` |

The installer-lifecycle record completed at
`2026-07-15T05:59:08.3401248Z`; all five lifecycle assertions were true. The
separate packaged WebView product flow passed in 13.4 seconds against the exact
new MSI and a retained `0.1.0` package.

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
