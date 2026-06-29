# Project Documentation

This folder keeps operational notes and verification evidence for the local-first AI RPG runtime.

## Operating Notes

- [Production hardening](production-hardening.md) covers persistence authority, startup recovery,
  Tauri command boundaries, prompt assembly, migration safety, and release verification.

## Testing Evidence

- [Hardening pass TDD evidence](testing/hardening-pass.tdd.md) records the first persistence,
  migration, provider-secret, and prompt-debugger hardening pass.
- [Continuity hardening TDD evidence](testing/continuity-hardening.tdd.md) records the branch id,
  prompt-run id, RPG side-table pruning, domain-contract, CI, and desktop-build hardening pass.
- [Next-step hardening TDD evidence](testing/next-step-hardening.tdd.md) records the normalized
  persistence authority, schema integrity, dev path confinement, and quota fallback pass.
