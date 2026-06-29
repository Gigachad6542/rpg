import { describe, expect, it } from "vitest";

import { selectActiveLorebookEntries, type LoreTriggerBook } from "../../src/runtime/loreTriggerEngine";

const lorebook: LoreTriggerBook = {
  id: "book",
  enabled: true,
  scanDepth: 2,
  tokenBudget: 1000,
  recursiveScanning: false,
  entries: [
    {
      id: "gate",
      title: "Ancient Gate",
      keys: ["gate"],
      secondaryKeys: ["oath"],
      content: "The gate opens only for the remembered oath.",
      insertionOrder: 100,
      priority: 5,
      enabled: true,
      constant: false,
      probability: 100,
    },
    {
      id: "location",
      title: "Starting Area",
      keys: ["unmapped starting area"],
      secondaryKeys: [],
      content: "The starting area has not been mapped yet.",
      insertionOrder: 50,
      priority: 1,
      enabled: true,
      constant: false,
      probability: 100,
    },
  ],
};

describe("lore trigger engine", () => {
  it("uses primary and secondary keys when selecting entries", () => {
    const active = selectActiveLorebookEntries({
      lorebooks: [lorebook],
      messages: [{ content: "The old oath is carved nearby." }],
      draft: "I inspect the gate.",
    });

    expect(active.map((entry) => entry.id)).toEqual(["gate"]);
  });

  it("can trigger from RPG context such as current location", () => {
    const active = selectActiveLorebookEntries({
      lorebooks: [lorebook],
      messages: [],
      draft: "I look around.",
      context: { currentLocation: "Unmapped starting area" },
    });

    expect(active.map((entry) => entry.id)).toEqual(["location"]);
  });

  it("does not include a first lore entry that exceeds the lorebook token budget", () => {
    const active = selectActiveLorebookEntries({
      lorebooks: [
        {
          ...lorebook,
          tokenBudget: 10,
          entries: [
            {
              id: "huge",
              title: "Huge Gate Lore",
              keys: ["gate"],
              secondaryKeys: [],
              content: "oversized lore ".repeat(20),
              insertionOrder: 1,
              priority: 100,
              enabled: true,
              constant: false,
              probability: 100,
            },
            {
              id: "small",
              title: "Small Gate Lore",
              keys: ["gate"],
              secondaryKeys: [],
              content: "small lore",
              insertionOrder: 2,
              priority: 1,
              enabled: true,
              constant: false,
              probability: 100,
            },
          ],
        },
      ],
      messages: [],
      draft: "The gate opens.",
    });

    expect(active.map((entry) => entry.id)).toEqual(["small"]);
  });
});
