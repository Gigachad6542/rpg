import { describe, expect, it } from "vitest";

import {
  RUNTIME_EXPORT_SCHEMA_VERSION,
  parseVersionedRuntimeExport,
  type RuntimeExportBundle,
  type RuntimeExportSnapshot,
} from "../../src/app/runtimeDataBundle";
import {
  sanitizePersistedImageProviderSettings,
  sanitizePersistedProviderSettings,
} from "../../src/app/localRuntimeStore";

const MAX_RUNTIME_IMPORT_BYTES = 10 * 1024 * 1024;

describe("runtime import security boundaries", () => {
  it.each([
    ["card", (snapshot: RuntimeExportSnapshot) => {
      snapshot.cards[0].playerRules = "not-an-array";
    }],
    ["message", (snapshot: RuntimeExportSnapshot) => {
      snapshot.messages[0].role = "owner";
    }],
    ["chat session", (snapshot: RuntimeExportSnapshot) => {
      snapshot.chatSessions![0].messages = "not-an-array";
    }],
    ["prompt-run model call", (snapshot: RuntimeExportSnapshot) => {
      snapshot.promptRuns[0].modelCalls = [
        {
          phase: "hidden-continuity",
          provider: "mock",
          model: "mock-narrator",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          durationMs: -1,
          status: "success",
        },
      ];
    }],
  ])("rejects a malformed nested %s shape", (_label, corrupt) => {
    const bundle = createValidBundle();
    corrupt(bundle.snapshot);

    expect(() => parseVersionedRuntimeExport(JSON.stringify(bundle))).toThrow(/runtime export json is invalid/i);
  });

  it.each([
    ["card", (snapshot: RuntimeExportSnapshot) => {
      snapshot.cards.push({ ...snapshot.cards[0] });
    }],
    ["chat session", (snapshot: RuntimeExportSnapshot) => {
      snapshot.chatSessions!.push({ ...snapshot.chatSessions![0] });
    }],
    ["message within one chat", (snapshot: RuntimeExportSnapshot) => {
      const messages = snapshot.chatSessions![0].messages as Array<Record<string, unknown>>;
      messages.push({ ...messages[0] });
    }],
    ["prompt run", (snapshot: RuntimeExportSnapshot) => {
      snapshot.promptRuns.push({ ...snapshot.promptRuns[0] });
    }],
  ])("rejects a duplicate %s id", (_label, duplicate) => {
    const bundle = createValidBundle();
    duplicate(bundle.snapshot);

    expect(() => parseVersionedRuntimeExport(JSON.stringify(bundle))).toThrow(/duplicate.*id/i);
  });

  it("rejects runtime imports larger than the desktop 10 MB snapshot limit by UTF-8 byte length", () => {
    const bundle = createValidBundle();
    bundle.snapshot.cards[0].summary = "\u{1F600}".repeat(Math.ceil(MAX_RUNTIME_IMPORT_BYTES / 4) + 1);
    const rawJson = JSON.stringify(bundle);

    expect(new TextEncoder().encode(rawJson).byteLength).toBeGreaterThan(MAX_RUNTIME_IMPORT_BYTES);
    expect(() => parseVersionedRuntimeExport(rawJson)).toThrow(/10 mb|limit|too large/i);
  });

  it.each([
    ["cards", 501, (snapshot: RuntimeExportSnapshot, count: number) => {
      snapshot.cards = Array.from({ length: count }, (_, index) => createValidCard(`card_${index}`));
      snapshot.activeCardId = "card_0";
    }],
    ["chat sessions", 1_001, (snapshot: RuntimeExportSnapshot, count: number) => {
      snapshot.chatSessions = Array.from({ length: count }, (_, index) => createValidChat(`chat_${index}`, "card_test", []));
      snapshot.activeChatIds = { card_test: "chat_0" };
    }],
    ["messages", 10_001, (snapshot: RuntimeExportSnapshot, count: number) => {
      const messages = Array.from({ length: count }, (_, index) => createValidMessage(`message_${index}`));
      snapshot.messages = messages;
      snapshot.chatSessions = [createValidChat("chat_test", "card_test", messages)];
    }],
    ["prompt runs", 5_001, (snapshot: RuntimeExportSnapshot, count: number) => {
      snapshot.promptRuns = Array.from({ length: count }, (_, index) => createValidPromptRun(`run_${index}`));
    }],
    ["generated maps", 101, (snapshot: RuntimeExportSnapshot, count: number) => {
      snapshot.generatedMaps = Array.from({ length: count }, (_, index) => createValidGeneratedMap(`map_${index}`));
    }],
  ])("rejects imports above the %s persistence count limit", (_label, count, expand) => {
    const bundle = createValidBundle();
    expand(bundle.snapshot, count);

    expect(() => parseVersionedRuntimeExport(JSON.stringify(bundle))).toThrow(/limit|too many/i);
  });

  it("strips imported generated image URLs before the snapshot can be rendered", () => {
    const bundle = createValidBundle();
    bundle.snapshot.generatedMaps = [
      {
        ...createValidGeneratedMap("map_loopback"),
        imageUrl: "http://127.0.0.1:8188/view?filename=private.png&type=output",
      },
    ];

    const imported = parseVersionedRuntimeExport(JSON.stringify(bundle));

    expect(imported.generatedMaps).toEqual([
      expect.not.objectContaining({ imageUrl: expect.anything() }),
    ]);
  });

  it("does not persist provider URL userinfo credentials", () => {
    const sanitized = sanitizePersistedProviderSettings({
      mode: "openai-compatible",
      providerId: "local",
      displayName: "Local endpoint",
      baseUrl: "http://provider-user:provider-password@127.0.0.1:1234/v1",
      model: "local-model",
      secretReference: {
        providerId: "local",
        secretName: "apiKey",
        storageKind: "os-keychain",
        storageKey: "local:apiKey",
        providerBaseUrl: "http://reference-user:reference-password@127.0.0.1:1234/v1",
      },
    });
    const serialized = JSON.stringify(sanitized);

    expect(serialized).not.toContain("provider-user");
    expect(serialized).not.toContain("provider-password");
    expect(serialized).not.toContain("reference-user");
    expect(serialized).not.toContain("reference-password");
  });

  it("does not persist ComfyUI endpoint userinfo credentials", () => {
    const sanitized = sanitizePersistedImageProviderSettings({
      mode: "comfyui",
      providerId: "comfyui",
      endpoint: "http://comfy-user:comfy-password@127.0.0.1:8188",
      model: "local-model.safetensors",
    });
    const serialized = JSON.stringify(sanitized);

    expect(serialized).not.toContain("comfy-user");
    expect(serialized).not.toContain("comfy-password");
  });
});

