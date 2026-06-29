import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RUNTIME_STORAGE_KEY,
  saveLocalRuntimeSnapshot,
  type LocalRuntimeSnapshot,
} from "../../src/app/localRuntimeStore";

describe("local runtime store", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("retries with a compact snapshot when localStorage rejects the full payload", () => {
    const writes: string[] = [];
    let callCount = 0;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation((key: string, value: string) => {
      expect(key).toBe(RUNTIME_STORAGE_KEY);
      callCount += 1;
      if (callCount === 1) {
        throw new DOMException("Storage quota exceeded", "QuotaExceededError");
      }
      writes.push(value);
    });

    expect(() => saveLocalRuntimeSnapshot(createLargeSnapshot())).not.toThrow();
    expect(writes).toHaveLength(1);
    const compact = JSON.parse(writes[0]) as LocalRuntimeSnapshot<
      unknown,
      unknown,
      unknown,
      { messages: unknown[] }
    >;

    expect(compact.messages).toHaveLength(100);
    expect(compact.promptRuns).toHaveLength(100);
    expect(compact.chatSessions?.[0]).toMatchObject({
      id: "chat-card",
      messages: expect.arrayContaining([
        expect.objectContaining({ id: "session-message-119" }),
      ]),
    });
    expect(compact.chatSessions?.[0].messages).toHaveLength(50);
    expect(compact.generatedMaps).toHaveLength(5);
  });
});

function createLargeSnapshot(): LocalRuntimeSnapshot<
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, unknown> & { messages: Record<string, unknown>[] }
> {
  return {
    version: 2,
    theme: "dark",
    activeCardId: "card_blank_slate_rpg",
    cards: [
      {
        id: "card_blank_slate_rpg",
        name: "Blank Slate RPG",
        kind: "rpg",
      },
    ],
    messages: Array.from({ length: 140 }, (_, index) => ({
      id: `message-${index}`,
      role: "assistant",
      content: `Message ${index}`,
    })),
    chatSessions: [
      {
        id: "chat-card",
        cardId: "card_blank_slate_rpg",
        title: "Card chat",
        messages: Array.from({ length: 120 }, (_, index) => ({
          id: `session-message-${index}`,
          role: "assistant",
          content: `Session message ${index}`,
        })),
      },
    ],
    activeChatIds: {
      card_blank_slate_rpg: "chat-card",
    },
    promptRuns: Array.from({ length: 140 }, (_, index) => ({
      id: `run-${index}`,
      cardId: "card_blank_slate_rpg",
      chatId: "chat-card",
      compiledPrompt: `Prompt ${index}`,
      response: `Response ${index}`,
      provider: "mock",
      model: "mock",
      tokenEstimate: index,
      includedLayerIds: [],
      includedLoreEntryIds: [],
      warnings: [],
      stateChanges: [],
    })),
    providerKeyStatus: "No plaintext keys stored.",
    generatedMaps: Array.from({ length: 30 }, (_, index) => ({
      id: `map-${index}`,
      cardId: "card_blank_slate_rpg",
      chatId: "chat-card",
      prompt: `Map prompt ${index}`,
      status: "prompt_ready",
      createdAt: `2026-06-27T20:${String(index).padStart(2, "0")}:00.000Z`,
    })),
    savedAt: "2026-06-27T20:00:00.000Z",
  };
}
