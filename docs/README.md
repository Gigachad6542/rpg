# Project Documentation

This folder keeps operational notes and verification evidence for `rpg`.

## Operating Notes

- [Production hardening](production-hardening.md) covers persistence authority, startup recovery,
  Tauri command boundaries, prompt assembly, migration safety, and release verification.
- [Release packaging](release-packaging.md) covers the maintained desktop packaging gate and
  release artifact checklist.
- [Runtime contracts](runtime-contracts.md) covers versioned exports, redacted diagnostics,
  snapshot durability, migrations, and provider boundaries.
- [Production plan](production-plan.md) summarizes the current production-readiness audit,
  closed blockers, remaining launch work, release milestones, and acceptance gates.
- [macOS install](macos-install.md) covers the provisional Apple Silicon release lane,
  unsigned-build Gatekeeper behavior, current proof limits, and building locally on a Mac.
- [Remediation plan](remediation-plan.md) is the phased response to the July 10, 2026
  external production-readiness review: data-loss fixes, turn-state integrity,
  decomposition, test depth, and the Mac release lane.

## Testing Evidence

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
