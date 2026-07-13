import { describe, expect, it } from "vitest";

import type { Message } from "../../src/app/runtimeTypes";
import {
  advanceRollingSummary,
  reconcileRollingSummaryForHistory,
  type RollingSummaryScope,
} from "../../src/runtime/rollingSummary";

const scope: RollingSummaryScope = {
  cardId: "card-a",
  chatId: "chat-a",
  branchId: "branch-a",
};

function messages(contents: string[]): Message[] {
  return contents.map((content, index) => ({
    id: `m${index + 1}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content,
  }));
}

describe("rolling summaries", () => {
  it("summarizes only history outside the retained recent window", () => {
    const history = messages([
      "I arrive at Blackglass Harbor.",
      "Rook warns that the western gate is sealed.",
      "I promise to recover the silver cipher.",
      "Rook gives me a brass lantern.",
      "I walk toward the market.",
      "Rain starts over the market roofs.",
    ]);

    const summary = advanceRollingSummary({
      previous: null,
      messages: history,
      scope,
      retainRecentMessages: 2,
      maxCharacters: 500,
      now: "2026-07-12T12:00:00.000Z",
    });

    expect(summary).not.toBeNull();
    expect(summary?.scope).toEqual(scope);
    expect(summary?.coveredMessageIds).toEqual(["m1", "m2", "m3", "m4"]);
    expect(summary?.throughMessageId).toBe("m4");
    expect(summary?.text).toContain("Blackglass Harbor");
    expect(summary?.text).toContain("silver cipher");
    expect(summary?.text).not.toContain("market roofs");
  });

  it("advances incrementally without duplicating already-covered messages", () => {
    const initialHistory = messages([
      "I arrive at Blackglass Harbor.",
      "Rook warns that the gate is sealed.",
      "I seek the silver cipher.",
      "Rook gives me a lantern.",
      "I enter the market.",
      "The rain begins.",
    ]);
    const first = advanceRollingSummary({
      previous: null,
      messages: initialHistory,
      scope,
      retainRecentMessages: 2,
      maxCharacters: 1_000,
      now: "2026-07-12T12:00:00.000Z",
    });
    const extendedHistory = [
      ...initialHistory,
      { id: "m7", role: "user", content: "I shelter beneath the clock tower." },
      { id: "m8", role: "assistant", content: "The lantern reveals a hidden mark." },
    ] satisfies Message[];

    const second = advanceRollingSummary({
      previous: first,
      messages: extendedHistory,
      scope,
      retainRecentMessages: 2,
      maxCharacters: 1_000,
      now: "2026-07-12T12:05:00.000Z",
    });

    expect(second?.coveredMessageIds).toEqual(["m1", "m2", "m3", "m4", "m5", "m6"]);
    expect(second?.throughMessageId).toBe("m6");
    expect(second?.text.match(/Blackglass Harbor/g)).toHaveLength(1);
    expect(second?.text).toContain("rain begins");
    expect(second?.text).not.toContain("hidden mark");
  });

  it("does not create a summary until messages fall outside the recent window", () => {
    expect(
      advanceRollingSummary({
        previous: null,
        messages: messages(["One", "Two", "Three", "Four"]),
        scope,
        retainRecentMessages: 4,
        maxCharacters: 500,
        now: "2026-07-12T12:00:00.000Z",
      }),
    ).toBeNull();
  });

  it("invalidates a summary when its scope or covered history no longer matches", () => {
    const parentHistory = messages([
      "I arrive at the harbor.",
      "Rook closes the gate.",
      "I turn toward the market.",
      "The rain begins.",
    ]);
    const parent = advanceRollingSummary({
      previous: null,
      messages: parentHistory,
      scope,
      retainRecentMessages: 2,
      maxCharacters: 500,
      now: "2026-07-12T12:00:00.000Z",
    });
    expect(parent).not.toBeNull();

    const editedBranchHistory: Message[] = [
      { id: "branch-m1", role: "user", content: "I arrive at the harbor." },
      { id: "branch-m2", role: "assistant", content: "Rook opens the gate." },
    ];
    const branchScope: RollingSummaryScope = {
      cardId: scope.cardId,
      chatId: "chat-branch",
      branchId: "branch-edited",
    };

    expect(reconcileRollingSummaryForHistory(parent, parentHistory, branchScope)).toBeNull();
    expect(reconcileRollingSummaryForHistory(parent, editedBranchHistory, scope)).toBeNull();
    expect(reconcileRollingSummaryForHistory(parent, parentHistory, scope)).toEqual(parent);
    expect(parent?.scope).toEqual(scope);
  });

  it("keeps the persisted summary inside its configured character budget", () => {
    const history = messages([
      "A".repeat(120),
      "B".repeat(120),
      "C".repeat(120),
      "D".repeat(120),
    ]);

    const summary = advanceRollingSummary({
      previous: null,
      messages: history,
      scope,
      retainRecentMessages: 1,
      maxCharacters: 140,
      now: "2026-07-12T12:00:00.000Z",
    });

    expect(summary?.text.length).toBeLessThanOrEqual(140);
    expect(summary?.coveredMessageIds).toEqual(["m1", "m2", "m3"]);
  });
});
