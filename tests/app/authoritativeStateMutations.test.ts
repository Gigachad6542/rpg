import { describe, expect, it } from "vitest";

import { buildAuthoritativeStateMutations } from "../../src/app/authoritativeStateMutations";
import type { RuntimeCard } from "../../src/app/runtimeTypes";

function card(rpg: RuntimeCard["rpg"]): RuntimeCard {
  return {
    id: "card_test",
    name: "Test",
    kind: "rpg",
    summary: "",
    characterName: "Guide",
    characterDescription: "",
    scenario: "",
    greeting: "",
    exampleDialogs: "",
    systemPrompt: "",
    preHistoryInstructions: "",
    postHistoryInstructions: "",
    playerRules: [],
    lorebooks: [],
    memory: [],
    storyEntities: [],
    mapEnabled: false,
    rpg,
  };
}

describe("authoritative state mutations", () => {
  it("diffs every persisted RPG state family deterministically", () => {
    const before = card({
      location: "Gate",
      health: "unhurt",
      inventory: ["map", "rope"],
      quests: ["Find Sera", "Old task"],
      flags: { gate_open: false, old_flag: true },
      knownPlaces: ["Gate", "Old road"],
      mapStyle: "",
    });
    const after = card({
      location: "Tower",
      health: "bruised",
      inventory: ["rope", "key"],
      quests: ["Find Sera", "Ring bell"],
      flags: { gate_open: true, bell_rang: true },
      knownPlaces: ["Gate", "Tower"],
      mapStyle: "",
    });

    expect(buildAuthoritativeStateMutations(before, after)).toEqual([
      { type: "location_set", location: "Tower" },
      { type: "health_set", health: "bruised" },
      { type: "inventory_add", item: "key" },
      { type: "inventory_remove", item: "map" },
      { type: "quest_remove", quest: "Old task" },
      { type: "quest_set", quest: "Ring bell" },
      { type: "world_flag_set", flag: "gate_open", value: true },
      { type: "world_flag_set", flag: "bell_rang", value: true },
      { type: "world_flag_remove", flag: "old_flag" },
      { type: "known_place_remove", place: "Old road" },
      { type: "known_place_add", place: "Tower" },
    ]);
  });

  it("returns no mutations when either card lacks RPG state", () => {
    expect(buildAuthoritativeStateMutations(card(undefined), card(undefined))).toEqual([]);
  });
});
