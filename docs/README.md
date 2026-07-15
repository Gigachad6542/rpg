# Project Documentation

Operational notes and verification evidence for `rpg`.

## Start here

- [Release readiness plan](production-plan.md) — current readiness score, open launch
  gates, milestones, and owner-only blockers. The canonical status doc.

## Operating notes

- [Production hardening](production-hardening.md) — persistence authority, startup
  recovery, Tauri command boundaries, prompt assembly, migration safety.
- [Runtime contracts](runtime-contracts.md) — versioned exports, redacted diagnostics,
  snapshot durability, migrations, and provider boundaries.
- [Release packaging](release-packaging.md) — desktop packaging gate and release artifact
  checklist.
- [Updater & rollback policy](updater-rollback-policy.md) — fail-closed promotion, manual
  updates, schema-safe rollback, credential revocation.
- [macOS install](macos-install.md) — signed Apple Silicon release contract, checksum
  verification, and local-only developer builds.

## Product

- [Phase 1 — core runtime](product/phase-1-core-runtime.md)
- [Phase 3 — competitive conversion](product/phase-3-competitive-conversion.md)

## Testing evidence

- [Testing evidence ledger](testing/README.md) — consolidated index of verified TDD
  passes. Full per-change narrative is in git history.
