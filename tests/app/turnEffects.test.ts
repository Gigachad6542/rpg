import { describe, expect, it, vi } from "vitest";

import { createEmptyExtractionResult, type ExtractionResult } from "../../src/runtime/extraction";
import { applyValidatedTurnEffectsToCard, type TurnEffectRuntimeCard } from "../../src/app/turnEffects";

describe("validated turn effects", () => {
  it("does not create memory from raw user text when extraction has no memory proposal", () => {
    const card = createRpgCard();

    const next = applyValidatedTurnEffectsToCard(card, createEmptyExtractionResult(), {
      now: () => "2026-06-29T12:00:00.000Z",
      randomId: () => "abc12",
    });

    expect(next.memory).toEqual(card.memory);
  });

  it("applies explicit memory, quest, location, inventory, health, and boolean flag proposals", () => {
    vi.spyOn(Date, "now").mockReturnValue(123);
    const card = createRpgCard();
    const extraction: ExtractionResult = {
      ...createEmptyExtractionResult(),
      memory_updates: [
        {
          label: "Discovered clue",
          text: "The cellar gate answers to the brass key.",
        },
      ],
      rpg_state_updates: {
        location: "Cellar Gate",
        health_delta: -2,
        inventory_add: ["brass key"],
        inventory_remove: ["old torch"],
        quest_updates: [{ title: "Open the cellar gate" }],
        world_flags: {
          gate_seen: true,
          ignored_text_flag: "not supported by the card UI",
        },
      },
    };

    const next = applyValidatedTurnEffectsToCard(card, extraction, {
      now: () => "2026-06-29T12:00:00.000Z",
      randomId: () => "abc12",
    });

    expect(next.memory).toEqual([
      {
        id: "memory_20260629T120000000Z_abc12",
        label: "Discovered clue",
        detail: "The cellar gate answers to the brass key.",
      },
    ]);
    expect(next.rpg).toMatchObject({
      location: "Cellar Gate",
      health: "8/10",
      inventory: ["brass key"],
      quests: ["Open the cellar gate"],
      knownPlaces: ["Start", "Cellar Gate"],
      flags: {
        gate_seen: true,
      },
    });
    expect(next.rpg?.flags).not.toHaveProperty("ignored_text_flag");
  });
});

function createRpgCard(): TurnEffectRuntimeCard {
  return {
    id: "card-1",
    name: "Blank Slate RPG",
    kind: "rpg",
    memory: [],
    rpg: {
      location: "Start",
      health: "10/10",
      inventory: ["old torch"],
      quests: [],
      flags: {},
      knownPlaces: ["Start"],
      mapStyle: "map",
    },
  };
}
