import { describe, expect, it } from "vitest";

import { createEmptyExtractionResult, type ExtractionResult } from "../../src/runtime/extraction";
import {
  branchRuntimeTurnLineage,
  createRuntimeTurnEffects,
  createRuntimeTurnLineage,
  deriveRuntimePreTurnCard,
  deriveRuntimeTurnCard,
  parseRuntimeTurnLineage,
  recordRuntimeTurnVariant,
} from "../../src/runtime/runtimeTurnLineage";
import { createEmptyHiddenContinuityResult, type HiddenContinuityResult } from "../../src/runtime/hiddenContinuity";

type TestCard = {
  id: string;
  name: string;
  kind: "rpg";
  summary: string;
  memory: Array<{ id: string; label: string; detail: string }>;
  storyEntities: Array<{
    id: string;
    name: string;
    kind: "player" | "character" | "faction" | "group";
    summary: string;
    knownFacts: string[];
    doesNotKnow: string[];
    notes: string[];
    updatedAt?: string;
  }>;
  rpg: {
    location: string;
    health: string;
    inventory: string[];
    quests: string[];
    flags: Record<string, boolean>;
    knownPlaces: string[];
    mapStyle: string;
  };
};

type TestMessage = {
  id: string;
  role: "user" | "assistant";
  activeVariantIndex?: number;
};

