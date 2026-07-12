# Turn-state lineage TDD evidence

## Source and journeys

Source: Phase 1.1 of `docs/remediation-plan.md`, derived from the 2026-07-10
production-readiness review.

- As a player, I can regenerate a response without retaining the discarded response's
  inventory, memory, entity, or knowledge effects.
- As a player, selecting a response variant derives the state belonging to that exact
  variant; unsafe historical selections fail closed.
- As a player, branches evolve independently from a shared immutable root.
- As a player, editing a prior message forks and prunes dependent history instead of
  silently retaining stale state.
- As a returning player, the same lineage reloads with identical state and stable IDs.
- As a browser-fallback user, quota compaction never truncates lineage history without
  rebasing it.

## RED and GREEN report

| Task | RED evidence | GREEN evidence | Guarantee |
|---|---|---|---|
| Composite deterministic lineage | `vitest run tests/runtime/turnLedger.test.ts tests/runtime/runtimeTurnLineage.test.ts` failed because the module was absent and unknown variants inherited the newest delta | 22/22 targeted tests passed | Replay covers hidden and visible effects with stable IDs and fails unknown variants closed |
| Chat integration | `vitest run tests/app/chatTurnState.test.ts` failed because chat lineage helpers were absent | 8/8 helper tests passed | Normal turns, regeneration, branches, edits, rebases, and variant selection use persisted lineage |
| Regeneration input | Initial regression showed the discarded variant remained in the active card | `deriveCardForRegeneration` test passes | Both model passes start from state before the replaced assistant turn |
| Browser quota safety | `localRuntimeStore.test.ts` reproduced a lineage-backed session being cut from 120 messages to 50 | 4/4 local-store tests passed | Compaction does not break the base-plus-message-chain consistency unit |
| Live application wiring | Existing App path incrementally mutated the global card | Full App/UI suite passed after wiring through `chatTurnState.ts` | Chat/session operations preserve existing UI behavior while deriving authoritative state from lineage |

## Test specification

| # | What is guaranteed | Test target | Type | Result |
|---|---|---|---|---|
| 1 | Replaying the same turn twice yields deeply identical memory/entity IDs and timestamps | `runtimeTurnLineage.test.ts` | Unit | PASS |
| 2 | Only the selected variant contributes hidden and visible effects | `runtimeTurnLineage.test.ts` | Unit | PASS |
| 3 | Regeneration derives its input before the replaced assistant turn | `runtimeTurnLineage.test.ts`, `chatTurnState.test.ts` | Unit/integration | PASS |
| 4 | Parent and branch ledgers evolve independently | `runtimeTurnLineage.test.ts`, `chatTurnState.test.ts` | Unit/integration | PASS |
| 5 | Legacy sessions receive a synthetic current-state root | `chatTurnState.test.ts` | Migration | PASS |
| 6 | Earlier unsafe variant switching is refused | `chatTurnState.test.ts` | Integration | PASS |
| 7 | Editing prior user or assistant text forks and prunes stale descendants/effects | `chatTurnState.test.ts` | Integration | PASS |
| 8 | Manual state edits become a new root and stale variant controls fail closed | `chatTurnState.test.ts` | Integration | PASS |
| 9 | Quota compaction preserves lineage-backed history | `localRuntimeStore.test.ts` | Persistence | PASS |

## Commands and results

- `.\\node_modules\\.bin\\vitest.cmd run`: 48 files, 416 tests passed.
- `.\\node_modules\\.bin\\vitest.cmd run --coverage --no-file-parallelism --maxWorkers=1`:
  416 tests passed; 93.07% statements/lines, 89.64% branches, 94.3% functions.
- `.\\node_modules\\.bin\\tsc.cmd --noEmit`: passed.
- `.\\node_modules\\.bin\\eslint.cmd .`: passed.
- `.\\node_modules\\.bin\\vite.cmd build`: passed; the existing bundle-size warning remains.

## Merge evidence and known gaps

Checkpoint sequence on the active branch:

- `6034d0d` — RED: composite-lineage reproducer.
- `25ff873` — GREEN: deterministic complete lineage core.
- `62f93b5` — RED: chat integration guarantees.
- `1aab5b8` — GREEN: live runtime wiring.

Known gaps are intentionally outside Phase 1.1: provenance classification, a visible
per-turn delta panel, one-click undo, safe memory-consolidation confirmation, native
Tauri E2E, and Mac installed-app verification. Historical chats cannot recover exact
old per-variant effects; they migrate to a truthful synthetic root and unsafe controls
fail closed.
