# Automated Accessibility and pnpm 11 Evidence

Date: 2026-07-14 (America/Los_Angeles)

## Scope

This checkpoint adds a standards-based browser accessibility acceptance lane,
repairs every violation it found without suppressing rules, and restores a
current frozen-install/audit toolchain. It does not claim that automated scans
replace native assistive-technology testing.

## Accessibility RED checkpoint

Commit `5f6feaf` (`test: add automated WCAG acceptance lane`) added
`@axe-core/playwright` 4.12.1 and a Playwright scan using the WCAG 2 A/AA,
WCAG 2.1 A/AA, and WCAG 2.2 AA Axe tags.

The first focused command failed against actual rendered product defects:

```text
pnpm exec playwright test tests/e2e/accessibility.spec.ts

dark onboarding: FAIL
color-contrast: primary onboarding buttons
definition-list: active-card summary
```

Subsequent expansion exposed additional light-theme contrast failures in
navigation, secondary actions, the onboarding badge, runtime message labels,
card-kind/readiness labels, and lorebook preview pills. Transient theme
animations are awaited through the Web Animations API before each scan; the
test does not use sleeps, exclusions, disabled rules, or impact filtering.

## Accessibility GREEN checkpoint

Commit `105f2bc` (`fix: meet automated WCAG acceptance gate`) made the
production repairs:

- primary controls use contrast-safe foreground/background theme tokens;
- accent, gold, and muted text variants remain distinct from decorative brand
  colors and satisfy the rendered light/dark surfaces;
- `dl` summaries now contain properly ordered direct `dt`/`dd` pairs, with
  live status regions nested inside their definitions;
- the acceptance lane covers dark and light onboarding, Runtime, Cards,
  Lorebooks, API Keys, Settings, the memory inspector, and runtime-import,
  restore, and persona-deletion dialogs.

Focused GREEN evidence:

```text
pnpm exec playwright test tests/e2e/accessibility.spec.ts
2 passed (19.6s)

pnpm typecheck
PASS

pnpm lint
PASS
```

The acceptance condition is zero Axe violations on every scanned surface.

## Package-manager RED checkpoints

Release verification found that the repository was only half-migrated between
pnpm generations:

1. pnpm 9.15.9 rejected the frozen lockfile because workspace overrides did
   not match its supported configuration location.
2. After temporarily restoring pnpm 9 compatibility, the release-policy test
   still enforced the modern workspace layout.
3. pnpm 9's production audit client then received HTTP 410 from npm's retired
   legacy audit endpoint after all 669 unit tests, evals, build, and 13 browser
   journeys had passed.

The failed runs are not counted as release evidence.

## Package-manager GREEN checkpoint

Commit `d95f9e0` (`fix: migrate release gates to pnpm 11`) aligns every surface
on pnpm 11.7.0:

- `packageManager`, engine range, both CI jobs, and both release jobs agree;
- overrides live in `pnpm-workspace.yaml`, the configuration source required by
  pnpm 11;
- `allowBuilds` approves only `esbuild@0.25.12`; unreviewed dependency build
  scripts still fail closed;
- no broad `dangerouslyAllowAllBuilds` escape hatch is present;
- the release-policy regression test verifies the toolchain, overrides, exact
  build allowlist, and all four hosted setup pins.

The current pnpm 11 configuration follows the official `allowBuilds` policy:
<https://pnpm.io/settings#allowbuilds>.

```text
CI=true pnpm install --frozen-lockfile
PASS; lockfile supply-chain policy verified; esbuild@0.25.12 postinstall approved

pnpm audit --prod
No known vulnerabilities found
```

## Reflow and forced-colors follow-up

Commit `a78eb15` added a RED 320 CSS-pixel reflow and forced-colors journey;
commit `4938de1` repaired constrained onboarding, grid and persona layouts,
system-color token mapping, and keyboard access to the scrollable transcript.
The complete RED/GREEN record is in
`accessibility-reflow-forced-colors-2026-07-14.tdd.md`.

## Complete release verification

The canonical command passed from the beginning with product commit `0bc5a10`
checked out:

```text
pnpm verify:release
PASS in 223.3 seconds
```

Integrated results:

- TypeScript and ESLint passed.
- 96 Vitest files / 693 tests passed.
- V8 coverage: 92.18% statements/lines, 89.05% branches, 93.65% functions.
- Phase 1 and Phase 1.1 deterministic evals passed; Phase 1.1 made zero live
  provider calls.
- Vite built 1,702 modules without a size warning; the main app chunk was
  444.91 kB / 128.89 kB gzip with validation split separately.
- All 14 Playwright journeys passed in 15.8 seconds, including three
  accessibility journeys.
- Production dependency audit reported no known vulnerabilities.
- Rust audit exited successfully with 18 allowed warnings and the two scoped
  `quick-xml` exceptions.
- 34 Rust tests passed; the signed-release-only Keychain smoke was ignored as
  designed; strict clippy passed.
- MSI and NSIS packaging, executable smoke, extracted-MSI SQLite persistence,
  and normal NSIS install/reinstall/persistent-relaunch/uninstall all passed.

Current local artifacts:

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| MSI | 5,885,952 | `90c5cc4299e68a121f534c5fc0ce41fa028ed2aa0ad3a600b2d0c9f708242b79` |
| NSIS | 4,192,136 | `844ff82302ede2e283a10526b287ff76682054c25bef84a2fa19fdf7da8f3956` |
| Release executable | 15,370,240 | `f8e9e87beb5636321578f2ecda074f21cc1478af555ee042ad1e0327189db5e0` |

The installer-lifecycle record completed at
`2026-07-15T05:59:08.3401248Z`; first launch, same-version repair/reinstall,
second-launch persistence, uninstall-registration removal, and install-directory
removal were all true.

The separate packaged WebView product flow passed in 13.4 seconds using the
retained different-commit `0.1.0` MSI as the previous package and the current
MSI above. It exercised create/play/export, current-build migration, reopen,
backup retention, restore, and export. Because both packages are `0.1.0` and
the older one was never a published signed release, this remains local
different-commit proof rather than semantic-version migration evidence.

## Evidence boundary

Automated Axe, 320 CSS-pixel reflow, and forced-colors emulation materially
improve the browser acceptance baseline but do not prove full WCAG conformance,
native WebView/screen-reader behavior, native Windows High Contrast, magnifier,
or switch-input usability. The rebuilt
Windows artifacts are unsigned local development packages. Hosted exact-commit
signing/notarization, clean-machine lifecycle, published prior-version
migration, live-provider quality, attestation eligibility, licensing, and
public support/security intake remain required before broad public launch.

The canonical readiness score is therefore 85/100: controlled-beta capable,
not objectively ready for broad public release.
