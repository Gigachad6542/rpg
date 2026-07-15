import { describe, expect, it } from "vitest";

import { defaultNewCard } from "../../src/app/appDefaults";
import { buildRuntimeCardFromDraft } from "../../src/app/runtimeCardFactory";

describe("runtimeCardFactory", () => {
  it("normalizes an RPG draft and creates deterministic local state", () => {
    const card = buildRuntimeCardFromDraft(
      {
        ...defaultNewCard,
        kind: "rpg",
        name: "  Ember Road  ",
        summary: " ",
        characterName: " ",
        systemPrompt: " ",
        playerRules: "Keep promises\n\n  Track supplies  ",
        lorebookName: "  Frontier lore  ",
      },
      "card-test",
    );

    expect(card).toMatchObject({
      id: "card-test",
      name: "Ember Road",
      summary: "User-created runtime card.",
      characterName: "Ember Road",
      systemPrompt: "Follow this card's local rules and continuity.",
      rpg: {
        location: "Unmapped starting area",
        health: "not configured",
        inventory: [],
        quests: [],
        flags: {},
        knownPlaces: [],
      },
    });
    expect(card.playerRules.map((rule) => rule.description)).toEqual(
      expect.arrayContaining(["Keep promises", "Track supplies"]),
    );
    expect(card.lorebooks[0]?.name).toBe("Frontier lore");
  });

  it("does not create RPG state for a character card", () => {
    const card = buildRuntimeCardFromDraft(
      {
        ...defaultNewCard,
        kind: "character",
        name: "Sera",
        characterName: "Sera Vale",
      },
      "card-character",
    );

    expect(card.kind).toBe("character");
    expect(card.characterName).toBe("Sera Vale");
    expect(card.rpg).toBeUndefined();
    expect(card.storyEntities.map((entity) => entity.name)).toEqual(["Player Character", "Sera Vale"]);
  });
});
