import { describe, expect, it } from "vitest";

import {
  describeKnowledgeLeaks,
  detectKnowledgeLeaks,
} from "../../src/runtime/knowledgeLeakDetector";
import type { StoryEntity } from "../../src/runtime/hiddenContinuity";

function entity(overrides: Partial<StoryEntity> & Pick<StoryEntity, "name">): StoryEntity {
  return {
    id: `entity_${overrides.name.toLowerCase()}`,
    kind: "character",
    summary: "",
    knownFacts: [],
    doesNotKnow: [],
    notes: [],
    ...overrides,
  };
}

describe("knowledge leak detector", () => {
  it("flags a character stating a fact their ledger marks as unknown", () => {
    const rook = entity({
      name: "Rook",
      doesNotKnow: ["Nia carries a hidden silver coin"],
    });

    const findings = detectKnowledgeLeaks(
      'Rook leans in and whispers, "I know Nia carries a hidden silver coin in her boot."',
      [rook],
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].entityName).toBe("Rook");
    expect(describeKnowledgeLeaks(findings)[0]).toMatch(/knowledge leak: Rook/i);
  });

  it("does not flag when the fact appears in a different character's segment", () => {
    const rook = entity({ name: "Rook", doesNotKnow: ["Nia carries a hidden silver coin"] });

    const findings = detectKnowledgeLeaks(
      "Nia clutches the hidden silver coin she carries. Rook simply nods at the weather.",
      [rook],
    );

    expect(findings).toEqual([]);
  });

  it("ignores the player entity and short facts", () => {
    const player = entity({ kind: "player", name: "Nia", doesNotKnow: ["the vault code is 991"] });
    const rook = entity({ name: "Rook", doesNotKnow: ["gold"] });

    expect(
      detectKnowledgeLeaks("Nia knows the vault code is 991. Rook mentions gold.", [player, rook]),
    ).toEqual([]);
  });

  it("does not flag when the character stays within what they know", () => {
    const rook = entity({
      name: "Rook",
      knownFacts: ["The north gate is open"],
      doesNotKnow: ["Nia carries a hidden silver coin"],
    });

    expect(
      detectKnowledgeLeaks('Rook says, "The north gate is open, so we should move now."', [rook]),
    ).toEqual([]);
  });
});
