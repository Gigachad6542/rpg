# Testing Evidence Ledger

This ledger replaces the 26 individual `*.tdd.md` evidence logs that previously lived in
`docs/testing/` (consolidated 2026-07-15). Each row was a RED/GREEN TDD record of a
verified change; the full narrative for any entry remains in git history at the referenced
former path (`git log --follow -- docs/testing/<file>`).

For **current** release status and the open launch gates, see
[../production-plan.md](../production-plan.md). This ledger is a historical index, not a
live readiness claim.

Outcome legend: **PASS** = landed and verified locally. Rows that touch signing,
notarization, hosted CI, clean-VM installs, or previous-version upgrades are marked
**PASS (local); hosted pending** because a local gate is not hosted/signed proof.

## Release, packaging & governance

| Date | Evidence (former file) | Outcome |
|---|---|---|
| 2026-07-14 | Windows installer lifecycle — real current-user NSIS install/reinstall/uninstall (`windows-installer-lifecycle`) | PASS (local); clean-VM + prior-version upgrade pending |
| 2026-07-14 | Trusted release-chain verification — independent previous-MSI signature/checksum/provenance/tag/version validation (`release-chain-verification`) | PASS (contract); hosted attestation pending |
| 2026-07-14 | Current claims & release repair — working-tree release-gate rerun, packaged discovery ACL fix, MSI-extraction scope (`current-claims-release-repair`) | PASS (local) |
| 2026-07-14 | Release governance — controlled-beta security/support/contribution/changelog/conduct/issue/PR surfaces (`release-governance`) | PASS |
| 2026-07-13 | Phase 2 shipped desktop — two-package Windows flow, signing/notarization inputs, SBOM, provenance, exact-commit promotion (`phase-2-shipped-desktop`) | PASS (inputs/contract); hosted signed run pending |
| 2026-07-03 | Audit remediation — July 3 red/green trail and release verification (`audit-remediation-2026-07-03`) | PASS |

## Runtime, continuity & retrieval

| Date | Evidence (former file) | Outcome |
|---|---|---|
| 2026-07-13 | Phase 1.1 live quality & retrieval — deterministic two-call quality/lore-retrieval lane (`phase-1.1-live-quality-retrieval`) | PASS; live paid run not performed |
| 2026-07-12 | Phase 1 core runtime — mode-aware call contract, typed event/retrieval continuity, 36-turn scorecard (`phase-1-core-runtime`) | PASS |
| 2026-07-12 | Two-call context correctness — per-model budgets, hidden/visible role separation, token accounting (`two-call-context-correctness`) | PASS |
| 2026-07-12 | Model-call, trust-boundary & import hardening — two-call usage ledger, system-prompt separation, strict import boundary (`model-call-trust-import-hardening`) | PASS |
| — | Continuity knowledge coherence — durable memory, knows/does-not-know conflict resolution, de-duplicated hidden context (`continuity-knowledge-coherence`) | PASS |
| — | Hidden-continuity fail-open behavior (`hidden-continuity-fail-open`) | PASS |
| — | Domain coverage consolidation (`domain-coverage-consolidation`) | PASS |

## Turn-state integrity

| Date | Evidence (former file) | Outcome |
|---|---|---|
| — | Turn-state lineage — deterministic variant/branch/edit/regeneration/persistence (`turn-state-lineage`) | PASS |
| — | Turn-state provenance — visible state proposals, undo, memory review, portrait consent (`turn-state-provenance`) | PASS |

## Accessibility

| Date | Evidence (former file) | Outcome |
|---|---|---|
| 2026-07-14 | Accessibility reflow & forced-colors — 320 CSS-pixel + forced-colors repairs, 14-browser rerun (`accessibility-reflow-forced-colors`) | PASS |
| 2026-07-14 | Automated accessibility & pnpm 11 — WCAG A/AA lane + supply-chain migration (`automated-accessibility-pnpm11`) | PASS (superseded by the reflow/forced-colors rerun) |
| 2026-07-14 | Browser critical journeys — 11 functional Playwright acceptance paths (`browser-critical-journeys`) | PASS |
| 2026-07-14 | Settings destructive-action accessibility — dialog focus traps, Escape, reversible restore (`runtime-import-accessibility`) | PASS |

## Architecture, platform & schema

| Date | Evidence (former file) | Outcome |
|---|---|---|
| 2026-07-14 | Controller decomposition — App.tsx/Rust module split, sub-800-line exit bar, orchestration hook contracts (`controller-decomposition`) | PASS |
| 2026-07-14 | Runtime policy contracts — enforced single-writer window, honest stored-secret streaming fallback (`runtime-policy-contracts`) | PASS |
| 2026-07-13 | Phase 3 competitive conversion surfaces (`phase-3-competitive-conversion`) | PASS |
| 2026-07-12 | Remediation completion — final TDD checkpoints and release-gate results (`remediation-completion`) | PASS (local) |
| — | Schema-v3 migration — historical v1/v2→v3 fixtures, constraint rebuild, atomicity, data preservation (`schema-v3-migration`) | PASS |
| — | Platform & root resilience — macOS compatibility lane, render-crash recovery boundary (`platform-resilience`) | PASS |
| — | Character portraits & media panels (`character-portraits-media-panels`) | PASS |
