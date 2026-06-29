# Hardening Pass TDD Evidence

## Source Plan

Journeys were derived from the repository audit findings in this Codex session.

## User Journeys

- As a desktop user, I want SQLite continuity to survive a newer blank fallback snapshot, so that startup interruptions do not hide real saved play data.
- As a desktop user, I want model output to update memory and RPG state only through validated extraction fields, so that raw player text is not silently promoted to memory.
- As an operator, I want failed migrations to roll back, so that partially applied schema changes are not recorded as successful.
- As a BYOK user, I want stored-key commands to reject unsupported providers, secret names, and oversized generation requests before reading the OS keychain.
- As a maintainer, I want the prompt debugger to compile the same prompt shape as real turn execution, so that previewed safety and continuity layers do not drift from generation.

## Task Report

| # | What is guaranteed | Test file or command | Test type | Result | Evidence |
|---|--------------------|----------------------|-----------|--------|----------|
| 1 | A newer blank local snapshot does not mask older SQLite data with real continuity | `tests/app/startupPersistencePolicy.test.ts` | unit | PASS | `pnpm exec vitest run tests/app/startupPersistencePolicy.test.ts tests/app/turnEffects.test.ts tests/db/migrations.test.ts` |
| 2 | Desktop runtime does not write the full browser `localStorage` fallback | `tests/app/startupPersistencePolicy.test.ts` | unit | PASS | same targeted Vitest run |
| 3 | Raw user text is not automatically admitted as card memory | `tests/app/turnEffects.test.ts` | unit | PASS | same targeted Vitest run |
| 4 | Explicit memory, quest, location, inventory, health, and boolean flag proposals are applied deterministically | `tests/app/turnEffects.test.ts` | unit | PASS | same targeted Vitest run |
| 5 | Failed migrations roll back and do not write an applied migration row | `tests/db/migrations.test.ts` | integration | PASS | same targeted Vitest run |
| 6 | Stored-secret key names and providers are allowlisted in Rust | `cargo test --lib` | unit | PASS | 5 Rust library tests passed |
| 7 | Stored-key generation requests enforce prompt/model/output limits and rate limiting | `cargo test --lib` | unit | PASS | 5 Rust library tests passed |
| 8 | Prompt preview and real turn execution share `compileTurnPrompt` assembly | `tests/ui/App.test.tsx` | integration | PASS | full `pnpm test` run |

## RED/GREEN Notes

RED evidence:

- Startup/effects tests initially failed because `startupPersistencePolicy` and `turnEffects` did not exist.
- Migration rollback test initially failed because the transient table survived a failed migration.
- Rust provider validation test initially failed because unknown providers and non-`apiKey` names were accepted.

GREEN evidence:

- Targeted Vitest run passed 3 files / 8 tests after implementation.
- `cargo test --lib` passed 5 tests after Rust command validation and rate-limit helpers were added.
- Historical run: `pnpm test:coverage` passed 18 files / 69 tests and reported 71.56% scoped statement coverage after generated temp files were excluded from instrumentation.

## Known Gaps

- The original renderer SQL permission gap from this pass has since been superseded by typed Rust persistence commands. The remaining persistence hardening project is choosing the normalized tables, not the compatibility snapshot, as the durable read authority.
- No ESLint or formatter is configured yet; this pass added verification scripts for the existing toolchain rather than adding new style dependencies.