function createValidBundle(): RuntimeExportBundle {
  return {
    schema: "rpg.runtime.export",
    version: RUNTIME_EXPORT_SCHEMA_VERSION,
    exportedAt: "2026-07-12T20:00:00.000Z",
    app: {
      name: "rpg",
      exportFormat: "runtime-bundle",
    },
    snapshot: {
      version: 2,
      theme: "dark",
      activeCardId: "card_test",
      cards: [createValidCard("card_test")],
      messages: [createValidMessage("message_user", "user"), createValidMessage("message_assistant", "assistant")],
      chatSessions: [
        createValidChat("chat_test", "card_test", [
          createValidMessage("message_user", "user"),
          createValidMessage("message_assistant", "assistant"),
        ]),
      ],
      activeChatIds: { card_test: "chat_test" },
      promptRuns: [createValidPromptRun("run_test")],
      providerKeyStatus: "No plaintext keys stored.",
      providerSettings: {
        mode: "mock",
        providerId: "mock",
        displayName: "Mock local runtime",
        baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        model: "mock-narrator",
      },
      imageProviderSettings: {
        mode: "prompt-only",
        portraitGenerationMode: "confirm-first",
        providerId: "comfyui",
        displayName: "ComfyUI local API",
        endpoint: "http://127.0.0.1:8188",
        model: "local-model.safetensors",
        width: 1024,
        height: 1024,
        seed: -1,
        steps: 30,
        cfg: 4,
        samplerName: "euler_ancestral",
        scheduler: "simple",
        pollTimeoutMs: 120_000,
      },
      runtimeSettings: {
        textStreaming: true,
        banEmojis: false,
        promptDebugLogs: false,
        diceRollsEnabled: true,
        onboardingCompleted: true,
        accentColor: "#8b5cf6",
      },
      personas: [],
      generatedMaps: [createValidGeneratedMap("map_test")],
      savedAt: "2026-07-12T19:59:00.000Z",
    },
  };
}

