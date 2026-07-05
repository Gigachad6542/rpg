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
    expect(compact.promptRuns).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "run-139", compiledPrompt: "" })]),
    );
    expect(compact.chatSessions?.[0]).toMatchObject({
      id: "chat-card",
      messages: expect.arrayContaining([
        expect.objectContaining({ id: "session-message-119" }),
      ]),
    });
    expect(compact.chatSessions?.[0].messages).toHaveLength(50);
    expect(compact.generatedMaps).toHaveLength(20);
  });

  it("persists full compiled prompts only when prompt debug logs are enabled", () => {
    const writes: string[] = [];
    vi.spyOn(Storage.prototype, "setItem").mockImplementation((_key: string, value: string) => {
      writes.push(value);
    });

    saveLocalRuntimeSnapshot({
      ...createLargeSnapshot(),
      promptRuns: [
        {
          id: "run-private",
          cardId: "card_blank_slate_rpg",
          chatId: "chat-card",
          compiledPrompt: "full private compiled prompt",
        },
      ],
      runtimeSettings: {
        textStreaming: true,
        promptDebugLogs: false,
      },
    });
    saveLocalRuntimeSnapshot({
      ...createLargeSnapshot(),
      promptRuns: [
        {
          id: "run-debug",
          cardId: "card_blank_slate_rpg",
          chatId: "chat-card",
          compiledPrompt: "debug compiled prompt",
        },
      ],
      runtimeSettings: {
        promptDebugLogs: true,
      },
    });

    const withoutDebug = JSON.parse(writes[0]) as LocalRuntimeSnapshot<unknown, unknown, Record<string, unknown>>;
    const withDebug = JSON.parse(writes[1]) as LocalRuntimeSnapshot<unknown, unknown, Record<string, unknown>>;

    expect(withoutDebug.promptRuns[0].compiledPrompt).toBe("");
    expect(withDebug.promptRuns[0].compiledPrompt).toBe("debug compiled prompt");
  });

  it("keeps a larger generated media window with character portrait metadata", () => {
    const writes: string[] = [];
    vi.spyOn(Storage.prototype, "setItem").mockImplementation((_key: string, value: string) => {
      writes.push(value);
    });

    saveLocalRuntimeSnapshot({
      ...createLargeSnapshot(),
      generatedMaps: Array.from({ length: 90 }, (_, index) => ({
        id: `portrait-${index}`,
        imageKind: "character",
        cardId: "card_blank_slate_rpg",
        chatId: "chat-card",
        subjectId: `story_entity_${index}`,
        subjectName: `Character ${index}`,
        prompt: `Portrait prompt ${index}`,
        negativePrompt: "no text",
        provider: "prompt-only",
        model: "test-image-model",
        status: "prompt-only",
        createdAt: `2026-06-27T21:${String(index).padStart(2, "0")}:00.000Z`,
      })),
    });

    const snapshot = JSON.parse(writes[0]) as LocalRuntimeSnapshot<unknown, unknown, unknown>;
    expect(snapshot.generatedMaps).toHaveLength(80);
    expect(snapshot.generatedMaps?.[0]).toMatchObject({
      id: "portrait-10",
      subjectName: "Character 10",
    });
    expect(snapshot.generatedMaps?.[79]).toMatchObject({
      id: "portrait-89",
      subjectId: "story_entity_89",
      subjectName: "Character 89",
    });
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
