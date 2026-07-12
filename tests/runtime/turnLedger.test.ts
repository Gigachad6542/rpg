import { describe, expect, it } from "vitest";

import { createEmptyExtractionResult, type ExtractionResult } from "../../src/runtime/extraction";
import {
  emptyTurnLedger,
  foldTurnLedger,
  pruneTurnLedger,
  recordTurnVariant,
  remapTurnLedger,
  selectVariantEffects,
  type EffectFolder,
  type LedgerMessage,
} from "../../src/runtime/turnLedger";
import { applyValidatedTurnEffectsToCard, type TurnEffectRuntimeCard } from "../../src/app/turnEffects";

// --- helpers ---------------------------------------------------------------

/** An extraction that only adds inventory items — enough to observe folding. */
function inventoryAdd(...items: string[]): ExtractionResult {
  return {
    ...createEmptyExtractionResult(),
    rpg_state_updates: {
      ...createEmptyExtractionResult().rpg_state_updates,
      inventory_add: items,
    },
  };
}

function rpgCard(inventory: string[] = []): TurnEffectRuntimeCard & { kind: "rpg" } {
  return {
    id: "card_test",
    name: "Test",
    kind: "rpg",
    memory: [],
    rpg: {
      location: "Start",
      health: "10/10",
      inventory,
      quests: [],
      flags: {},
      knownPlaces: ["Start"],
      mapStyle: "map",
    },
  };
}

function assistant(id: string, activeVariantIndex?: number): LedgerMessage {
  return { id, role: "assistant", activeVariantIndex };
}

function user(id: string): LedgerMessage {
  return { id, role: "user" };
}

/**
 * A trivial folder used to prove fold ORDER/SELECTION semantics independent of
 * the real effect content: each effect carries a marker in its (otherwise
 * unused) health_delta, and the folder concatenates that marker onto `name`.
 */
const traceFolder: EffectFolder<TurnEffectRuntimeCard> = (card, effects) => ({
  ...card,
  name: `${card.name}|${effects.rpg_state_updates.health_delta}`,
});

function traceEffect(marker: number): ExtractionResult {
  return {
    ...createEmptyExtractionResult(),
    rpg_state_updates: { ...createEmptyExtractionResult().rpg_state_updates, health_delta: marker },
  };
}

// --- tests -----------------------------------------------------------------

describe("turnLedger fold", () => {
  it("returns the base card unchanged for an empty ledger", () => {
    const base = rpgCard(["sword"]);
    const folded = foldTurnLedger(base, [user("u1"), assistant("a1")], emptyTurnLedger());
    expect(folded).toEqual(base);
  });

  it("applies a single turn's effects once", () => {
    const ledger = recordTurnVariant(emptyTurnLedger(), "a1", 0, inventoryAdd("torch"));
    const folded = foldTurnLedger(rpgCard(), [user("u1"), assistant("a1", 0)], ledger);
    expect(folded.rpg?.inventory).toEqual(["torch"]);
  });

  it("folds multiple turns in message order", () => {
    let ledger = recordTurnVariant(emptyTurnLedger(), "a1", 0, inventoryAdd("torch"));
    ledger = recordTurnVariant(ledger, "a2", 0, inventoryAdd("rope"));
    const folded = foldTurnLedger(
      rpgCard(),
      [user("u1"), assistant("a1", 0), user("u2"), assistant("a2", 0)],
      ledger,
    );
    expect(folded.rpg?.inventory).toEqual(["torch", "rope"]);
  });

  it("skips assistant messages that have no commit", () => {
    const ledger = recordTurnVariant(emptyTurnLedger(), "a1", 0, inventoryAdd("torch"));
    const folded = foldTurnLedger(rpgCard(), [assistant("a1", 0), assistant("a_uncommitted", 0)], ledger);
    expect(folded.rpg?.inventory).toEqual(["torch"]);
  });
});

