# Continuity Hardening TDD Evidence

## Source Plan

Journeys were derived from the repository audit findings in this Codex session. No external plan
file was used.

Git checkpoint commits were intentionally skipped because this repository has no commits yet and the
working tree is entirely untracked baseline plus task edits. Creating checkpoint commits would have
swept unrelated project bootstrap files into the task history.

## User Journeys

- As a chat user, I want branched conversations to keep unique persisted message ids, so that older
  and branched histories do not collapse onto the same rows.
- As a prompt-run user, I want generated run ids to remain unique after deleting other cards, so that
  prompt history is not overwritten by count-based ids.
- As an RPG user, I want stale side-table RPG state to be pruned when a card loses its RPG payload,
  so that deleted state cannot reappear after reload.
- As a maintainer, I want the aggregate domain export to match the split chat and RPG contracts, so
  that narrator messages and structured RPG snapshots typecheck everywhere.
- As a release maintainer, I want CI and production notes to cover desktop packaging and Rust
  advisory scanning, so release checks match the actual Tauri app.

## Task Report

| # | What is guaranteed | Test file or command | Test type | Result | Evidence |
|---|--------------------|----------------------|-----------|--------|----------|
| 1 | Branched chats persist cloned message ids instead of reusing source message ids | `tests/ui/App.test.tsx` | integration | PASS | `pnpm exec vitest run tests/ui/App.test.tsx tests/app/runtimeRepositoryStore.test.ts tests/domain/domain.test.ts` |
| 2 | Prompt run ids do not reuse deleted-card ordinal ids | `tests/ui/App.test.tsx` | integration | PASS | same focused Vitest run |
| 3 | TypeScript repository pruning removes RPG side-table rows when `kind: "rpg"` no longer has an RPG payload | `tests/app/runtimeRepositoryStore.test.ts` | integration | PASS | same focused Vitest run |
| 4 | Rust repository pruning matches the TypeScript pruning rule | `cargo test --manifest-path src-tauri\Cargo.toml rpg_state_row_is_pruned_when_card_loses_rpg_payload` | unit | PASS | 1 Rust test passed |
| 5 | Aggregate domain contracts accept narrator messages and structured RPG snapshots without message ids | `tests/domain/domain.test.ts` | compile/runtime contract | PASS | same focused Vitest run |
| 6 | Full local verification still passes after the continuity fixes | `pnpm verify` | all-up local CI | PASS | typecheck, 78 Vitest tests, build, production audit, 11 Rust tests, clippy |
| 7 | Packaged desktop release artifacts build successfully | `pnpm desktop:build` | release build | PASS | MSI and NSIS bundles produced |

## RED/GREEN Notes

RED evidence:

- `pnpm exec vitest run tests/ui/App.test.tsx tests/app/runtimeRepositoryStore.test.ts tests/domain/domain.test.ts`
  failed 4 intended cases before production edits: aggregate domain drift, stale TypeScript RPG
  state row, branched duplicate message ids, and prompt run id reuse.
- `cargo test --manifest-path src-tauri\Cargo.toml rpg_state_row_is_pruned_when_card_loses_rpg_payload`
  failed before production edits because the stale RPG row count was 1 instead of 0.

GREEN evidence:

- The same focused Vitest run passed 3 files / 32 tests after implementation.
- The same focused Rust test passed after the Rust pruning rule was aligned.
- `pnpm verify` passed typecheck, 18 Vitest files / 78 tests, frontend build, production dependency
  audit, 11 Rust tests, and clippy.
- `pnpm test:coverage` passed 18 files / 78 tests and reported 72.73% scoped statement coverage.
- `pnpm desktop:build` produced:
  - `src-tauri/target/release/bundle/msi/Local-First AI RPG Runtime_0.1.0_x64_en-US.msi`
  - `src-tauri/target/release/bundle/nsis/Local-First AI RPG Runtime_0.1.0_x64-setup.exe`

## Known Gaps

- `cargo-audit` is not installed in the local Cargo toolchain, so the new CI advisory step was not
  run locally. The workflow now installs `cargo-audit` before running it in `src-tauri`.
- Overall coverage is below an 80% global threshold because type-heavy domain and adapter files are
  included in instrumentation. Runtime and repository paths touched by this pass are covered by
  focused tests.
