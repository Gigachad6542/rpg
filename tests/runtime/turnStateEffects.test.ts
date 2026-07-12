import { describe, expect, it } from "vitest";

import { createEmptyExtractionResult } from "../../src/runtime/extraction";
import { createEmptyHiddenContinuityResult } from "../../src/runtime/hiddenContinuity";
import {
  applyTurnStateEffectsToCard,
  createEmptyTurnStateEffects,
  turnStateEffectFolder,
  type TurnStateCard,
  type TurnStateEffects,
} from "../../src/runtime/turnStateEffects";
import { emptyTurnLedger, foldTurnLedger, recordTurnVariant, type LedgerMessage } from "../../src/runtime/turnLedger";

function card(): TurnStateCard {
  return {
    id: "card_test",
    name: "Test",
    kind: "rpg",
    summary: "A test card",
    memory: [],
    storyEntities: [],
    rpg: {
      location: "Start",
      health: "10/10",
      inventory: [],
      quests: [],
      flags: {},
      knownPlaces: ["Start"],
      mapStyle: "map",
    },
  };
}

/** An effect that both records a story entity and adds an inventory item. */
function effects(entityName: string, item: string): TurnStateEffects {
  return {
    hiddenContinuity: {
      ...createEmptyHiddenContinuityResult(),
      entityUpdates: [
        { name: entityName, kind: "character", summary: `${entityName} appears`, knownFacts: [], doesNotKnow: [], notes: [] },
      ],
    },
    visibleKnowledge: createEmptyHiddenContinuityResult(),
    extraction: {
      ...createEmptyExtractionResult(),
      rpg_state_updates: { ...createEmptyExtractionResult().rpg_state_updates, inventory_add: [item] },
    },
  };
}

function assistant(id: string, activeVariantIndex?: number): LedgerMessage {
  return { id, role: "assistant", activeVariantIndex };
}

describe("applyTurnStateEffectsToCard", () => {
  it("folds hidden-continuity entities and extraction rpg state together", () => {
    const result = applyTurnStateEffectsToCard(card(), effects("Nia", "torch"));
    expect(result.rpg?.inventory).toEqual(["torch"]);
    expect(result.storyEntities.some((entity) => entity.name === "Nia")).toBe(true);
  });

  it("an empty delta leaves rpg state unchanged", () => {
    const result = applyTurnStateEffectsToCard(card(), createEmptyTurnStateEffects());
    expect(result.rpg?.inventory).toEqual([]);
  });
});

describe("turnStateEffectFolder in the ledger", () => {
  it("regeneration applies only the active variant's entity AND rpg changes", () => {
    // Turn a1 generated twice: variant 0 introduced Nia + a sword, variant 1 introduced Rook + a shield.
    let ledger = recordTurnVariant(emptyTurnLedger<TurnStateEffects>(), "a1", 0, effects("Nia", "sword"));
    ledger = recordTurnVariant(ledger, "a1", 1, effects("Rook", "shield"));

    const folder = turnStateEffectFolder<TurnStateCard>();
    const active = foldTurnLedger(card(), [assistant("a1", 1)], ledger, folder);

    // Only the active variant's effects survive — no stacking of the discarded one.
    expect(active.rpg?.inventory).toEqual(["shield"]);
    const entityNames = (active.storyEntities ?? []).map((entity) => entity.name);
    expect(entityNames).toContain("Rook");
    expect(entityNames).not.toContain("Nia");
  });
});
