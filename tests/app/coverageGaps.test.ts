import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RUNTIME_STORAGE_KEY,
  loadLocalRuntimeSnapshot,
  sanitizeGeneratedMaps,
  sanitizePersistedImageProviderSettings,
  sanitizePersistedProviderSettings,
  sanitizePersistedRuntimeSettings,
  sanitizePromptRunsForExport,
  sanitizePromptRunsForPersistence,
  saveLocalRuntimeSnapshot,
  type LocalRuntimeSnapshot,
} from "../../src/app/localRuntimeStore";
import {
  buildRuntimeDiagnostics,
  buildVersionedRuntimeExport,
  parseVersionedRuntimeExport,
} from "../../src/app/runtimeDataBundle";
import {
  RUNTIME_SNAPSHOT_CHARACTER_ID,
  RuntimeRepositoryStore,
  type RepositoryRuntimeSnapshot,
} from "../../src/app/runtimeRepositoryStore";
import { createInMemorySqlDriver } from "../../src/db/inMemoryDriver";
import { runMigrations } from "../../src/db/migrations";
import { sqliteMigrations } from "../../src/db/schema";
import {
  applyValidatedTurnEffectsToCard,
  describeValidatedTurnEffects,
  filterValidatedTurnEffectsForPolicy,
  type TurnEffectRuntimeCard,
} from "../../src/app/turnEffects";
import { createEmptyExtractionResult, type ExtractionResult } from "../../src/runtime/extraction";
import {
  shouldUseRepositorySnapshot,
  shouldPersistFullLocalSnapshot,
  type SnapshotCandidate,
} from "../../src/app/startupPersistencePolicy";

