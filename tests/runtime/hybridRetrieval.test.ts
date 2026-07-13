import { describe, expect, it } from "vitest";

import {
  buildLocalSemanticVector,
  retrieveScopedHybrid,
  type HybridRetrievalDocument,
  type HybridRetrievalScope,
} from "../../src/runtime/hybridRetrieval";

const activeScope: HybridRetrievalScope = {
  cardId: "card-active",
  chatId: "chat-active",
  branchId: "branch-active",
  allowedSources: ["memory", "lore", "rolling-summary"],
  allowedVisibilities: ["narrator", "player-visible"],
};

function document(
  id: string,
  text: string,
  overrides: Partial<HybridRetrievalDocument> = {},
): HybridRetrievalDocument {
  return {
    id,
    text,
    cardId: activeScope.cardId,
    chatId: activeScope.chatId,
    branchId: activeScope.branchId,
    source: "memory",
    visibility: "narrator",
    ...overrides,
  };
}

describe("scoped hybrid retrieval", () => {
  it("fails closed when source or visibility boundaries are missing", () => {
    const incompleteScope = {
      cardId: activeScope.cardId,
      chatId: activeScope.chatId,
      branchId: activeScope.branchId,
    } as HybridRetrievalScope;

    expect(() =>
      retrieveScopedHybrid({
        query: "harbor gate",
        documents: [document("allowed", "The harbor gate is locked.")],
        scope: incompleteScope,
        limit: 5,
      }),
    ).toThrow(/source|visibility|scope/i);
  });

  it("never retrieves across card, chat, branch, source, or visibility scope", () => {
    const documents: HybridRetrievalDocument[] = [
      document("allowed", "The silver cipher opens the harbor gate."),
      document("other-card", "The silver cipher opens the harbor gate.", {
        cardId: "card-other",
      }),
      document("other-chat", "The silver cipher opens the harbor gate.", {
        chatId: "chat-other",
      }),
      document("other-branch", "The silver cipher opens the harbor gate.", {
        branchId: "branch-other",
      }),
      document("blocked-source", "The silver cipher opens the harbor gate.", {
        source: "event",
      }),
      document("blocked-visibility", "The silver cipher opens the harbor gate.", {
        visibility: "character-private",
      }),
    ];

    const results = retrieveScopedHybrid({
      query: "silver cipher harbor gate",
      documents,
      scope: {
        ...activeScope,
        allowedSources: ["memory", "lore", "rolling-summary"],
        allowedVisibilities: ["narrator", "player-visible"],
      },
      limit: 10,
    });

    expect(results.map((result) => result.document.id)).toEqual(["allowed"]);
  });

  it("uses local semantic similarity when related text has no lexical overlap", () => {
    const results = retrieveScopedHybrid({
      query: "A doctor heals my injury.",
      documents: [
        document("semantic-match", "The physician tends the hero's wound."),
        document("unrelated", "A lantern burns beside the northern harbor."),
      ],
      scope: activeScope,
      limit: 2,
    });

    expect(results[0].document.id).toBe("semantic-match");
    expect(results[0].lexicalScore).toBe(0);
    expect(results[0].semanticScore).toBeGreaterThan(0);
    expect(results[0].semanticScore).toBeGreaterThan(results[1].semanticScore);
  });

  it("is deterministic and requires no provider or model adapter", () => {
    const text = "The physician tends the hero's wound.";
    const firstVector = buildLocalSemanticVector(text);
    const secondVector = buildLocalSemanticVector(text);
    const request = {
      query: "A doctor heals my injury.",
      documents: [document("semantic-match", text)],
      scope: activeScope,
      limit: 1,
    } as const;

    expect(firstVector).toEqual(secondVector);
    expect(firstVector.length).toBeGreaterThan(0);
    expect(firstVector.every(Number.isFinite)).toBe(true);
    expect(retrieveScopedHybrid(request)).toEqual(retrieveScopedHybrid(request));
  });

  it("returns no candidates for an empty query", () => {
    expect(
      retrieveScopedHybrid({
        query: "   ",
        documents: [document("memory", "A relevant memory")],
        scope: activeScope,
        limit: 5,
      }),
    ).toEqual([]);
  });

  it("honors persisted card-global, chat, and branch provenance", () => {
    const documents: HybridRetrievalDocument[] = [
      {
        id: "global",
        text: "The harbor gate is sealed.",
        cardId: activeScope.cardId,
        scopeLevel: "card-global",
        source: "lore",
        visibility: "narrator",
      },
      {
        id: "chat",
        text: "The harbor gate is sealed.",
        cardId: activeScope.cardId,
        chatId: activeScope.chatId,
        scopeLevel: "chat",
        source: "memory",
        visibility: "narrator",
      },
      {
        id: "wrong-branch",
        text: "The harbor gate is sealed.",
        cardId: activeScope.cardId,
        chatId: activeScope.chatId,
        branchId: "branch-other",
        scopeLevel: "branch",
        source: "memory",
        visibility: "narrator",
      },
    ];

    const results = retrieveScopedHybrid({
      query: "harbor gate",
      documents,
      scope: activeScope,
      limit: 10,
    });

    expect(results.map((result) => result.document.id)).toEqual(["global", "chat"]);
  });

  it("applies score, source-count, and character budgets instead of returning every candidate", () => {
    const results = retrieveScopedHybrid({
      query: "harbor gate",
      documents: [
        document("best-memory", "The harbor gate is sealed."),
        document("second-memory", "The harbor gate has a silver lock."),
        document("irrelevant", "A physician tends an injury."),
        document("lore", "The harbor gate belongs to Rook.", { source: "lore", priority: 100 }),
      ],
      scope: activeScope,
      limit: 10,
      minimumScore: 0.01,
      sourceLimits: { memory: 1, lore: 1 },
      maxCharacters: 80,
    });

    expect(results.map((result) => result.document.id)).toEqual(["lore", "best-memory"]);
    expect(results.reduce((total, result) => total + result.document.text.length, 0)).toBeLessThanOrEqual(80);
  });
});
