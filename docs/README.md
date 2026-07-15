# Project Documentation

This folder keeps operational notes and verification evidence for `rpg`.

## Operating Notes

- [Production hardening](production-hardening.md) covers persistence authority, startup recovery,
  Tauri command boundaries, prompt assembly, migration safety, and release verification.
- [Release packaging](release-packaging.md) covers the maintained desktop packaging gate and
  release artifact checklist.
- [Updater and rollback policy](updater-rollback-policy.md) defines fail-closed promotion,
  manual updates, schema-safe rollback, and credential revocation.
- [Runtime contracts](runtime-contracts.md) covers versioned exports, redacted diagnostics,
  snapshot durability, migrations, and provider boundaries.
- [Production plan](production-plan.md) summarizes the current production-readiness audit,
  closed blockers, remaining launch work, release milestones, and acceptance gates.
- [macOS install](macos-install.md) covers the signed Apple Silicon release contract,
  checksum verification, update/rollback boundaries, and local-only developer builds.
- [Remediation plan](remediation-plan.md) is the phased response to the July 10, 2026
  external production-readiness review: data-loss fixes, turn-state integrity,
  decomposition, test depth, and the Mac release lane.

## Testing Evidence

- [Trusted release-chain verification evidence](testing/release-chain-verification-2026-07-14.tdd.md)
  records independent previous-MSI signature/checksum/provenance/tag/version
  validation, the explicit first-release bootstrap sequence, and the current
  GitHub attestation capability boundary.
- [Controller decomposition evidence](testing/controller-decomposition-2026-07-14.tdd.md)
  records the behavior-preserving `App.tsx` extractions, Rust repository module
  split, and 81-test UI integration suite decomposition.
- [Release governance evidence](testing/release-governance-2026-07-14.tdd.md)
  records the controlled-beta security, support, contribution, changelog,
  conduct, issue, and pull-request surfaces plus their public-release limits.
- [Runtime policy contract evidence](testing/runtime-policy-contracts-2026-07-14.tdd.md)
  records the enforced desktop single-writer window and honest stored-secret
  streaming fallback.
- [Browser critical-journey evidence](testing/browser-critical-journeys-2026-07-14.tdd.md)
  records the eleven independent Playwright acceptance paths for offline
  onboarding, template creation, reload persistence, reversible import review,
  keyboard-safe dialogs, linked keyboard-operable navigation/tabs, and
  cancellable card/chat deletion, and provider-failure recovery.
- [Windows installer lifecycle TDD evidence](testing/windows-installer-lifecycle-2026-07-14.tdd.md)
  records stale-artifact prevention and the real current-user NSIS
  install/reinstall/uninstall proof, including cleanup checks and its remaining
  clean-VM/previous-version boundary.
- [Current claims and release-repair evidence](testing/current-claims-release-repair-2026-07-14.tdd.md)
  is the latest working-tree verification record: exact release-gate results,
  packaged discovery ACL repair, corrected MSI-extraction scope, and remaining
  external proof.
- [Phase 2 shipped-desktop TDD evidence](testing/phase-2-shipped-desktop-2026-07-13.tdd.md)
  records the two-package Windows product flow, backup restore, supply-chain artifacts,
  signing/notarization gates, exact-commit promotion, and remaining hosted proof.
- [Phase 1 core-runtime TDD evidence](testing/phase-1-core-runtime-2026-07-12.tdd.md)
  records the mode-aware call contract, typed event/retrieval continuity work,
  36-turn runtime scorecard, adversarial review fixes, and final verification.
- [Two-call context-correctness TDD evidence](testing/two-call-context-correctness-2026-07-12.tdd.md)
  records conservative per-model budgets, hidden/visible role separation, full token accounting,
  and persisted per-call input utilization.
- [Model-call, trust-boundary, and import-hardening TDD evidence](testing/model-call-trust-import-hardening-2026-07-12.tdd.md)
  records the two-call usage ledger, system-prompt separation, streaming extraction protection,
  strict runtime import boundary, and desktop privacy changes.
- [Audit remediation TDD evidence](testing/audit-remediation-2026-07-03.tdd.md) records the
  red/green trail and final release verification for the July 3, 2026 audit remediation pass.
- [Continuity knowledge coherence TDD evidence](testing/continuity-knowledge-coherence.tdd.md)
  records the July 4, 2026 fixes for durable memory retention, knows/does-not-know conflict
  resolution, de-duplicated hidden-pass context, and same-turn knowledge updates.
- [Turn-state lineage TDD evidence](testing/turn-state-lineage.tdd.md) records deterministic
  variant, branch, edit, regeneration, and persistence behavior.
- [Remediation completion evidence](testing/remediation-completion-2026-07-12.tdd.md) records the final TDD checkpoints, release-gate results, and remaining external Mac gates.
- [Turn-state provenance TDD evidence](testing/turn-state-provenance.tdd.md) records visible
  state proposals, undo, memory review, and portrait consent controls.
- [Schema-v3 migration TDD evidence](testing/schema-v3-migration.tdd.md) records the exact
  historical fixture, constraint rebuild, backups, atomicity, and data preservation.
- [Platform and root-resilience TDD evidence](testing/platform-resilience.tdd.md) records the
  macOS compatibility lane and render-crash recovery boundary.