describe("app helper coverage gap characterization", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("covers startup persistence policy edge cases", () => {
    const repo: SnapshotCandidate = {
      savedAt: "2026-07-01T10:00:00.000Z",
      cards: [{ id: "card_real", name: "Real", kind: "rpg" }],
      messages: [],
      promptRuns: [],
      chatSessions: [{ messages: [{ id: "session-message" }] }],
    };

    expect(shouldUseRepositorySnapshot(null, null)).toBe(false);
    expect(shouldUseRepositorySnapshot(repo, null)).toBe(true);
    expect(shouldUseRepositorySnapshot(repo, { ...repo, savedAt: "not-a-date" })).toBe(true);
    expect(
      shouldUseRepositorySnapshot(repo, {
        savedAt: "2026-07-01T11:00:00.000Z",
        cards: [null],
        messages: [],
        promptRuns: [],
      }),
    ).toBe(true);
    expect(
      shouldUseRepositorySnapshot(repo, {
        savedAt: "2026-07-01T11:00:00.000Z",
        cards: [{ id: "card_blank_slate_rpg", name: "Blank Slate RPG" }, { id: "extra" }],
        messages: [],
        promptRuns: [],
      }),
    ).toBe(false);
    expect(
      shouldUseRepositorySnapshot(
        {
          savedAt: "not-a-date",
          cards: [{ id: "card_blank_slate_rpg", name: "Blank Slate RPG", kind: "rpg" }],
          messages: [],
          promptRuns: [],
        },
        {
          savedAt: "also-not-a-date",
          cards: [{ id: "card_blank_slate_rpg", name: "Blank Slate RPG" }],
          messages: [],
          promptRuns: [],
        },
      ),
    ).toBe(false);
    expect(
      shouldUseRepositorySnapshot(
        {
          savedAt: "2026-07-01T09:00:00.000Z",
          cards: [{ id: "card_real", name: "Real", kind: "rpg" }],
          messages: [],
          promptRuns: [],
          chatSessions: [{ messages: [] }],
        },
        {
          savedAt: "2026-07-01T10:00:00.000Z",
          cards: [{ id: "card_blank_slate_rpg", name: "Blank Slate RPG" }],
          messages: [],
          promptRuns: [],
        },
      ),
    ).toBe(true);
    expect(
      shouldUseRepositorySnapshot(
        {
          savedAt: "2026-07-01T09:00:00.000Z",
          cards: [
            { id: "card_blank_slate_rpg", name: "Blank Slate RPG" },
            { id: "card_second", name: "Second Card" },
          ],
          messages: [],
          promptRuns: [],
        },
        {
          savedAt: "2026-07-01T10:00:00.000Z",
          cards: [{ id: "card_blank_slate_rpg", name: "Blank Slate RPG" }],
          messages: [],
          promptRuns: [],
        },
      ),
    ).toBe(true);
    expect(shouldPersistFullLocalSnapshot({ isDesktopRuntime: true })).toBe(false);
    expect(shouldPersistFullLocalSnapshot({ isDesktopRuntime: false })).toBe(true);
  });

  it("loads, sanitizes, and rejects local runtime snapshots by shape", () => {
    expect(loadLocalRuntimeSnapshot()).toBeNull();
    vi.stubGlobal("window", undefined);
    expect(loadLocalRuntimeSnapshot()).toBeNull();
    expect(() => saveLocalRuntimeSnapshot(createLocalSnapshot())).not.toThrow();
    vi.unstubAllGlobals();

    localStorage.setItem(RUNTIME_STORAGE_KEY, "{bad json");
    expect(loadLocalRuntimeSnapshot()).toBeNull();
    localStorage.setItem(RUNTIME_STORAGE_KEY, JSON.stringify({ version: 2, cards: [], messages: [], promptRuns: [] }));
    expect(loadLocalRuntimeSnapshot()).toBeNull();
    localStorage.setItem(
      RUNTIME_STORAGE_KEY,
      JSON.stringify({ version: 2, activeCardId: "card", cards: [{ id: "card" }], messages: [], promptRuns: [] }),
    );
    expect(loadLocalRuntimeSnapshot()).toMatchObject({
      theme: "dark",
      activeCardId: "card",
      chatSessions: undefined,
      activeChatIds: undefined,
      generatedMaps: [],
    });

    localStorage.setItem(
      RUNTIME_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        theme: "light",
        activeCardId: "card",
        cards: [{ id: "card" }],
        messages: [],
        chatSessions: "bad",
        activeChatIds: { card: "chat", ignored: 1 },
        promptRuns: [],
        providerKeyStatus: 42,
        providerSettings: {
          mode: "openai-compatible",
          apiKey: "sk-should-drop",
          secretReference: {
            providerId: "openrouter",
            secretName: "apiKey",
            storageKind: "os-keychain",
            storageKey: "openrouter:apiKey",
          },
        },
        imageProviderSettings: {
          endpoint: "http://127.0.0.1:8188",
          width: 1024,
          ignored: true,
        },
        runtimeSettings: {
          textStreaming: true,
          impersonationPrompt: "persona",
          ignored: "no",
        },
        generatedMaps: [
          null,
          {
            id: "map",
            prompt: "prompt",
            ignored: 123,
          },
        ],
        savedAt: 42,
      }),
    );

    expect(loadLocalRuntimeSnapshot()).toMatchObject({
      theme: "light",
      providerKeyStatus: "No plaintext keys stored.",
      activeChatIds: { card: "chat" },
      providerSettings: {
        mode: "openai-compatible",
        secretReference: {
          storageKey: "openrouter:apiKey",
        },
      },
      imageProviderSettings: {
        endpoint: "http://127.0.0.1:8188",
        width: 1024,
      },
      runtimeSettings: {
        textStreaming: true,
        impersonationPrompt: "persona",
      },
      generatedMaps: [{ id: "map", prompt: "prompt" }],
    });
  });

  it("handles local snapshot quota and non-quota persistence failures", () => {
    const snapshot = createLocalSnapshot();
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    setItem.mockImplementationOnce(() => {
      throw new Error("disk unavailable");
    });
    expect(() => saveLocalRuntimeSnapshot(snapshot)).toThrow(/disk unavailable/);

    setItem.mockReset();
    setItem
      .mockImplementationOnce(() => {
        throw new DOMException("quota", "QuotaExceededError");
      })
      .mockImplementationOnce(() => {
        throw new Error("retry failed");
      });
    expect(() => saveLocalRuntimeSnapshot(snapshot)).toThrow(/retry failed/);

    setItem.mockReset();
    setItem
      .mockImplementationOnce(() => {
        throw new DOMException("quota", "QuotaExceededError");
      })
      .mockImplementationOnce(() => {
        throw new DOMException("quota", "NS_ERROR_DOM_QUOTA_REACHED");
      });
    expect(() => saveLocalRuntimeSnapshot(snapshot)).not.toThrow();

    setItem.mockReset();
    const writes: string[] = [];
    setItem
      .mockImplementationOnce(() => {
        throw new DOMException("quota", "QuotaExceededError");
      })
      .mockImplementationOnce((_key, value) => {
        writes.push(value);
      });
    expect(() =>
      saveLocalRuntimeSnapshot({
        ...snapshot,
        chatSessions: [null, { id: "session-without-messages" }] as unknown as LocalRuntimeSnapshot<
          Record<string, unknown>,
          Record<string, unknown>,
          Record<string, unknown>
        >["chatSessions"],
      }),
    ).not.toThrow();
    expect((JSON.parse(writes[0]) as LocalRuntimeSnapshot<unknown, unknown, unknown>).chatSessions).toEqual([
      null,
      { id: "session-without-messages" },
    ]);

    setItem.mockReset();
    writes.length = 0;
    setItem
      .mockImplementationOnce(() => {
        throw new DOMException("quota", "QuotaExceededError");
      })
      .mockImplementationOnce((_key, value) => {
        writes.push(value);
      });
    expect(() => saveLocalRuntimeSnapshot({ ...snapshot, chatSessions: undefined })).not.toThrow();
    expect((JSON.parse(writes[0]) as LocalRuntimeSnapshot<unknown, unknown, unknown>).chatSessions).toBeUndefined();
  });

  it("covers local runtime sanitizer defaults and unchanged prompt runs", () => {
    const promptRuns = [{ id: "run", compiledPrompt: "" }];
    expect(sanitizePromptRunsForPersistence(promptRuns, { promptDebugLogs: false })).toBe(promptRuns);
    expect(sanitizePromptRunsForPersistence([{ id: "run", compiledPrompt: "secret" }], { promptDebugLogs: true })).toEqual([
      { id: "run", compiledPrompt: "secret" },
    ]);
    expect(sanitizePromptRunsForExport([{ id: "run", compiledPrompt: "secret" }])).toEqual([
      { id: "run", compiledPrompt: "" },
    ]);
    expect(sanitizePersistedProviderSettings({ apiKey: "raw" })).toBeUndefined();
    expect(
      sanitizePersistedImageProviderSettings({
        mode: "comfyui",
        workflowJson: JSON.stringify({ "1": { inputs: { token: "workflow-token" } } }),
        apiKey: "sk-should-drop",
        width: Number.NaN,
      }),
    ).toEqual({ mode: "comfyui" });
    expect(sanitizePersistedRuntimeSettings({ ignored: "yes" })).toBeUndefined();
    expect(sanitizeGeneratedMaps([{ ignored: 1 }, { id: "map" }])).toEqual([{ id: "map" }]);
    expect(
      sanitizePersistedImageProviderSettings({
        mode: "comfyui",
        height: Infinity,
        seed: 0,
        steps: 30,
        cfg: 7,
      }),
    ).toEqual({
      mode: "comfyui",
      seed: 0,
      steps: 30,
      cfg: 7,
    });
    expect(sanitizePersistedRuntimeSettings({ textStreaming: false, banEmojis: true })).toEqual({
      textStreaming: false,
      banEmojis: true,
    });
  });

  it("covers runtime export invalid payloads and default diagnostics", () => {
    expect(() => parseVersionedRuntimeExport("{bad json")).toThrow(/invalid/i);
    expect(() => parseVersionedRuntimeExport("[]")).toThrow(/invalid/i);
    expect(() =>
      parseVersionedRuntimeExport(JSON.stringify({ schema: "rpg.runtime.export", version: 1, snapshot: null })),
    ).toThrow(/invalid/i);
    expect(() =>
      parseVersionedRuntimeExport(
        JSON.stringify({
          schema: "rpg.runtime.export",
          version: 1,
          snapshot: { version: 2, cards: [], messages: [], promptRuns: [], activeCardId: 4 },
        }),
      ),
    ).toThrow(/invalid/i);

    const exported = buildVersionedRuntimeExport({
      ...createLocalSnapshot(),
      theme: "wrong" as "dark",
      providerKeyStatus: 42 as unknown as string,
      imageProviderSettings: { workflowJson: "private", mode: "comfyui" },
      savedAt: undefined as unknown as string,
    });
    expect(exported.snapshot.theme).toBe("dark");
    expect(exported.snapshot.providerKeyStatus).toBe("Unknown.");
    expect(exported.snapshot.imageProviderSettings).toEqual({ mode: "comfyui" });
    expect(
      buildVersionedRuntimeExport({
        ...createLocalSnapshot(),
        chatSessions: "bad" as unknown as [],
        activeChatIds: "bad" as unknown as Record<string, string>,
        messages: "bad" as unknown as [],
        promptRuns: "bad" as unknown as [],
        generatedMaps: [{ id: "map", prompt: "public" }],
        runtimeSettings: { promptDebugLogs: true },
      }).snapshot,
    ).toMatchObject({
      messages: [],
      promptRuns: [],
      generatedMaps: [{ id: "map", prompt: "public" }],
      runtimeSettings: { promptDebugLogs: true },
    });

    const diagnostics = buildRuntimeDiagnostics({
      snapshot: {
        ...createLocalSnapshot(),
        cards: "bad" as unknown as [],
        chatSessions: "bad" as unknown as [],
        messages: "bad" as unknown as [],
        promptRuns: "bad" as unknown as [],
        generatedMaps: "bad" as unknown as [],
        providerSettings: "bad" as unknown as Record<string, unknown>,
        imageProviderSettings: "bad" as unknown as Record<string, unknown>,
        runtimeSettings: "bad" as unknown as Record<string, unknown>,
        theme: 123 as unknown as "dark",
      },
      saveStatus: " ",
      repositoryStatus: "ok",
      providerKeyStatus: "authorization Bearer secret-token",
      imageProviderStatus: "sk-image-secret-value",
    });
    expect(diagnostics.runtime.theme).toBe("unknown");
    expect(diagnostics.runtime.backend).toBe("unknown");
    expect(diagnostics.counts).toMatchObject({ cards: 0, chats: 0, messages: 0, promptRuns: 0 });
    expect(diagnostics.provider).toMatchObject({ mode: "", hasStoredSecretReference: false });
    expect(diagnostics.statuses.save).toBe("");
    expect(diagnostics.statuses.providerKey).toBe("[redacted] [redacted]");
  });

  it("loads repository fallback snapshots when normalized runtime rows are absent", async () => {
    const driver = createInMemorySqlDriver();
    await runMigrations(driver, sqliteMigrations);
    await driver.execute(
      `INSERT INTO characters (
        id, name, description, profile_json, source, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        RUNTIME_SNAPSHOT_CHARACTER_ID,
        "Snapshot",
        null,
        JSON.stringify({
          snapshot: {
            ...createRepositorySnapshot(),
            theme: "light",
            activeCardId: 4,
            messages: [{ id: "fallback-message", role: "bad", content: "Fallback" }],
            promptRuns: [{ id: "fallback-run", compiledPrompt: "private" }],
            chatSessions: [{ id: "session-1", cardId: "card", title: "Session", messages: [] }],
            activeChatIds: { card: "chat-card", bad: 4 },
            providerKeyStatus: 42,
            savedAt: undefined,
          },
        }),
        "runtime-snapshot",
        "2026-07-01T00:00:00.000Z",
        "2026-07-01T00:01:00.000Z",
      ],
    );
    const store = await RuntimeRepositoryStore.create({ driver });

    await expect(store.loadSnapshot()).resolves.toMatchObject({
      theme: "light",
      activeCardId: "card",
      messages: [{ id: "fallback-message", role: "bad", content: "Fallback" }],
      promptRuns: [{ id: "fallback-run", compiledPrompt: "" }],
      providerKeyStatus: "No plaintext keys stored.",
      savedAt: "2026-07-01T00:01:00.000Z",
    });
  });

  it("covers turn effect summaries, fallback memory IDs, health bounds, and ungrounded edge cases", () => {
    const extraction: ExtractionResult = {
      ...createEmptyExtractionResult(),
      memory_updates: [{ text: "A stable memory without a label." }],
      rpg_state_updates: {
        location: "Cellar",
        health_delta: 99,
        inventory_add: ["brass key"],
        inventory_remove: ["missing torch"],
        quest_updates: [{ id: "quest-1" }, { title: "Find relic" }],
        world_flags: { gate_open: true, count: 1 },
      },
      image_prompt_opportunity: {
        should_generate: true,
        reason: null,
        visual_scene_summary: null,
      },
    };

    expect(describeValidatedTurnEffects(extraction)).toEqual([
      "Memory proposals 1",
      "Location -> Cellar",
      "Health delta 99",
      "Inventory + brass key",
      "Inventory - missing torch",
      "Quest proposals 2",
      "Flag gate_open=true",
      "Flag count=1",
      "Image prompt opportunity",
    ]);

    const filtered = filterValidatedTurnEffectsForPolicy(createRpgCard(), extraction, {
      latestUserAction: "I rest, find the brass key, and find relic while the gate is open.",
      assistantMessageText:
        "The gate is open. You find the brass key and find relic. A stable memory without a label.",
    });
    expect(filtered.extraction.rpg_state_updates.health_delta).toBe(0);
    expect(filtered.extraction.rpg_state_updates.inventory_add).toEqual(["brass key"]);
    expect(filtered.extraction.rpg_state_updates.inventory_remove).toEqual([]);
    expect(filtered.extraction.rpg_state_updates.quest_updates).toEqual([{ title: "Find relic" }]);
    expect(filtered.extraction.rpg_state_updates.world_flags).toEqual({ gate_open: true });

    const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    vi.spyOn(Math, "random").mockReturnValue(0.123456);
    try {
      const next = applyValidatedTurnEffectsToCard(createRpgCard(), filtered.extraction, {
        now: () => "2026-07-01T00:00:00.000Z",
      });
      expect(next.memory[0]).toMatchObject({
        id: expect.stringMatching(/^memory_20260701T000000000Z_/),
        label: "Model-proposed memory",
      });
      expect(next.rpg?.health).toBe("10/10");
    } finally {
      if (originalCryptoDescriptor) {
        Object.defineProperty(globalThis, "crypto", originalCryptoDescriptor);
      }
    }

    expect(
      applyValidatedTurnEffectsToCard({ id: "card", name: "Character", kind: "character", memory: [] }, extraction),
    ).not.toHaveProperty("rpg");
  });

  it("covers turn effect filtering edge cases for malformed proposals and grounded recovery", () => {
    const malformedExtraction: ExtractionResult = {
      ...createEmptyExtractionResult(),
      memory_updates: [
        {},
        { text: "A memory from nowhere." },
        { text: "!!!" },
      ],
      rpg_state_updates: {
        ...createEmptyExtractionResult().rpg_state_updates,
        health_delta: -6,
        world_flags: {
          "!!!": true,
        },
      },
    };

    const malformed = filterValidatedTurnEffectsForPolicy(createRpgCard(), malformedExtraction, {
      latestUserAction: "I wait at camp.",
      assistantMessageText: "Nothing changes at camp.",
    });

    expect(malformed.extraction.memory_updates).toEqual([]);
    expect(malformed.extraction.rpg_state_updates.health_delta).toBe(0);
    expect(malformed.extraction.rpg_state_updates.world_flags).toEqual({});
    expect(malformed.warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/ungrounded memory/i),
        expect.stringMatching(/oversized health delta/i),
        expect.stringMatching(/ungrounded flag/i),
      ]),
    );

    const healed = filterValidatedTurnEffectsForPolicy(createRpgCard(), {
      ...createEmptyExtractionResult(),
      rpg_state_updates: {
        ...createEmptyExtractionResult().rpg_state_updates,
        health_delta: 3,
      },
    }, {
      latestUserAction: "I rest and bandage my arm with a potion.",
      assistantMessageText: "You recover some strength.",
    });
    expect(healed.extraction.rpg_state_updates.health_delta).toBe(3);
    expect(
      applyValidatedTurnEffectsToCard(
        {
          ...createRpgCard(),
          rpg: {
            ...createRpgCard().rpg!,
            health: "2/5",
          },
        },
        healed.extraction,
      ).rpg?.health,
    ).toBe("5/5");

    const malformedHealth = applyValidatedTurnEffectsToCard(
      {
        ...createRpgCard(),
        rpg: {
          ...createRpgCard().rpg!,
          health: "winded",
        },
      },
      {
        ...createEmptyExtractionResult(),
        memory_updates: [{}],
        rpg_state_updates: {
          ...createEmptyExtractionResult().rpg_state_updates,
          health_delta: -1,
        },
      },
    );
    expect(malformedHealth.memory).toEqual([]);
    expect(malformedHealth.rpg?.health).toBe("winded");
  });

  it("blocks normalized but meaningless memory details during grounding", () => {
    const filtered = filterValidatedTurnEffectsForPolicy(createRpgCard(), {
      ...createEmptyExtractionResult(),
      memory_updates: [
        {
          text: "or",
        },
      ],
    }, {
      latestUserAction: "Mist glimmers.",
      assistantMessageText: "Nothing shifts.",
    });

    expect(filtered.extraction.memory_updates).toEqual([]);
    expect(filtered.warnings).toEqual([expect.stringMatching(/ungrounded memory/i)]);
  });
});

function createLocalSnapshot(): LocalRuntimeSnapshot<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>, Record<string, unknown>> {
  return {
    version: 2,
    theme: "dark",
    activeCardId: "card",
    cards: [{ id: "card", name: "Card", kind: "rpg" }],
    messages: [],
    chatSessions: [{ id: "chat", cardId: "card", title: "Chat", messages: [{ id: "m", role: "user", content: "Hi" }] }],
    activeChatIds: { card: "chat" },
    promptRuns: [{ id: "run", compiledPrompt: "private" }],
    providerKeyStatus: "No plaintext keys stored.",
    generatedMaps: [],
    savedAt: "2026-07-01T00:00:00.000Z",
  };
}

function createRepositorySnapshot(): RepositoryRuntimeSnapshot {
  return {
    version: 2,
    theme: "dark",
    activeCardId: "card",
    cards: [{ id: "card", name: "Card", kind: "rpg" }],
    messages: [],
    promptRuns: [],
    providerKeyStatus: "No plaintext keys stored.",
    savedAt: "2026-07-01T00:00:00.000Z",
  };
}

function createRpgCard(): TurnEffectRuntimeCard {
  return {
    id: "card",
    name: "Card",
    kind: "rpg",
    memory: [],
    rpg: {
      location: "Start",
      health: "10/10",
      inventory: ["old torch"],
      quests: [],
      flags: {},
      knownPlaces: ["Start"],
      mapStyle: "map",
    },
  };
}
