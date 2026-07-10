import { describe, expect, it } from "vitest";

import { parseChubLorebookPayload } from "../../src/app/lorebookIo";
import { selectActiveLorebookEntries } from "../../src/runtime/loreTriggerEngine";

describe("parseChubLorebookPayload", () => {
  it("applies real defaults when numeric fields are omitted", () => {
    // Arrange: a minimal Chub export, as most real exports look.
    const payload = JSON.stringify({
      name: "World Lore",
      entries: [{ keys: ["gate"], content: "The old gate remembers every oath." }],
    });

    // Act
    const lorebook = parseChubLorebookPayload(payload);

    // Assert
    expect(lorebook).toMatchObject({ scanDepth: 4, tokenBudget: 800 });
    expect(lorebook.entries[0]).toMatchObject({ insertionOrder: 100, priority: 0, probability: 100 });
  });

  it("keeps explicit numeric fields", () => {
    // Arrange
    const payload = JSON.stringify({
      name: "World Lore",
      scan_depth: 7,
      token_budget: 1200,
      entries: [{ keys: ["gate"], content: "Content.", insertion_order: 80, priority: 9, probability: 25 }],
    });

    // Act
    const lorebook = parseChubLorebookPayload(payload);

    // Assert
    expect(lorebook).toMatchObject({ scanDepth: 7, tokenBudget: 1200 });
    expect(lorebook.entries[0]).toMatchObject({ insertionOrder: 80, priority: 9, probability: 25 });
  });

  it("triggers an imported entry that omitted probability", () => {
    // Arrange
    const lorebook = parseChubLorebookPayload(
      JSON.stringify({ name: "World Lore", entries: [{ keys: ["gate"], content: "The old gate remembers." }] }),
    );

    // Act
    const active = selectActiveLorebookEntries({ lorebooks: [lorebook], messages: [], draft: "I inspect the gate." });

    // Assert
    expect(active).toHaveLength(1);
    expect(active[0].content).toBe("The old gate remembers.");
  });
});
