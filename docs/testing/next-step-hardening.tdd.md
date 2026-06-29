# Next-Step Hardening TDD Evidence

## Source Plan

This pass implements the local release-readiness plan: repo hygiene and verification gates first,
then normalized persistence authority, SQLite integrity checks, security path narrowing, and focused
browser/runtime resilience tests. No push or external publish action was taken.

## User Journeys

- As a desktop player, I want saved continuity to reload from normalized SQLite rows even if the
  compatibility blob is stale.
- As a maintainer, I want schema constraints and indexes to match existing runtime relationships.
- As an operator, I want SQLite foreign keys, transactional migrations, and busy-timeout behavior to
  protect local data during release builds.
- As a developer, I want debug database overrides confined to test/dev storage, not arbitrary paths.
- As a browser/dev user, I want local fallback saves to degrade gracefully if localStorage quota is
  exceeded.

## Task Report

| # | What is guaranteed | Test file or command | Test type | Result | Evidence |
|---|--------------------|----------------------|-----------|--------|----------|
| 1 | Runtime store reloads messages, prompt runs, lorebooks, memory, RPG state, and generated maps from normalized rows before the compatibility blob | `tests/app/runtimeRepositoryStore.test.ts` | unit | PASS | Targeted Vitest run passed 4 runtime repository tests |
| 2 | Browser fallback save retries a compact snapshot on localStorage quota rejection | `tests/app/localRuntimeStore.test.ts` | unit | PASS | Targeted Vitest run passed 1 local store test |
| 3 | Migration SQL defines relation constraints, role/boolean checks, and runtime lookup indexes | `tests/db/migrations.test.ts` | unit/integration | PASS | Targeted Vitest run passed 4 migration tests |
| 4 | Native SQLite enforces foreign keys and rolls back failed save transactions | `cargo test --manifest-path src-tauri/Cargo.toml runtime_repository` | unit/integration | PASS | 9 runtime repository Rust tests passed |
| 5 | Native repository reloads normalized rows over a stale snapshot blob | `cargo test --manifest-path src-tauri/Cargo.toml runtime_repository` | unit/integration | PASS | `normalized_rows_win_over_stale_snapshot_blob` passed |
| 6 | Development `databasePath` is confined to the temp runtime workspace | `cargo test --manifest-path src-tauri/Cargo.toml runtime_repository` | unit | PASS | `development_database_path_is_confined_to_temp_workspace` passed |
| 7 | TypeScript and lint baselines remain clean | `pnpm typecheck`, `pnpm lint` | static | PASS | Both commands completed successfully |
| 8 | Release-candidate gate builds audited Windows bundles | `pnpm verify:release` | release gate | PASS | Coverage 73.65%; cargo audit completed with allowed warnings; MSI and NSIS bundles produced |

## RED/GREEN Notes

RED evidence:

- Normalized reload test failed because stale snapshot lorebooks won over normalized lorebook rows.
- Migration hardening test failed because schema SQL had no foreign keys, role checks, or indexes.
- localStorage quota test failed because the save helper rethrew `QuotaExceededError`.

GREEN evidence:

- Runtime repository, local store, and migration targeted Vitest run passed 3 files / 9 tests.
- Rust runtime repository suite passed 9 tests after enabling PRAGMAs and normalized-row precedence.
- `pnpm typecheck` and `pnpm lint` passed after the implementation.
- `pnpm verify` passed the everyday gate: typecheck, lint, Vitest, Vite build, production npm
  audit, Rust tests, and Rust clippy.
- `pnpm verify:release` passed and produced `Local-First AI RPG Runtime_0.1.0_x64_en-US.msi`
  plus `Local-First AI RPG Runtime_0.1.0_x64-setup.exe`.

## Known Gaps

- `cargo audit` currently reports allowed warnings for transitive desktop/GTK-era crates. Treat new
  vulnerability failures as release blockers.
- Coverage is intentionally floored at 72% while the project stabilizes. Raise it only after the
  deterministic coverage command has stayed stable across local and CI runs.
