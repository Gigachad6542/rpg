// The complete state delta produced by one assistant turn.
//
// A turn mutates the card through THREE appliers, in a fixed order (see
// App.tsx generateMockTurn): the hidden-continuity pass (story entities +
// memory), the visible-pass knowledge update, then the policy-filtered
// extraction (rpg state + memory). The turn ledger folds only the ACTIVE
// variant's delta, so all three must travel together as one payload —
// otherwise regeneration would fix rpg/inventory but still stack story-entity
// and knowledge changes from discarded variants.
import {
  applyHiddenContinuityToCard,
  createEmptyHiddenContinuityResult,
  type HiddenContinuityCard,
  type HiddenContinuityResult,
  type StoryEntity,
} from "./hiddenContinuity";
import { applyValidatedTurnEffectsToCard, type TurnEffectRuntimeCard } from "../app/turnEffects";
import { createEmptyExtractionResult, type ExtractionResult } from "./extraction";
import type { EffectFolder } from "./turnLedger";

/** Every mutation one assistant variant applies to the card, as one delta. */
export interface TurnStateEffects {
  /** Story entities + memory from the hidden continuity pass. */
  hiddenContinuity: HiddenContinuityResult;
  /** Knowledge updates grounded in the visible reply. */
  visibleKnowledge: HiddenContinuityResult;
  /** Policy-filtered rpg-state + memory updates. */
  extraction: ExtractionResult;
}

/** A card that both appliers accept. */
export type TurnStateCard = HiddenContinuityCard & TurnEffectRuntimeCard;

export function createEmptyTurnStateEffects(): TurnStateEffects {
  return {
    hiddenContinuity: createEmptyHiddenContinuityResult(),
    visibleKnowledge: createEmptyHiddenContinuityResult(),
    extraction: createEmptyExtractionResult(),
  };
}

/**
 * Applies one turn's full delta to a card, in the same order the live turn
 * pipeline uses. Pure: the input card is not mutated.
 */
export function applyTurnStateEffectsToCard<Card extends TurnStateCard>(
  card: Card,
  effects: TurnStateEffects,
): Card & { storyEntities: StoryEntity[] } {
  const withHidden = applyHiddenContinuityToCard(card, effects.hiddenContinuity);
  const withVisibleKnowledge = applyHiddenContinuityToCard(withHidden, effects.visibleKnowledge);
  return applyValidatedTurnEffectsToCard(withVisibleKnowledge, effects.extraction);
}

/** The combined applier as a ledger `EffectFolder` for `foldTurnLedger`. */
export function turnStateEffectFolder<Card extends TurnStateCard>(): EffectFolder<Card, TurnStateEffects> {
  return (card, effects) => applyTurnStateEffectsToCard(card, effects);
}
