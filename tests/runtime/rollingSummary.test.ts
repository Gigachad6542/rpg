import { describe, expect, it } from "vitest";

import type { Message } from "../../src/app/runtimeTypes";
import {
  advanceRollingSummary,
  branchRollingSummary,
  MAX_ROLLING_SUMMARY_CHARACTERS,
  parseRollingSummary,
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
  it("parses bounded persisted summaries and rejects malformed history metadata", () => {
    const history = messages(["One", "Two", "Three", "Four", "Five"]);
    const summary = advanceRollingSummary({
      previous: null,
      messages: history,
      scope,
      retainRecentMessages: 2,
      maxCharacters: 1_000,
      now: "2026-07-12T12:00:00.000Z",
    });

    expect(parseRollingSummary(JSON.parse(JSON.stringify(summary)))).toEqual(summary);
    expect(parseRollingSummary({ ...summary, scope: { cardId: "card-a" } })).toBeNull();
    expect(parseRollingSummary({ ...summary, coveredMessageFingerprints: ["bad"] })).toBeNull();
  });

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

  it("keeps newly covered facts when a capped summary advances", () => {
    const initial = messages([
      "Old harbor detail ".repeat(20),
      "Old gate detail ".repeat(20),
      "Recent one",
      "Recent two",
    ]);
    const first = advanceRollingSummary({
      previous: null,
      messages: initial,
      scope,
      retainRecentMessages: 2,
      maxCharacters: 140,
      now: "2026-07-12T12:00:00.000Z",
    });
    const extended = [
      ...initial,
      { id: "m5", role: "user", content: "NEWEST_FACT: the moon key opens the vault." },
      { id: "m6", role: "assistant", content: "Keep this recent." },
    ] satisfies Message[];

    const second = advanceRollingSummary({
      previous: first,
      messages: extended,
      scope,
      retainRecentMessages: 1,
      maxCharacters: 140,
      now: "2026-07-12T12:05:00.000Z",
    });

    expect(second?.text).toContain("NEWEST_FACT");
    expect(second?.text.length).toBeLessThanOrEqual(140);
    expect(second?.throughMessageId).toBe("m5");
  });

  it("compacts coverage metadata and remains parseable beyond ten thousand messages", () => {
    const longHistory: Message[] = Array.from({ length: 10_025 }, (_, index) => ({
      id: `long-${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      content: `Turn ${index}`,
    }));

    const summary = advanceRollingSummary({
      previous: null,
      messages: longHistory,
      scope,
      retainRecentMessages: 12,
      maxCharacters: MAX_ROLLING_SUMMARY_CHARACTERS,
      now: "2026-07-12T12:00:00.000Z",
    });

    expect(summary?.coveredMessageCount).toBe(10_013);
    expect(summary?.coveredMessageIds.length).toBeLessThanOrEqual(512);
    expect(parseRollingSummary(summary)).toEqual(summary);
    expect(reconcileRollingSummaryForHistory(summary, longHistory, scope)).toEqual(summary);
  });

  it("projects a valid parent summary into an unchanged cloned branch", () => {
    const parentMessages = messages(["Old choice", "Old outcome", "Recent choice", "Recent outcome"]);
    const parent = advanceRollingSummary({
      previous: null,
      messages: parentMessages,
      scope,
      retainRecentMessages: 2,
      maxCharacters: 500,
      now: "2026-07-12T12:00:00.000Z",
    });
    const branchMessages = parentMessages.map((message, index) => ({ ...message, id: `branch-${index}` }));
    const branchScope = { cardId: scope.cardId, chatId: "chat-b", branchId: "chat-b" };

    const projected = branchRollingSummary(
      parent,
      parentMessages,
      branchMessages,
      branchScope,
      "2026-07-12T12:01:00.000Z",
    );

    expect(projected?.scope).toEqual(branchScope);
    expect(projected?.text).toBe(parent?.text);
    expect(projected?.coveredMessageIds).toEqual(["branch-0", "branch-1"]);

    branchMessages[0] = { ...branchMessages[0], content: "Edited covered choice" };
    expect(
      branchRollingSummary(parent, parentMessages, branchMessages, branchScope, "2026-07-12T12:01:00.000Z"),
    ).toBeNull();
  });
});
