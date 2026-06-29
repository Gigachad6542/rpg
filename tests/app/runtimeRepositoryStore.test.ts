import { describe, expect, it } from "vitest";

import {
  RUNTIME_BRANCH_ID,
  RUNTIME_CHAT_ID,
  RUNTIME_SNAPSHOT_CHARACTER_ID,
  RuntimeRepositoryStore,
  type RepositoryRuntimeSnapshot,
} from "../../src/app/runtimeRepositoryStore";
import { createInMemorySqlDriver } from "../../src/db/inMemoryDriver";
import { runMigrations } from "../../src/db/migrations";
import { ChatRepository } from "../../src/db/repositories/chats";
import { ImagePromptRunRepository } from "../../src/db/repositories/imagePromptRuns";
import { LorebookEntryRepository, LorebookRepository } from "../../src/db/repositories/lorebooks";
import { MemoryEntryRepository } from "../../src/db/repositories/memoryEntries";
import { ModelProviderConfigRepository } from "../../src/db/repositories/modelProviderConfigs";
import { MessageRepository } from "../../src/db/repositories/messages";
import { PromptRunRepository } from "../../src/db/repositories/promptRuns";
import { RpgStateSnapshotRepository } from "../../src/db/repositories/rpgStateSnapshots";
import { sqliteMigrations } from "../../src/db/schema";

