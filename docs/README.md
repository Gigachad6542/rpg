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
- [macOS install](macos-install.md) covers downloading the CI-built Apple Silicon `.dmg`,
  the unsigned-build Gatekeeper bypass, and building locally on a Mac.
- [Remediation plan](remediation-plan.md) is the phased response to the July 10, 2026
  external production-readiness review: data-loss fixes, turn-state integrity,
  decomposition, test depth, and the Mac release lane.

## Testing Evidence

- [Audit remediation TDD evidence](testing/audit-remediation-2026-07-03.tdd.md) records the
  red/green trail and final release verification for the July 3, 2026 audit remediation pass.
- [Continuity knowledge coherence TDD evidence](testing/continuity-knowledge-coherence.tdd.md)
  records the July 4, 2026 fixes for durable memory retention, knows/does-not-know conflict
  resolution, de-duplicated hidden-pass context, and same-turn knowledge updates.
