# Continuity Knowledge Coherence TDD Evidence

## Source

User request: make memory auto-updating, per-character knowledge isolation (characters must not
mention things they should not know), and the hidden-pass/visible-pass interaction as functional
as possible.

## User Journey

As a player, I want durable memory to survive long sessions, characters to act only on what the
knowledge ledger says they know, and the hidden continuity pre-pass to feed the visible response
call without duplicated or contradictory context.

## Defects Fixed

1. `applyValidatedTurnEffectsToCard` capped all card memory at the last 10 entries every turn, so
   durable hidden-continuity facts were evicted within a few turns, and duplicate memory proposals
   were re-appended. The cap is now `MAX_CARD_MEMORY_ENTRIES` (120) with normalized-text dedupe.
2. `mergeEntityUpdate`/`mergeKnowledgeUpdate` kept contradictory facts in both `knownFacts` and
   `doesNotKnow` forever. Newer updates now win: learning a fact removes its token-similar entry
   from `doesNotKnow` and vice versa, with a does-not-know-wins rule for self-contradicting
   updates and a per-list cap of `MAX_ENTITY_FACT_ENTRIES` (16) newest facts.
3. The full private continuity block was compiled into the visible prompt twice (recent-chat-history
   layer plus latest-user-message layer), and the full story entity ledger appeared three times
   (knowledge boundaries layer, visible message ledger copy, this-turn update copy). The pipeline
   now receives history without the hidden message, and the private block carries only this turn's
   deltas while the knowledge boundaries layer stays the single authoritative ledger.
4. Visible-pass `character_knowledge_updates` were validated but never applied. They now pass
   through the grounding policy gate (subject and facts must be grounded in the player action or
   assistant text) and merge into the story entity ledger in the same turn.

## RED/GREEN Summary

| Behavior | Test target | RED evidence | GREEN evidence |
|---|---|---|---|
| Memory dedupe plus 120-entry cap with oldest eviction | `tests/app/turnEffects.test.ts` | New assertions failed against `slice(-10)` behavior | `vitest run tests/app/turnEffects.test.ts` passed: 9 tests |
| Grounded knowledge updates kept, ungrounded blocked with warnings, non-RPG cards included | `tests/app/turnEffects.test.ts` | `character_knowledge_updates` previously passed through unfiltered | Same command passed |
| Knows/does-not-know conflict resolution, self-contradiction preference, fact caps | `tests/runtime/hiddenContinuity.test.ts` | New assertions failed against append-only merges | `vitest run tests/runtime/hiddenContinuity.test.ts` passed: 14 tests |
| Visible private block carries deltas only; empty hidden results add no private block; hidden prompt memory capped at newest 40 | `tests/runtime/hiddenContinuity.test.ts` | Ledger and header were embedded unconditionally | Same command passed |
| Same-turn roster update from a grounded visible-pass knowledge proposal | `tests/ui/App.test.tsx` | Roster only changed via the next turn's hidden pass | `vitest run tests/ui/App.test.tsx` passed: 69 tests |

## Validation

| Command | Result |
|---|---|
| `vitest run tests/runtime/hiddenContinuity.test.ts tests/app/turnEffects.test.ts` | PASS, 23 tests |
| `vitest run tests/ui/App.test.tsx` | PASS, 69 tests |
| `tsc --noEmit` | PASS |
| `eslint .` | PASS |
| `vitest run` | PASS, 238 tests across 31 files |
| `vitest run --coverage --no-file-parallelism --maxWorkers=1` | PASS, 99.06% statements, 92.93% branches, 100% functions |
| `tsc && vite build` | PASS |

Rust sources were not touched in this pass, so `cargo test`/`cargo clippy` results from the
previous verification remain the standing evidence for the desktop backend.