describe("runtime repository store", () => {
  it("routes desktop persistence through typed Tauri repository commands", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const invokeImpl = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
      calls.push({ command, args });
      if (command === "initialize_runtime_repository") {
        return {
          backend: "tauri-sqlite",
          schemaVersion: 1,
          migrations: [{ version: 1, name: "initial_core_schema", status: "skipped" }],
        } as T;
      }
      if (command === "load_runtime_snapshot") {
        return { snapshot: null } as T;
      }
      if (command === "save_runtime_snapshot") {
        return { saved: true } as T;
      }
      throw new Error(`unexpected command ${command}`);
    };

    const restoreTauri = setTauriRuntimeForTest();
    try {
      const store = await RuntimeRepositoryStore.create({ invokeImpl } as never);
      await expect(store.loadSnapshot()).resolves.toBeNull();
      await expect(store.saveSnapshot(createMinimalSnapshot())).resolves.toBeUndefined();

      expect(store.getStatus()).toEqual({ backend: "tauri-sqlite" });
      expect(calls.map((call) => call.command)).toEqual([
        "initialize_runtime_repository",
        "load_runtime_snapshot",
        "save_runtime_snapshot",
      ]);
      expect(JSON.stringify(calls)).not.toContain("SELECT");
      expect(JSON.stringify(calls)).not.toContain("DELETE FROM");
    } finally {
      restoreTauri();
    }
  });

  it("saves and loads the runtime snapshot through existing repositories", async () => {
    const driver = createInMemorySqlDriver();
    await runMigrations(driver, sqliteMigrations);
    const store = await RuntimeRepositoryStore.create({ driver });
    const snapshot: RepositoryRuntimeSnapshot = {
      version: 2,
      theme: "dark",
      activeCardId: "card_blank_slate_rpg",
      cards: [
        {
          id: "card_blank_slate_rpg",
          name: "Blank Slate RPG",
          kind: "rpg",
          summary: "Runtime card",
          systemPrompt: "Run the card.",
          preHistoryInstructions: "",
          postHistoryInstructions: "",
          playerRules: [],
          memory: [
            {
              id: "memory-1",
              label: "Recent validated turn",
              detail: "The player inspected the gate.",
            },
          ],
          lorebooks: [
            {
              id: "lore-1",
              name: "Gate Lore",
              enabled: true,
              scanDepth: 4,
              tokenBudget: 800,
              recursiveScanning: false,
              entries: [
                {
                  id: "lore-gate",
                  title: "Ancient Gate",
                  keys: ["gate"],
                  secondaryKeys: [],
                  content: "The gate opens to a remembered oath.",
                  insertionOrder: 100,
                  priority: 4,
                  enabled: true,
                  constant: false,
                  probability: 100,
                  caseSensitive: false,
                  wholeWord: false,
                },
              ],
            },
          ],
          rpg: {
            location: "Cellar",
            health: "10/10",
            inventory: ["brass key"],
            quests: [],
            flags: { gate_seen: true },
            knownPlaces: ["Cellar"],
            mapStyle: "birdseye map",
          },
        },
      ],
      messages: [
        {
          id: "system-1",
          role: "system",
          content: "Runtime ready.",
        },
        {
          id: "assistant-run_001",
          role: "assistant",
          content: "The action is validated.",
        },
      ],
      promptRuns: [
        {
          id: "run_001",
          cardId: "card_blank_slate_rpg",
          chatId: "chat_local_cards_runtime",
          compiledPrompt: "## Prompt",
          response: "The action is validated.",
          provider: "mock",
          model: "mock-narrator",
          tokenEstimate: 42,
          includedLayerIds: ["global-runtime-rules", "latest-user-message"],
          includedLoreEntryIds: ["lore-gate"],
          warnings: [],
          stateChanges: ["Location -> Cellar"],
          usage: {
            inputTokens: 20,
            outputTokens: 8,
            totalTokens: 28,
          },
        },
      ],
      providerKeyStatus: "Mock provider active; no API key needed.",
      providerSettings: {
        mode: "openai-compatible",
        providerId: "openrouter",
        displayName: "OpenRouter BYOK",
        baseUrl: "https://openrouter.ai/api/v1",
        model: "qwen3.7-max",
        apiKey: "sk-should-not-persist",
        token: "raw-token",
        secretReference: {
          providerId: "openrouter",
          secretName: "apiKey",
          storageKind: "os-keychain",
          storageKey: "openrouter:apiKey",
          providerBaseUrl: "https://openrouter.ai/api/v1",
        },
      },
      imageProviderSettings: {
        mode: "comfyui",
        providerId: "comfyui",
        displayName: "ComfyUI local API",
        endpoint: "http://127.0.0.1:8188",
        model: "FLUX.1-schnell",
        workflowJson: "{}",
        width: 1024,
        height: 1024,
        pollTimeoutMs: 120000,
      },
      generatedMaps: [
        {
          id: "map-1",
          cardId: "card_blank_slate_rpg",
          prompt: "Birdseye map of the cellar",
          negativePrompt: "first-person view",
          provider: "comfyui",
          model: "FLUX.1-schnell",
          status: "generated",
          imageUrl: "http://127.0.0.1:8188/view?filename=map.png&type=output&subfolder=",
          createdAt: "2026-06-27T20:00:01.000Z",
        },
      ],
      savedAt: "2026-06-27T20:00:00.000Z",
    };

    await store.saveSnapshot(snapshot);

    const loaded = await store.loadSnapshot();
    expect(loaded).toMatchObject({
      activeCardId: "card_blank_slate_rpg",
      providerSettings: {
        mode: "openai-compatible",
        model: "qwen3.7-max",
        secretReference: {
          storageKey: "openrouter:apiKey",
          providerBaseUrl: "https://openrouter.ai/api/v1",
        },
      },
    });
    expect(JSON.stringify(loaded?.providerSettings)).not.toContain("sk-should-not-persist");
    expect(JSON.stringify(loaded?.providerSettings)).not.toContain("raw-token");
    expect(loaded?.messages).toHaveLength(2);
    expect(loaded?.promptRuns[0]).toMatchObject({
      id: "run_001",
      includedLoreEntryIds: ["lore-gate"],
      stateChanges: ["Location -> Cellar"],
      usage: {
        totalTokens: 28,
      },
    });

    await expect(new ChatRepository(driver).getActiveBranch(RUNTIME_CHAT_ID)).resolves.toMatchObject({
      id: RUNTIME_BRANCH_ID,
      isActive: true,
    });
    await expect(new ModelProviderConfigRepository(driver).getById("provider_openrouter")).resolves.toMatchObject({
      providerId: "openrouter",
      defaultModelId: "qwen3.7-max",
      secretRef: expect.stringContaining("openrouter:apiKey"),
      nonSecretSettings: expect.not.objectContaining({
        apiKey: expect.any(String),
      }),
    });
    await expect(new MemoryEntryRepository(driver).listByChat(RUNTIME_CHAT_ID)).resolves.toMatchObject([
      {
        id: "memory-1",
        relatedCharacterIds: ["card_blank_slate_rpg"],
        text: "The player inspected the gate.",
      },
    ]);
    await expect(new LorebookEntryRepository(driver).listByLorebook("lore-1")).resolves.toMatchObject([
      {
        id: "lore-gate",
        triggers: expect.objectContaining({
          keys: ["gate"],
          priority: 4,
        }),
      },
    ]);
    await expect(new RpgStateSnapshotRepository(driver).getById("state_card_blank_slate_rpg")).resolves.toMatchObject({
      payload: expect.objectContaining({
        location: "Cellar",
      }),
    });
    await expect(new ImagePromptRunRepository(driver).getById("map-1")).resolves.toMatchObject({
      provider: "comfyui",
      compiledPrompt: "Birdseye map of the cellar",
    });

    await store.saveSnapshot({
      ...snapshot,
      activeCardId: "card_survivor",
      cards: [
        {
          id: "card_survivor",
          name: "Survivor",
          kind: "character",
          summary: "Remaining card",
          systemPrompt: "",
          preHistoryInstructions: "",
          postHistoryInstructions: "",
          playerRules: [],
          memory: [],
          lorebooks: [],
        },
      ],
      messages: [],
      chatSessions: [
        {
          id: "chat-survivor",
          cardId: "card_survivor",
          title: "Survivor chat",
          createdAt: "2026-06-27T20:01:00.000Z",
          updatedAt: "2026-06-27T20:01:00.000Z",
          messages: [],
        },
      ],
      activeChatIds: {
        card_survivor: "chat-survivor",
      },
      promptRuns: [],
      generatedMaps: [],
      savedAt: "2026-06-27T20:01:00.000Z",
    });

    await expect(new MessageRepository(driver).listByBranch(RUNTIME_CHAT_ID, RUNTIME_BRANCH_ID)).resolves.toHaveLength(0);
    await expect(new PromptRunRepository(driver).listByChat(RUNTIME_CHAT_ID)).resolves.toHaveLength(0);
    await expect(new ImagePromptRunRepository(driver).getById("map-1")).resolves.toBeNull();
    await expect(new LorebookEntryRepository(driver).listByLorebook("lore-1")).resolves.toHaveLength(0);
    await expect(new LorebookRepository(driver).getById("lore-1")).resolves.toBeNull();
    await expect(new RpgStateSnapshotRepository(driver).getById("state_card_blank_slate_rpg")).resolves.toBeNull();
    await expect(new MemoryEntryRepository(driver).listByChat(RUNTIME_CHAT_ID)).resolves.toHaveLength(0);
  });

  it("prunes RPG state rows when an RPG card no longer has RPG state", async () => {
    const driver = createInMemorySqlDriver();
    await runMigrations(driver, sqliteMigrations);
    const store = await RuntimeRepositoryStore.create({ driver });
    const snapshot = createMinimalSnapshot();
    snapshot.cards = [
      {
        id: "card_blank_slate_rpg",
        name: "Blank Slate RPG",
        kind: "rpg",
        rpg: {
          location: "Cellar",
          health: "10/10",
          inventory: ["brass key"],
          quests: [],
          flags: {},
          knownPlaces: ["Cellar"],
          mapStyle: "birdseye map",
        },
      },
    ];

    await store.saveSnapshot(snapshot);
    await expect(new RpgStateSnapshotRepository(driver).getById("state_card_blank_slate_rpg")).resolves.toMatchObject({
      payload: expect.objectContaining({ location: "Cellar" }),
    });

    await store.saveSnapshot({
      ...snapshot,
      cards: [
        {
          id: "card_blank_slate_rpg",
          name: "Blank Slate RPG",
          kind: "rpg",
        },
      ],
      savedAt: "2026-06-28T00:01:00.000Z",
    });

    await expect(new RpgStateSnapshotRepository(driver).getById("state_card_blank_slate_rpg")).resolves.toBeNull();
    const loaded = await store.loadSnapshot();
    expect(loaded?.cards[0]).not.toHaveProperty("rpg");
  });

  it("loads normalized runtime rows instead of stale compatibility snapshot arrays", async () => {
    const driver = createInMemorySqlDriver();
    await runMigrations(driver, sqliteMigrations);
    const store = await RuntimeRepositoryStore.create({ driver });
    const snapshot = createFullSnapshot();

    await store.saveSnapshot(snapshot);
    await driver.execute("UPDATE characters SET profile_json = $1 WHERE id = $2", [
      JSON.stringify({
        snapshot: {
          ...snapshot,
          cards: [
            {
              ...snapshot.cards[0],
              memory: [
                {
                  id: "stale-memory",
                  label: "Stale",
                  detail: "This stale memory should not load.",
                },
              ],
              lorebooks: [],
              rpg: {
                location: "Wrong room",
              },
            },
          ],
          messages: [
            {
              id: "stale-message",
              role: "assistant",
              content: "This stale message should not load.",
            },
          ],
          chatSessions: [
            {
              id: "chat-card",
              cardId: "card_blank_slate_rpg",
              title: "Card chat",
              messages: [
                {
                  id: "stale-session-message",
                  role: "assistant",
                  content: "This stale session message should not load.",
                },
              ],
            },
          ],
          promptRuns: [
            {
              id: "stale-run",
              cardId: "card_blank_slate_rpg",
              chatId: "chat-card",
              compiledPrompt: "stale",
              response: "stale",
              provider: "mock",
              model: "mock-narrator",
              tokenEstimate: 1,
              includedLayerIds: [],
              includedLoreEntryIds: [],
              warnings: [],
              stateChanges: [],
            },
          ],
          generatedMaps: [
            {
              id: "stale-map",
              cardId: "card_blank_slate_rpg",
              chatId: "chat-card",
              prompt: "stale map",
              status: "prompt_ready",
              createdAt: "2026-06-27T20:01:00.000Z",
            },
          ],
        },
      }),
      RUNTIME_SNAPSHOT_CHARACTER_ID,
    ]);

    const loaded = await store.loadSnapshot();

    expect(loaded?.cards[0].memory).toEqual([
      {
        id: "memory-1",
        label: "Recent validated turn",
        detail: "The player inspected the gate.",
      },
    ]);
    expect(loaded?.cards[0].lorebooks).toMatchObject([
      {
        id: "lore-1",
        entries: [
          {
            id: "lore-gate",
            content: "The gate opens to a remembered oath.",
          },
        ],
      },
    ]);
    expect(loaded?.cards[0].rpg).toMatchObject({ location: "Cellar" });
    expect(loaded?.messages.map((message) => message.id)).toEqual(["system-1", "assistant-run_001"]);
    expect(loaded?.chatSessions?.[0].messages.map((message) => message.id)).toEqual([
      "system-1",
      "assistant-run_001",
    ]);
    expect(loaded?.promptRuns.map((run) => run.id)).toEqual(["run_001"]);
    expect(loaded?.generatedMaps).toMatchObject([
      {
        id: "map-1",
        chatId: "chat-card",
        prompt: "Birdseye map of the cellar",
        imageUrl: "http://127.0.0.1:8188/view?filename=map.png&type=output&subfolder=",
      },
    ]);
  });
});

