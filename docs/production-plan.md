# Release Readiness Plan

Status date: 2026-07-15 · Canonical readiness doc. Historical per-change evidence lives in
the [testing evidence ledger](testing/README.md) and git history.

**Current readiness: 85/100 — shippable as a controlled beta, not proven for broad public
release.** The local `verify:release` gate is green and the code-level launch blockers are
fixed and locally verified. The gap to public launch is entirely **release operations**:
no hosted, signed, notarized, clean-machine, upgrade-from-previous-version, or
live-provider-quality evidence exists yet for the exact release commit.

## Where we are

Proven locally (release checkout, `verify:release`):

- 96 Vitest files / 693 tests; coverage 92.18% statements/lines, 89.05% branches,
  93.65% functions (floors 90/85/90/90).
- Deterministic evals: Phase 1 and Phase 1.1 pass with `liveCallsMade: 0`.
- 14 Playwright journeys (11 functional + 2 WCAG A/AA + 1 reflow/forced-colors).
- JS + Rust audits clean (18 allowed transitive Rust warnings; 2 scoped `quick-xml`
  exceptions). 34 Rust tests + clippy `-D warnings`.
- MSI/NSIS packaging, executable smoke, MSI-payload SQLite smoke, and a real current-user
  NSIS install/reinstall/uninstall lifecycle.

Not yet proven (the launch gap):

- No hosted run on the exact release commit with real Windows signing or Apple
  notarization; no retained signing/Gatekeeper/Keychain/SBOM/attestation artifacts.
- Installer not repeated on a clean (non-development) VM; no upgrade from a previously
  signed semantic version.
- The private user-owned repo is ineligible for GitHub artifact attestation, and the
  release preflight fails closed until that is resolved.
- Live-provider narrative quality (the optional second model call) is unmeasured.

## Readiness scorecard

| Area | Score | Basis |
|---|---:|---|
| Correctness & data safety | 19/20 | SQLite authority, forward-only migrations, fail-safe hydration/recovery, deterministic turn lineage, backup/restore, tested single-writer policy. |
| Security & privacy boundaries | 14/15 | Keychain secret references, allowlisted scoped Tauri commands, loopback-only discovery, import limits, redaction, clean prod audits; accepted Rust debt remains. |
| Automated verification | 19/20 | Broad local gate + functional/WCAG/reflow browser lanes; native assistive-tech and live-provider evaluation absent. |
| Packaging & release ops | 14/20 | Fail-closed signed workflows + real local NSIS lifecycle exist; hosted signed/notarized, clean-VM, and published-upgrade evidence absent. |
| Product & UX maturity | 12/15 | Onboarding, sample content, imports, continuity, reversible recovery, keyboard paths, reflow/forced-colors; native AT acceptance absent. |
| Governance | 7/10 | Release/rollback/runtime/security/support/contribution/conduct contracts exist; licensing and verified public intake incomplete. |

## Open launch gates

### A. Hosted signed release (largest gap)
- Run the existing tag-triggered workflow on the exact release commit with real Windows
  Authenticode and Apple Developer ID signing + `notarytool` notarization/stapling.
- Confirm the publish job runs only after both platform jobs and `ci.yml` pass for the
  same commit SHA. Retain every signature, Gatekeeper, Keychain, SBOM, provenance, and
  attestation artifact.

### B. Attestation eligibility (fail-closed today)
- Make the repo public, transfer to an eligible GitHub Enterprise Cloud org, or approve a
  reviewed equivalent backend. The preflight rejects the private user-owned repo rather
  than silently omitting attestations.

### C. Installer trust
- Repeat the passing NSIS lifecycle on a clean, non-development Windows machine/VM.
- Add a true upgrade from a previous signed semantic version; run the hosted packaged flow
  against an actual previous signed MSI and verify migration, rotating backup, restore,
  and export. If no prior signed package exists, run the explicit non-promotable
  bootstrap-baseline mode first, then run the real candidate against that older tag.

### D. Live-provider quality
- Run the opt-in live evaluation with reviewed paid-call limits and blind pairwise scoring
  before recommending any second-call mode or model. Until then, `qwen3.7-max` stays a
  configurable default, not a measured winner, and the second call is not proven to earn
  its latency/cost.

### E. Accessibility depth
- Extend beyond the automated WCAG A/AA + reflow/forced-colors lanes into native WebView
  screen-reader, Windows High Contrast, magnifier/zoom, and switch-input checks.

### F. Governance & hygiene
- Owner licensing decision; configure verified public help, support, and
  security-reporting destinations.
- Track down the 18 allowed Rust warnings and 2 `quick-xml` exceptions as upstream paths
  move; remove or explicitly re-accept with rationale before launch.

## Milestones

### M1 — Controlled beta (current target)
Done when: `verify:release` passes in the release checkout; MSI/NSIS bundles retained with
checksums; release notes call out known warnings and unsigned-build status; backup/restore
tested once against the local app-data directory.

### M2 — Installer confidence
Done when: the installer runs on a clean non-development Windows profile; the installed app
creates/imports an RPG card, sends a mock/local turn, persists SQLite continuity through
close/reopen, and exports runtime data; the stored desktop API-key path is verified with
OS-keychain storage and no renderer key echo. (Gates: C.)

### M3 — Public launch
Done when: remote CI is green on the release tag; artifacts ship with checksums, release
notes, and signing/updater stance; Rust advisory warnings are removed or explicitly
accepted; first-run, empty, loading, error, provider-missing, ComfyUI-unavailable,
import-failure, and backup/restore paths have visible acceptance coverage. (Gates: A, B,
D, E, F.)

## Owner-only blockers

These cannot be cleared by code changes:

1. **Apple Developer Program** enrollment ($99/yr) + Developer ID certificate — unblocks
   macOS signing/notarization and deletes the Gatekeeper-bypass steps from
   [macos-install.md](macos-install.md).
2. **Windows code-signing certificate** — unblocks Authenticode signing.
3. **Attestation eligibility** — make the repo public or move it to an eligible org
   (see gate B).
4. **Licensing decision** — required before broad distribution.
5. **Public support/security intake** — verified destinations for help and vulnerability
   reports.

## Competitive wedge

The defensible position is not feature parity with SillyTavern, RisuAI, Backyard AI, or
NovelAI. It is **private, inspectable RPG continuity**: authoritative local SQLite state,
visible and undoable model proposals, deterministic branch lineage, and reversible
changes. Competing on ecosystem breadth before that flow is effortless would dilute the
product. See [product/phase-3-competitive-conversion.md](product/phase-3-competitive-conversion.md).