describe("turnLedger regeneration semantics", () => {
  it("applies only the active variant's effects, not every generated variant", () => {
    // Turn a1 was generated twice: variant 0 added a sword, variant 1 added a shield.
    let ledger = recordTurnVariant(emptyTurnLedger(), "a1", 0, inventoryAdd("sword"));
    ledger = recordTurnVariant(ledger, "a1", 1, inventoryAdd("shield"));

    // Active variant = 1 (the regenerated one): only the shield is in inventory.
    const regenerated = foldTurnLedger(rpgCard(), [assistant("a1", 1)], ledger);
    expect(regenerated.rpg?.inventory).toEqual(["shield"]);
    expect(regenerated.rpg?.inventory).not.toContain("sword");
  });

  it("regenerating N times then settling on one variant equals applying exactly that variant", () => {
    let ledger = emptyTurnLedger();
    for (let index = 0; index < 5; index += 1) {
      ledger = recordTurnVariant(ledger, "a1", index, inventoryAdd(`item-${index}`));
    }
    for (let chosen = 0; chosen < 5; chosen += 1) {
      const folded = foldTurnLedger(rpgCard(), [assistant("a1", chosen)], ledger);
      const direct = applyValidatedTurnEffectsToCard(rpgCard(), inventoryAdd(`item-${chosen}`));
      expect(folded.rpg?.inventory).toEqual(direct.rpg?.inventory);
      expect(folded.rpg?.inventory).toEqual([`item-${chosen}`]);
    }
  });

  it("re-recording the same variant index replaces it rather than stacking", () => {
    let ledger = recordTurnVariant(emptyTurnLedger(), "a1", 0, inventoryAdd("old"));
    ledger = recordTurnVariant(ledger, "a1", 0, inventoryAdd("new"));
    expect(ledger.a1.variants).toHaveLength(1);
    const folded = foldTurnLedger(rpgCard(), [assistant("a1", 0)], ledger);
    expect(folded.rpg?.inventory).toEqual(["new"]);
  });
});

describe("turnLedger swipe semantics", () => {
  it("swiping to an earlier variant recomputes state from that variant", () => {
    let ledger = recordTurnVariant(emptyTurnLedger(), "a1", 0, inventoryAdd("sword"));
    ledger = recordTurnVariant(ledger, "a1", 1, inventoryAdd("shield"));

    const swipedToFirst = foldTurnLedger(rpgCard(), [assistant("a1", 0)], ledger);
    expect(swipedToFirst.rpg?.inventory).toEqual(["sword"]);

    const swipedToSecond = foldTurnLedger(rpgCard(), [assistant("a1", 1)], ledger);
    expect(swipedToSecond.rpg?.inventory).toEqual(["shield"]);
  });

  it("swiping an earlier turn re-derives all downstream turns from the new base", () => {
    let ledger = recordTurnVariant(emptyTurnLedger(), "a1", 0, inventoryAdd("torch"));
    ledger = recordTurnVariant(ledger, "a1", 1, inventoryAdd("lantern"));
    ledger = recordTurnVariant(ledger, "a2", 0, inventoryAdd("rope"));

    const withTorch = foldTurnLedger(rpgCard(), [assistant("a1", 0), assistant("a2", 0)], ledger);
    expect(withTorch.rpg?.inventory).toEqual(["torch", "rope"]);

    const withLantern = foldTurnLedger(rpgCard(), [assistant("a1", 1), assistant("a2", 0)], ledger);
    expect(withLantern.rpg?.inventory).toEqual(["lantern", "rope"]);
  });
});

describe("selectVariantEffects", () => {
  it("falls back to the last variant when the active index is missing or undefined", () => {
    let ledger = recordTurnVariant(emptyTurnLedger(), "a1", 0, traceEffect(1));
    ledger = recordTurnVariant(ledger, "a1", 1, traceEffect(2));
    const commit = ledger.a1;
    expect(selectVariantEffects(commit, undefined)?.rpg_state_updates.health_delta).toBe(2);
    expect(selectVariantEffects(commit, 99)?.rpg_state_updates.health_delta).toBe(2);
    expect(selectVariantEffects(commit, 0)?.rpg_state_updates.health_delta).toBe(1);
  });

  it("returns null for a commit with no variants", () => {
    expect(selectVariantEffects({ messageId: "a1", variants: [] }, 0)).toBeNull();
  });
});