function createMinimalSnapshot(): RepositoryRuntimeSnapshot {
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
    messages: [],
    promptRuns: [],
    providerKeyStatus: "No plaintext keys stored.",
    savedAt: "2026-06-28T00:00:00.000Z",
  };
}

function createFullSnapshot(): RepositoryRuntimeSnapshot {
  return {
    version: 2,
    theme: "dark",
    activeCardId: "card_blank_slate_rpg",
    cards: [
      {
        id: "card_blank_slate_rpg",
        name: "Blank Slate RPG",
        kind: "rpg",
        memory: [
          {
            id: "memory-1",
            label: "Recent validated turn",
            detail: "The player inspected the gate.",
          },
        ],
        lorebooks: [
          {
            id: "lore-1",
            name: "Gate Lore",
            enabled: true,
            scanDepth: 4,
            tokenBudget: 800,
            recursiveScanning: false,
            entries: [
              {
                id: "lore-gate",
                title: "Ancient Gate",
                keys: ["gate"],
                secondaryKeys: [],
                content: "The gate opens to a remembered oath.",
                insertionOrder: 100,
                priority: 4,
                enabled: true,
                constant: false,
                probability: 100,
                caseSensitive: false,
                wholeWord: false,
              },
            ],
          },
        ],
        rpg: {
          location: "Cellar",
          health: "10/10",
          inventory: ["brass key"],
          quests: [],
          flags: { gate_seen: true },
          knownPlaces: ["Cellar"],
          mapStyle: "birdseye map",
        },
      },
    ],
    messages: [
      {
        id: "system-1",
        role: "system",
        content: "Runtime ready.",
      },
      {
        id: "assistant-run_001",
        role: "assistant",
        content: "The action is validated.",
      },
    ],
    chatSessions: [
      {
        id: "chat-card",
        cardId: "card_blank_slate_rpg",
        title: "Card chat",
        messages: [
          {
            id: "system-1",
            role: "system",
            content: "Runtime ready.",
          },
          {
            id: "assistant-run_001",
            role: "assistant",
            content: "The action is validated.",
          },
        ],
      },
    ],
    activeChatIds: {
      card_blank_slate_rpg: "chat-card",
    },
    promptRuns: [
      {
        id: "run_001",
        cardId: "card_blank_slate_rpg",
        chatId: "chat-card",
        compiledPrompt: "## Prompt",
        response: "The action is validated.",
        provider: "mock",
        model: "mock-narrator",
        tokenEstimate: 42,
        includedLayerIds: ["global-runtime-rules", "latest-user-message"],
        includedLoreEntryIds: ["lore-gate"],
        warnings: [],
        stateChanges: ["Location -> Cellar"],
        usage: {
          inputTokens: 20,
          outputTokens: 8,
          totalTokens: 28,
        },
      },
    ],
    providerKeyStatus: "Mock provider active; no API key needed.",
    generatedMaps: [
      {
        id: "map-1",
        cardId: "card_blank_slate_rpg",
        chatId: "chat-card",
        prompt: "Birdseye map of the cellar",
        negativePrompt: "first-person view",
        provider: "comfyui",
        model: "FLUX.1-schnell",
        status: "generated",
        imageUrl: "http://127.0.0.1:8188/view?filename=map.png&type=output&subfolder=",
        createdAt: "2026-06-27T20:00:01.000Z",
      },
    ],
    savedAt: "2026-06-27T20:00:00.000Z",
  };
}

function setTauriRuntimeForTest(): () => void {
  const previousDescriptor = Object.getOwnPropertyDescriptor(window, "__TAURI_INTERNALS__");
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    value: {},
    configurable: true,
  });

  return () => {
    if (previousDescriptor) {
      Object.defineProperty(window, "__TAURI_INTERNALS__", previousDescriptor);
    } else {
      delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    }
  };
}
