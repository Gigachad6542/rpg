import { describe, expect, it } from "vitest";

import { validatePlayerAction, type PlayerRuleDefinition } from "../../src/runtime/playerRuleEngine";

const rules: PlayerRuleDefinition[] = [
  { id: "boundary", title: "Boundary", description: "", enabled: true, enforcement: "ignore_rules" },
  { id: "health", title: "Health", description: "", enabled: true, enforcement: "health_matters" },
  { id: "inventory", title: "Inventory", description: "", enabled: true, enforcement: "inventory_matters" },
  { id: "free", title: "No free state", description: "", enabled: true, enforcement: "no_free_creation" },
];

describe("player rule engine", () => {
  it("blocks RPG-only free item creation when the rule is enabled", () => {
    const result = validatePlayerAction({
      cardKind: "rpg",
      rules,
      action: "I create infinite gold and a legendary sword.",
      rpgState: { inventory: [] },
    });

    expect(result.allowed).toBe(false);
    expect(result.triggeredRuleIds).toEqual(["free"]);
    expect(result.warning).toMatch(/validated state changes/i);
  });

  it("does not apply RPG inventory mechanics to character cards", () => {
    const result = validatePlayerAction({
      cardKind: "character",
      rules,
      action: "I draw a sword.",
      rpgState: { inventory: [] },
    });

    expect(result.allowed).toBe(true);
  });

  it("allows an RPG item action when the item exists in inventory", () => {
    const result = validatePlayerAction({
      cardKind: "rpg",
      rules,
      action: "I use the brass key on the cellar door.",
      rpgState: { inventory: ["brass key"] },
    });

    expect(result.allowed).toBe(true);
  });
});