function createValidCard(id: string): Record<string, unknown> {
  return {
    id,
    name: `Card ${id}`,
    kind: "rpg",
    summary: "A valid RPG card.",
    characterName: "",
    characterDescription: "",
    scenario: "A test scenario.",
    greeting: "Welcome.",
    exampleDialogs: "",
    systemPrompt: "Run the RPG faithfully.",
    preHistoryInstructions: "",
    postHistoryInstructions: "",
    playerRules: [
      {
        id: `rule_${id}`,
        title: "Honor state",
        description: "Use validated state.",
        enabled: true,
        enforcement: "validated_state",
      },
    ],
    lorebooks: [
      {
        id: `lore_${id}`,
        name: "World lore",
        enabled: true,
        scanDepth: 4,
        tokenBudget: 512,
        recursiveScanning: false,
        entries: [
          {
            id: `entry_${id}`,
            title: "Starting area",
            keys: ["start"],
            secondaryKeys: [],
            content: "The story starts here.",
            insertionOrder: 100,
            priority: 0,
            enabled: true,
            constant: false,
            probability: 100,
            caseSensitive: false,
            wholeWord: false,
            matchMode: "literal",
            scanScopes: ["latest-user-message"],
          },
        ],
      },
    ],
    memory: [{ id: `memory_${id}`, label: "Fact", detail: "A remembered fact." }],
    storyEntities: [
      {
        id: `entity_${id}`,
        name: "Player Character",
        kind: "player",
        summary: "The player.",
        knownFacts: [],
        doesNotKnow: [],
        notes: [],
      },
    ],
    mapEnabled: true,
    rpg: {
      location: "Starting area",
      health: "10/10",
      inventory: [],
      quests: [],
      flags: {},
      knownPlaces: ["Starting area"],
      mapStyle: "readable map",
    },
  };
}

function createValidMessage(id: string, role: "user" | "assistant" = "assistant"): Record<string, unknown> {
  return {
    id,
    role,
    content: role === "user" ? "I look around." : "You see the starting area.",
  };
}

function createValidChat(
  id: string,
  cardId: string,
  messages: Array<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    id,
    cardId,
    title: `Chat ${id}`,
    createdAt: "2026-07-12T19:58:00.000Z",
    updatedAt: "2026-07-12T19:59:00.000Z",
    messages,
  };
}

function createValidPromptRun(id: string): Record<string, unknown> {
  return {
    id,
    cardId: "card_test",
    chatId: "chat_test",
    compiledPrompt: "",
    response: "You see the starting area.",
    provider: "mock",
    model: "mock-narrator",
    tokenEstimate: 24,
    includedLayerIds: ["latest-user-message"],
    includedLoreEntryIds: ["entry_card_test"],
    warnings: [],
    stateChanges: [],
  };
}

function createValidGeneratedMap(id: string): Record<string, unknown> {
  return {
    id,
    imageKind: "map",
    cardId: "card_test",
    chatId: "chat_test",
    prompt: "A map of the starting area.",
    negativePrompt: "",
    provider: "prompt-only",
    model: "local-model.safetensors",
    status: "prompt-only",
    createdAt: "2026-07-12T19:59:00.000Z",
  };
}
