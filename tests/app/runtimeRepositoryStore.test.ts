import { describe, expect, it } from "vitest";

import {
  RUNTIME_BRANCH_ID,
  RUNTIME_CHAT_ID,
  RUNTIME_SNAPSHOT_CHARACTER_ID,
  RuntimeRepositoryStore,
  type RepositoryRuntimeSnapshot,
} from "../../src/app/runtimeRepositoryStore";
import { createInMemorySqlDriver, type InMemorySqlDriver } from "../../src/db/inMemoryDriver";
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
      const snapshot = createMinimalSnapshot();
      snapshot.promptRuns = [
        {
          id: "run_tauri",
          cardId: "card_blank_slate_rpg",
          chatId: "chat_local_cards_runtime",
          compiledPrompt: "tauri private compiled prompt",
          response: "The action is validated.",
          provider: "mock",
          model: "mock-narrator",
          tokenEstimate: 7,
          includedLayerIds: [],
          includedLoreEntryIds: [],
          warnings: [],
          stateChanges: [],
        },
      ];
      snapshot.imageProviderSettings = {
        mode: "comfyui",
        providerId: "comfyui",
        endpoint: "http://127.0.0.1:8188",
        model: "FLUX.1-schnell",
        workflowJson: JSON.stringify({ "1": { inputs: { apiKey: "workflow-secret" } } }),
        apiKey: "sk-tauri-image-secret",
        token: "raw-token-value",
        ignored: true,
      };
      await expect(store.loadSnapshot()).resolves.toBeNull();
      await expect(store.saveSnapshot(snapshot)).resolves.toBeUndefined();

      expect(store.getStatus()).toEqual({ backend: "tauri-sqlite" });
      expect(calls.map((call) => call.command)).toEqual([
        "initialize_runtime_repository",
        "load_runtime_snapshot",
        "save_runtime_snapshot",
      ]);
      expect((calls[2].args?.snapshot as RepositoryRuntimeSnapshot).promptRuns[0].compiledPrompt).toBe("");
      expect((calls[2].args?.snapshot as RepositoryRuntimeSnapshot).imageProviderSettings).toMatchObject({
        mode: "comfyui",
        providerId: "comfyui",
        endpoint: "http://127.0.0.1:8188",
        model: "FLUX.1-schnell",
      });
      expect(JSON.stringify((calls[2].args?.snapshot as RepositoryRuntimeSnapshot).imageProviderSettings)).not.toContain(
        "workflowJson",
      );
      expect(JSON.stringify(calls[2].args?.snapshot)).not.toContain("sk-tauri-image-secret");
      expect(JSON.stringify(calls[2].args?.snapshot)).not.toContain("raw-token-value");
      expect(JSON.stringify(calls)).not.toContain("SELECT");
      expect(JSON.stringify(calls)).not.toContain("DELETE FROM");
    } finally {
      restoreTauri();
    }
  });

  it("drops fabricated or secret-bearing model-call telemetry loaded from the desktop repository", async () => {
    const snapshot = createMinimalSnapshot();
    snapshot.promptRuns = [{
      ...createPromptRun("run_tampered", undefined),
      modelCalls: [{
        phase: "visible-response",
        provider: "openrouter",
        model: "priced-model",
        usage: { inputTokens: 1_000, outputTokens: 500, totalTokens: 9_999 },
        durationMs: 12,
        status: "error",
        usageSource: "provider",
        cost: { status: "unknown", currency: "USD" },
        failure: {
          category: "authentication",
          message: "token=ghp_abcdefghijklmnopqrstuvwxyz123456",
        },
      }],
    }];
    const invokeImpl = async <T>(command: string): Promise<T> => {
      if (command === "initialize_runtime_repository") {
        return {
          backend: "tauri-sqlite",
          schemaVersion: 1,
          migrations: [],
        } as T;
      }
      if (command === "load_runtime_snapshot") {
        return { snapshot } as T;
      }
      throw new Error(`unexpected command ${command}`);
    };
    const restoreTauri = setTauriRuntimeForTest();

    try {
      const store = await RuntimeRepositoryStore.create({ invokeImpl } as never);
      const loaded = await store.loadSnapshot();

      expect(loaded?.promptRuns[0]).not.toHaveProperty("modelCalls");
      expect(JSON.stringify(loaded)).not.toMatch(/ghp_|abcdefghijklmnopqrstuvwxyz123456/i);
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
          storyEntities: [
            {
              id: "story_entity_player",
              name: "Nia",
              kind: "player",
              summary: "A careful cartographer.",
              knownFacts: ["Nia knows she carries a silver coin."],
              doesNotKnow: [],
              notes: [],
            },
            {
              id: "story_entity_rook",
              name: "Rook",
              kind: "character",
              summary: "A contact in the alley.",
              knownFacts: ["Rook knows Nia is nearby."],
              doesNotKnow: ["Nia carries a silver coin."],
              notes: [],
            },
          ],
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
          stateProposals: [
            {
              kind: "location",
              summary: "Location -> Cellar",
              provenance: "player-action",
              applied: true,
            },
          ],
          usage: {
            inputTokens: 20,
            outputTokens: 8,
            totalTokens: 28,
          },
          modelCalls: [
            {
              phase: "hidden-continuity",
              provider: "mock",
              model: "mock-narrator",
              usage: { inputTokens: 8, outputTokens: 2, totalTokens: 10 },
              inputBudgetTokens: 14_200,
              effectiveContextWindowTokens: 16_000,
              budgetSource: "model-metadata",
              durationMs: 12,
              status: "success",
              usageSource: "provider",
              cost: {
                status: "known",
                currency: "USD",
                amountUsd: 0,
                pricing: {
                  model: "mock-narrator",
                  currency: "USD",
                  inputUsdPerMillionTokens: 0,
                  outputUsdPerMillionTokens: 0,
                  source: "built-in mock provider",
                  effectiveDate: "1970-01-01",
                },
              },
              stateProposalCount: 1,
            },
            {
              phase: "visible-response",
              provider: "mock",
              model: "mock-narrator",
              usage: { inputTokens: 20, outputTokens: 8, totalTokens: 28 },
              inputBudgetTokens: 5_100,
              durationMs: 34,
              status: "success",
            },
          ],
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
        workflowJson: JSON.stringify({
          "1": {
            class_type: "CheckpointLoaderSimple",
            inputs: {
              ckpt_name: "FLUX.1-schnell",
            },
          },
        }),
        apiKey: "sk-image-secret-should-drop",
        token: "image-token-should-drop",
        ignored: true,
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
    expect(loaded?.imageProviderSettings).toMatchObject({
      mode: "comfyui",
      providerId: "comfyui",
      endpoint: "http://127.0.0.1:8188",
      model: "FLUX.1-schnell",
      workflowJson: expect.stringContaining("CheckpointLoaderSimple"),
      width: 1024,
      height: 1024,
      pollTimeoutMs: 120000,
    });
    expect(JSON.stringify(loaded?.imageProviderSettings)).not.toContain("sk-image-secret-should-drop");
    expect(JSON.stringify(loaded?.imageProviderSettings)).not.toContain("image-token-should-drop");
    expect(JSON.stringify(loaded?.imageProviderSettings)).not.toContain("ignored");
    expect(loaded?.messages).toHaveLength(2);
    expect(loaded?.promptRuns[0]).toMatchObject({
      id: "run_001",
      compiledPrompt: "",
      includedLoreEntryIds: ["lore-gate"],
      stateChanges: ["Location -> Cellar"],
      stateProposals: [
        {
          kind: "location",
          provenance: "player-action",
          applied: true,
        },
      ],
      usage: {
        totalTokens: 28,
      },
      modelCalls: [
        {
          phase: "hidden-continuity",
          usage: { totalTokens: 10 },
          inputBudgetTokens: 14_200,
          effectiveContextWindowTokens: 16_000,
          budgetSource: "model-metadata",
          usageSource: "provider",
          cost: { status: "known", amountUsd: 0 },
          stateProposalCount: 1,
        },
        { phase: "visible-response", usage: { totalTokens: 28 }, inputBudgetTokens: 5_100 },
      ],
    });
    await expect(new PromptRunRepository(driver).getById("run_001")).resolves.toMatchObject({
      compiledPrompt: "",
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
    expect(loaded?.cards[0].storyEntities).toEqual([
      expect.objectContaining({
        name: "Nia",
        kind: "player",
      }),
      expect.objectContaining({
        name: "Rook",
        kind: "character",
        doesNotKnow: ["Nia carries a silver coin."],
      }),
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

  it("rejects malformed compatibility snapshots and falls back around malformed arrays", async () => {
    const driver = createInMemorySqlDriver();
    await runMigrations(driver, sqliteMigrations);
    const store = await RuntimeRepositoryStore.create({ driver });

    await insertRawRuntimeSnapshot(driver, {
      snapshot: {
        version: 2,
        theme: "dark",
        activeCardId: "card",
        messages: [],
        promptRuns: [],
      },
    });
    await expect(store.loadSnapshot()).resolves.toBeNull();

    await insertRawRuntimeSnapshot(driver, {
      snapshot: {
        version: 2,
        theme: "dark",
        activeCardId: 42,
        cards: [
          {
            id: "card",
            name: "Card",
            kind: "rpg",
            lorebooks: [
              null,
              {
                id: "lore-empty",
                name: "Empty Lore",
              },
            ],
          },
        ],
        messages: "bad",
        promptRuns: "bad",
        providerKeyStatus: 42,
      },
    });

    const loaded = await store.loadSnapshot();
    expect(loaded).toMatchObject({
      activeCardId: "card",
      messages: [],
      promptRuns: [],
      providerKeyStatus: "No plaintext keys stored.",
    });
    expect(loaded?.cards[0].lorebooks).toEqual([
      null,
      {
        id: "lore-empty",
        name: "Empty Lore",
      },
    ]);
  });

  it("skips malformed side-table rows while saving and pruning compatibility snapshots", async () => {
    const driver = createInMemorySqlDriver();
    await runMigrations(driver, sqliteMigrations);
    const store = await RuntimeRepositoryStore.create({ driver });

    await insertRawRuntimeSnapshot(driver, {
      snapshot: {
        ...createMinimalSnapshot(),
        cards: [
          null,
          {
            id: "old-card",
            name: "Old Card",
            kind: "rpg",
            rpg: { location: "Old cellar" },
            lorebooks: [
              null,
              {
                name: "Missing id",
              },
            ],
          },
        ],
        generatedMaps: [
          null,
          {
            id: "old-map",
          },
        ],
      },
    });

    await store.saveSnapshot({
      ...createMinimalSnapshot(),
      cards: [
        {
          id: "card_blank_slate_rpg",
          name: "Blank Slate RPG",
          kind: "rpg",
          memory: [
            null,
            {
              label: "No detail",
            },
            {
              detail: "Only this stable fact should persist.",
            },
          ],
          lorebooks: [
            null,
            {
              name: "Missing id",
            },
            {
              id: "lore-valid",
              name: "Valid Lore",
              entries: [
                null,
                {
                  id: "entry-missing-content",
                },
                {
                  id: "entry-valid",
                  title: "Valid Entry",
                  content: "This lore entry should persist.",
                },
              ],
            },
          ],
        } as unknown as RepositoryRuntimeSnapshot["cards"][number],
      ],
      generatedMaps: [
        null,
        {
          id: "map-missing-prompt",
        },
        {
          id: "map-good",
          prompt: "Saved generated map prompt.",
          status: "prompt_ready",
        },
      ],
    });

    await expect(new ImagePromptRunRepository(driver).getById("map-missing-prompt")).resolves.toBeNull();
    await expect(new ImagePromptRunRepository(driver).getById("map-good")).resolves.toMatchObject({
      compiledPrompt: "Saved generated map prompt.",
    });
    await expect(new MemoryEntryRepository(driver).listByChat(RUNTIME_CHAT_ID)).resolves.toEqual([
      expect.objectContaining({
        category: "card_memory:Memory",
        text: "Only this stable fact should persist.",
      }),
    ]);
    await expect(new LorebookRepository(driver).getById("lore-valid")).resolves.toMatchObject({
      name: "Valid Lore",
    });
    await expect(new LorebookEntryRepository(driver).listByLorebook("lore-valid")).resolves.toEqual([
      expect.objectContaining({
        id: "entry-valid",
        content: "This lore entry should persist.",
      }),
    ]);
  });

  it("rebuilds orphaned first-session messages and drops malformed usage metadata", async () => {
    const driver = createInMemorySqlDriver();
    await runMigrations(driver, sqliteMigrations);
    const store = await RuntimeRepositoryStore.create({ driver });

    await store.saveSnapshot({
      ...createMinimalSnapshot(),
      messages: [
        {
          id: "user-orphan",
          role: "user",
          content: "Hello from the public branch.",
        },
      ],
      chatSessions: [
        {
          id: "session-first",
          cardId: "card_blank_slate_rpg",
          title: "First session",
          messages: [],
        },
        {
          id: "session-second",
          cardId: "card_blank_slate_rpg",
          title: "Second session",
          messages: [],
        },
      ],
      promptRuns: [
        createPromptRun("run-bad-usage", "bad"),
        createPromptRun("run-zero-usage", {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        }),
      ],
    });

    const loaded = await store.loadSnapshot();
    expect(loaded?.chatSessions?.[0].messages).toEqual([
      {
        id: "user-orphan",
        role: "user",
        content: "Hello from the public branch.",
      },
    ]);
    expect(loaded?.chatSessions?.[1].messages).toEqual([]);
    expect(loaded?.promptRuns.map((run) => run.usage)).toEqual([undefined, undefined]);
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
        storyEntities: [
          {
            id: "story_entity_player",
            name: "Nia",
            kind: "player",
            summary: "A careful cartographer.",
            knownFacts: ["Nia knows she carries a silver coin."],
            doesNotKnow: [],
            notes: [],
          },
          {
            id: "story_entity_rook",
            name: "Rook",
            kind: "character",
            summary: "A contact in the alley.",
            knownFacts: ["Rook knows Nia is nearby."],
            doesNotKnow: ["Nia carries a silver coin."],
            notes: [],
          },
        ],
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

function createPromptRun(
  id: string,
  usage: unknown,
): RepositoryRuntimeSnapshot["promptRuns"][number] {
  return {
    id,
    cardId: "card_blank_slate_rpg",
    chatId: RUNTIME_CHAT_ID,
    compiledPrompt: "private prompt",
    response: "response",
    provider: "mock",
    model: "mock-narrator",
    tokenEstimate: 1,
    includedLayerIds: [],
    includedLoreEntryIds: [],
    warnings: [],
    stateChanges: [],
    usage: usage as RepositoryRuntimeSnapshot["promptRuns"][number]["usage"],
  };
}

async function insertRawRuntimeSnapshot(
  driver: InMemorySqlDriver,
  profile: Record<string, unknown>,
  updatedAt = "2026-07-01T00:00:00.000Z",
): Promise<void> {
  await driver.execute(
    `INSERT OR REPLACE INTO characters (
      id,
      name,
      description,
      profile_json,
      source,
      created_at,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      RUNTIME_SNAPSHOT_CHARACTER_ID,
      "Snapshot",
      null,
      JSON.stringify(profile),
      "runtime-snapshot",
      "2026-07-01T00:00:00.000Z",
      updatedAt,
    ],
  );
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