function card(): TestCard {
  return {
    id: "card_test",
    name: "Test",
    kind: "rpg",
    summary: "A test world",
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

function messages(activeVariantIndex = 0): TestMessage[] {
  return [
    { id: "u1", role: "user" },
    { id: "a1", role: "assistant", activeVariantIndex },
  ];
}

function extractionWithItem(item: string, knowledgeFact?: string): ExtractionResult {
  const empty = createEmptyExtractionResult();
  return {
    ...empty,
    character_knowledge_updates: knowledgeFact
      ? [{ subject: "Mira", knows: [knowledgeFact], does_not_know: [] }]
      : [],
    memory_updates: [{ label: "Loot", detail: `${item} was secured.` }],
    rpg_state_updates: {
      ...empty.rpg_state_updates,
      inventory_add: [item],
    },
  };
}

function hiddenWithEntity(fact: string): HiddenContinuityResult {
  return {
    ...createEmptyHiddenContinuityResult(),
    memoryUpdates: [{ label: "Continuity", detail: `Mira remembers ${fact}.` }],
    entityUpdates: [
      {
        name: "Mira",
        kind: "character",
        summary: "A careful scout",
        knownFacts: [],
        doesNotKnow: [],
        notes: [],
      },
    ],
    knowledgeUpdates: [{ subject: "Mira", knows: [fact], doesNotKnow: [] }],
  };
}

describe("runtime turn lineage", () => {
  it("persists branch provenance on generated memory", () => {
    const hidden = createEmptyHiddenContinuityResult();
    hidden.memoryUpdates = [{ label: "Branch fact", detail: "Rook opened this branch's gate." }];
    const effects = createRuntimeTurnEffects({
      hiddenContinuity: hidden,
      extraction: createEmptyExtractionResult(),
      committedAt: "2026-07-12T12:00:00.000Z",
      idSeed: "branch-memory",
      memoryRetrievalScope: { level: "branch", chatId: "chat-a", branchId: "branch-a" },
    });
    const lineage = recordRuntimeTurnVariant(createRuntimeTurnLineage(card()), "a1", 0, effects);
    const derived = deriveRuntimeTurnCard(card(), messages(), lineage);

    expect(derived.memory[0]).toMatchObject({
      retrievalScope: { level: "branch", chatId: "chat-a", branchId: "branch-a" },
      visibility: "narrator",
    });
  });

  it("replays hidden memory, entities, knowledge, and visible RPG effects deterministically", () => {
    let lineage = createRuntimeTurnLineage(card());
    lineage = recordRuntimeTurnVariant(
      lineage,
      "a1",
      0,
      createRuntimeTurnEffects({
        hiddenContinuity: hiddenWithEntity("the gate code"),
        extraction: extractionWithItem("torch", "the north road is blocked"),
        committedAt: "2026-07-11T12:00:00.000Z",
        idSeed: "a1-v0",
      }),
    );

    const first = deriveRuntimeTurnCard(card(), messages(), lineage);
    const second = deriveRuntimeTurnCard(card(), messages(), lineage);

    expect(second).toEqual(first);
    expect(first.rpg.inventory).toEqual(["torch"]);
    expect(first.memory.map((entry) => entry.detail)).toEqual([
      "Mira remembers the gate code.",
      "torch was secured.",
    ]);
    expect(first.memory.every((entry) => entry.id.length > 0)).toBe(true);
    expect(first.storyEntities.find((entity) => entity.name === "Mira")).toEqual(
      expect.objectContaining({
        knownFacts: ["the gate code", "the north road is blocked"],
        updatedAt: "2026-07-11T12:00:00.000Z",
      }),
    );
  });

  it("derives only the active variant's complete state", () => {
    let lineage = createRuntimeTurnLineage(card());
    lineage = recordRuntimeTurnVariant(
      lineage,
      "a1",
      0,
      createRuntimeTurnEffects({
        hiddenContinuity: hiddenWithEntity("the red route"),
        extraction: extractionWithItem("sword"),
        committedAt: "2026-07-11T12:00:00.000Z",
        idSeed: "a1-v0",
      }),
    );
    lineage = recordRuntimeTurnVariant(
      lineage,
      "a1",
      1,
      createRuntimeTurnEffects({
        hiddenContinuity: hiddenWithEntity("the blue route"),
        extraction: extractionWithItem("shield"),
        committedAt: "2026-07-11T12:01:00.000Z",
        idSeed: "a1-v1",
      }),
    );

    const first = deriveRuntimeTurnCard(card(), messages(0), lineage);
    const second = deriveRuntimeTurnCard(card(), messages(1), lineage);

    expect(first.rpg.inventory).toEqual(["sword"]);
    const firstMira = first.storyEntities.find((entity) => entity.name === "Mira");
    const secondMira = second.storyEntities.find((entity) => entity.name === "Mira");
    expect(firstMira?.knownFacts).toContain("the red route");
    expect(firstMira?.knownFacts).not.toContain("the blue route");
    expect(second.rpg.inventory).toEqual(["shield"]);
    expect(secondMira?.knownFacts).toContain("the blue route");
    expect(secondMira?.knownFacts).not.toContain("the red route");
  });

  it("derives regeneration input from before the replaced assistant turn", () => {
    let lineage = createRuntimeTurnLineage(card());
    lineage = recordRuntimeTurnVariant(
      lineage,
      "a1",
      0,
      createRuntimeTurnEffects({
        hiddenContinuity: createEmptyHiddenContinuityResult(),
        extraction: extractionWithItem("discarded sword"),
        committedAt: "2026-07-11T12:00:00.000Z",
        idSeed: "a1-v0",
      }),
    );

    const polluted = deriveRuntimeTurnCard(card(), messages(0), lineage);
    const preTurn = deriveRuntimePreTurnCard(card(), messages(0), lineage, "a1");

    expect(polluted.rpg.inventory).toEqual(["discarded sword"]);
    expect(preTurn.rpg.inventory).toEqual([]);
    expect(preTurn.memory).toEqual([]);
  });

  it("remaps branch commits and keeps parent and branch independent", () => {
    let parent = createRuntimeTurnLineage(card());
    parent = recordRuntimeTurnVariant(
      parent,
      "a1",
      0,
      createRuntimeTurnEffects({
        hiddenContinuity: createEmptyHiddenContinuityResult(),
        extraction: extractionWithItem("torch"),
        committedAt: "2026-07-11T12:00:00.000Z",
        idSeed: "a1-v0",
      }),
    );
    const parentMessages = messages(0);
    const branchMessages: TestMessage[] = [
      { id: "u1-branch", role: "user" },
      { id: "a1-branch", role: "assistant", activeVariantIndex: 0 },
    ];
    let branch = branchRuntimeTurnLineage(parent, parentMessages, branchMessages);
    branch = recordRuntimeTurnVariant(
      branch,
      "a1-branch",
      1,
      createRuntimeTurnEffects({
        hiddenContinuity: createEmptyHiddenContinuityResult(),
        extraction: extractionWithItem("lantern"),
        committedAt: "2026-07-11T12:01:00.000Z",
        idSeed: "a1-v1",
      }),
    );
    branchMessages[1].activeVariantIndex = 1;

    expect(deriveRuntimeTurnCard(card(), parentMessages, parent).rpg.inventory).toEqual(["torch"]);
    expect(deriveRuntimeTurnCard(card(), branchMessages, branch).rpg.inventory).toEqual(["lantern"]);
  });

  it("survives JSON persistence and migrates a legacy chat to a synthetic base", () => {
    let lineage = createRuntimeTurnLineage(card());
    lineage = recordRuntimeTurnVariant(
      lineage,
      "a1",
      0,
      createRuntimeTurnEffects({
        hiddenContinuity: hiddenWithEntity("the passphrase"),
        extraction: extractionWithItem("rope"),
        committedAt: "2026-07-11T12:00:00.000Z",
        idSeed: "a1-v0",
      }),
    );

    const reloaded = parseRuntimeTurnLineage(JSON.parse(JSON.stringify(lineage)), card());
    expect(deriveRuntimeTurnCard(card(), messages(), reloaded)).toEqual(
      deriveRuntimeTurnCard(card(), messages(), lineage),
    );

    const legacyCard = card();
    legacyCard.rpg.inventory = ["legacy item"];
    const migrated = parseRuntimeTurnLineage(undefined, legacyCard);
    expect(deriveRuntimeTurnCard(legacyCard, [], migrated).rpg.inventory).toEqual(["legacy item"]);
    expect(migrated.ledger).toEqual({});
  });
});
