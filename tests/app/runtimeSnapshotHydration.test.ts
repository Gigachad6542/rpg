import { describe, expect, it } from "vitest";

import { initialCards, starterMessages } from "../../src/app/appDefaults";
import { resolveRuntimeSnapshotState } from "../../src/app/runtimeSnapshotHydration";

describe("runtimeSnapshotHydration", () => {
  it("builds a safe first-run state from explicit fallbacks", () => {
    const state = resolveRuntimeSnapshotState(null, {
      fallbackCards: initialCards,
      fallbackMessages: starterMessages,
    });

    expect(state.theme).toBe("dark");
    expect(state.activeCardId).toBe("");
    expect(state.cards).toHaveLength(initialCards.length);
    expect(state.chatSessions.length).toBeGreaterThan(0);
    expect(state.providerSettings.mode).toBe("mock");
    expect(state.runtimeSettings.onboardingCompleted).toBe(false);
  });

  it("normalizes repository state and derives the active card from its chat lineage", () => {
    const card = {
      ...initialCards[0],
      id: "card-hydration",
      name: "Hydration Card",
      memory: [],
    };
    const snapshot = {
      theme: "light",
      activeCardId: card.id,
      cards: [card],
      messages: [],
      chatSessions: [
        {
          id: "chat-hydration",
          cardId: card.id,
          title: "Hydrated branch",
          createdAt: "2026-07-14T00:00:00.000Z",
          updatedAt: "2026-07-14T00:00:00.000Z",
          messages: [],
        },
      ],
      activeChatIds: { [card.id]: "chat-hydration" },
      promptRuns: [{
        id: "run-hydration",
        cardId: card.id,
        chatId: "chat-hydration",
        compiledPrompt: "must not survive with debug disabled",
        response: "ok",
        provider: "mock",
        model: "mock-narrator",
        tokenEstimate: 1,
        includedLayerIds: [],
        includedLoreEntryIds: [],
        warnings: [],
        stateChanges: [],
      }],
      providerKeyStatus: "safe reference only",
      providerSettings: { mode: "mock", providerId: "mock" },
      runtimeSettings: { promptDebugLogs: false },
      generatedMaps: [],
    };

    const state = resolveRuntimeSnapshotState(snapshot, {
      fallbackCards: initialCards,
      fallbackMessages: starterMessages,
    });

    expect(state.theme).toBe("light");
    expect(state.activeCardId).toBe(card.id);
    expect(state.activeChatIds[card.id]).toBe("chat-hydration");
    expect(state.cards[0]?.name).toBe("Hydration Card");
    expect(state.promptRuns[0]?.compiledPrompt).toBe("");
    expect(state.providerKeyStatus).toBe("safe reference only");
  });
});
