import { describe, expect, it } from "vitest";

import {
  buildSceneText,
  orderByRelevance,
  relevanceScore,
  selectPresentNames,
} from "../../src/runtime/relevanceScoring";

describe("relevance scoring", () => {
  it("joins only non-empty scene fragments", () => {
    expect(buildSceneText(["I enter the harbor", "", null, undefined, "  ", "beside Rook"])).toBe(
      "I enter the harbor beside Rook",
    );
  });

  it("counts distinct shared meaningful tokens", () => {
    const sceneTokens = new Set(["harbor", "rook", "lantern"]);
    expect(relevanceScore("Rook waits by the harbor lantern lantern", sceneTokens)).toBe(3);
    expect(relevanceScore("the and of", sceneTokens)).toBe(0);
  });

  it("orders scene-relevant memory first and keeps newest on ties", () => {
    const memory = [
      { id: "m0", text: "An old unrelated childhood anecdote" },
      { id: "m1", text: "Another unrelated trivia note" },
      { id: "m2", text: "Rook guards the harbor lantern gate" },
    ];

    const ordered = orderByRelevance(memory, (entry) => entry.text, "I meet Rook at the harbor gate");

    expect(ordered[0].id).toBe("m2");
    // m1 is newer than m0; both score 0, so m1 survives ahead of m0.
    expect(ordered[1].id).toBe("m1");
    expect(ordered[2].id).toBe("m0");
  });

  it("selects present characters by full name or distinctive token, biased to inclusion", () => {
    const present = selectPresentNames(
      ["Rook", "Elder Maren", "Ashen Guild", "Nia"],
      "I greet Rook and ask Maren about the road.",
    );

    expect(present.has("Rook")).toBe(true);
    expect(present.has("Elder Maren")).toBe(true);
    expect(present.has("Ashen Guild")).toBe(false);
    expect(present.has("Nia")).toBe(false);
  });

  it("returns no present names for an empty scene", () => {
    expect(selectPresentNames(["Rook"], "   ").size).toBe(0);
  });
});