describe("turnLedger fold ordering (folder-agnostic)", () => {
  it("folds active-variant markers in strict message order", () => {
    let ledger = recordTurnVariant(emptyTurnLedger(), "a1", 0, traceEffect(1));
    ledger = recordTurnVariant(ledger, "a2", 0, traceEffect(2));
    ledger = recordTurnVariant(ledger, "a3", 0, traceEffect(3));
    const folded = foldTurnLedger(
      rpgCard(),
      [assistant("a1", 0), assistant("a2", 0), assistant("a3", 0)],
      ledger,
      traceFolder,
    );
    expect(folded.name).toBe("Test|1|2|3");
  });
});

describe("turnLedger branch independence", () => {
  it("a branch folds independently of its parent after remap", () => {
    let parentLedger = recordTurnVariant(emptyTurnLedger(), "a1", 0, inventoryAdd("torch"));
    parentLedger = recordTurnVariant(parentLedger, "a2", 0, inventoryAdd("rope"));

    // Branch clones messages with new ids; remap the ledger the same way.
    const idMap = new Map([
      ["a1", "a1__branch_b1_1"],
      ["a2", "a2__branch_b1_3"],
    ]);
    let branchLedger = remapTurnLedger(parentLedger, idMap);
    // The branch then regenerates its second turn, choosing a different item.
    branchLedger = recordTurnVariant(branchLedger, "a2__branch_b1_3", 1, inventoryAdd("dagger"));

    const parent = foldTurnLedger(rpgCard(), [assistant("a1", 0), assistant("a2", 0)], parentLedger);
    const branch = foldTurnLedger(
      rpgCard(),
      [assistant("a1__branch_b1_1", 0), assistant("a2__branch_b1_3", 1)],
      branchLedger,
    );

    expect(parent.rpg?.inventory).toEqual(["torch", "rope"]);
    expect(branch.rpg?.inventory).toEqual(["torch", "dagger"]);
    // Parent is untouched by the branch's regeneration.
    expect(parent.rpg?.inventory).not.toContain("dagger");
  });

  it("remap drops commits whose id is absent from the map", () => {
    let ledger = recordTurnVariant(emptyTurnLedger(), "a1", 0, inventoryAdd("torch"));
    ledger = recordTurnVariant(ledger, "a2", 0, inventoryAdd("rope"));
    const remapped = remapTurnLedger(ledger, new Map([["a1", "a1_new"]]));
    expect(Object.keys(remapped)).toEqual(["a1_new"]);
    expect(remapped.a1_new.messageId).toBe("a1_new");
  });
});

describe("turnLedger fork/edit semantics", () => {
  it("pruning to surviving messages drops downstream commits", () => {
    let ledger = recordTurnVariant(emptyTurnLedger(), "a1", 0, inventoryAdd("torch"));
    ledger = recordTurnVariant(ledger, "a2", 0, inventoryAdd("rope"));
    ledger = recordTurnVariant(ledger, "a3", 0, inventoryAdd("dagger"));

    // Editing turn a2 forks the chat: keep a1, drop a2 and a3.
    const forked = pruneTurnLedger(ledger, ["a1"]);
    expect(Object.keys(forked).sort()).toEqual(["a1"]);
    const folded = foldTurnLedger(rpgCard(), [assistant("a1", 0)], forked);
    expect(folded.rpg?.inventory).toEqual(["torch"]);
  });

  it("accepts a Set as the keep collection", () => {
    let ledger = recordTurnVariant(emptyTurnLedger(), "a1", 0, inventoryAdd("torch"));
    ledger = recordTurnVariant(ledger, "a2", 0, inventoryAdd("rope"));
    const forked = pruneTurnLedger(ledger, new Set(["a2"]));
    expect(Object.keys(forked)).toEqual(["a2"]);
  });
});
