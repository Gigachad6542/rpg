/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest";

import { __appTestables } from "../../src/app/App";

const helpers = __appTestables;

const runtimeSettings = {
  textStreaming: true,
  banEmojis: false,
  promptDebugLogs: false,
  impersonationPrompt: "",
  accentColor: "",
};

function providerSettings(overrides: Record<string, unknown> = {}) {
  return {
    mode: "openai-compatible",
    providerId: "local",
    displayName: "Local",
    baseUrl: "http://127.0.0.1:1234/v1",
    model: "local-model",
    ...overrides,
  } as any;
}

function rpgCard(overrides: Record<string, unknown> = {}) {
  return {
    id: "card-rpg",
    name: "Blank Slate RPG",
    kind: "rpg",
    summary: "A blank RPG.",
    characterName: "",
    characterDescription: "",
    scenario: "",
    greeting: "",
    exampleDialogs: "",
    systemPrompt: "Run the RPG.",
    preHistoryInstructions: "Before history.",
    postHistoryInstructions: "After history.",
    playerRules: [],
    lorebooks: [],
    memory: [],
    storyEntities: [],
    mapEnabled: true,
    rpg: {
      location: "Crossroads",
      health: "8/10",
      inventory: ["lantern"],
      quests: ["Find shelter"],
      flags: { gate_open: true },
      knownPlaces: ["Crossroads"],
      mapStyle: "ink map",
    },
    ...overrides,
  } as any;
}

function characterCard(overrides: Record<string, unknown> = {}) {
  return {
    ...rpgCard({
      id: "card-character",
      name: "Archivist",
      kind: "character",
      summary: "A quiet archivist.",
      characterName: "Mira",
      characterDescription: "Silver hair, green coat.",
      scenario: "A candlelit archive.",
      rpg: undefined,
      mapEnabled: false,
    }),
    ...overrides,
  } as any;
}

function artifact(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-1",
    imageKind: "map",
    cardId: "card-rpg",
    chatId: "chat-1",
    prompt: "map",
    negativePrompt: "",
    provider: "prompt-only",
    model: "model",
    status: "generated",
    imageUrl: "http://127.0.0.1:8188/view?filename=map.png",
    createdAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  } as any;
}

describe("App pure helper coverage", () => {
  it("normalizes chats, active chat IDs, messages, and chat titles", () => {
    const cards = [rpgCard(), characterCard()];
    const sessions = helpers.parseChatSessions(
      [
        { id: "bad-card", cardId: "missing", messages: [] },
        {
          id: "chat-stored",
          cardId: "card-rpg",
          messages: [
            { id: "m1", role: "user", content: "A very long opening line that should be shortened because it is definitely over forty eight characters." },
            { id: "bad", role: "system", content: "drop me" },
          ],
        },
      ],
      cards,
      [{ id: "flat-1", role: "user", content: "migrated" }],
      "card-character",
    );

    expect(sessions.map((session: any) => session.cardId).sort()).toEqual(["card-character", "card-rpg"]);
    expect(sessions.find((session: any) => session.id === "chat-stored")?.title).toMatch(/\.\.\.$/);
    expect(helpers.getStartupActiveCardId(null, cards)).toBe("");
    expect(helpers.getStartupActiveCardId({ activeCardId: "card_blank_slate_rpg" } as any, [rpgCard({ id: "card_blank_slate_rpg" })])).toBe("");
    expect(helpers.getStartupActiveCardId({ activeCardId: "card-character" } as any, cards)).toBe("card-character");

    const activeIds = helpers.parseActiveChatIds({ "card-rpg": "missing" }, cards, sessions, "card-character");
    expect(activeIds["card-rpg"]).toBe("chat-stored");
    expect(activeIds["card-character"]).toMatch(/^chat_/);
    expect(helpers.parseActiveChatIds({}, [], [{
      id: "loose-chat",
      cardId: "loose-card",
      title: "Loose chat",
      messages: [],
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    }], "loose-card")).toEqual({
      "loose-card": "loose-chat",
    });
    expect(helpers.sanitizeMessages("bad")).toEqual([]);
    expect(helpers.sanitizeMessages([{ id: "m2", role: "assistant", content: "kept" }, { id: 1 }])).toEqual([
      { id: "m2", role: "assistant", content: "kept" },
    ]);

    const created = helpers.createChatSession("card-rpg", " ", {
      id: "chat-created",
      branchOfId: "chat-parent",
      branchedFromMessageId: "message-parent",
      messages: [{ id: "m3", role: "user", content: "Derived title" }],
    });
    expect(created).toMatchObject({
      id: "chat-created",
      title: "Derived title",
      branchOfId: "chat-parent",
      branchedFromMessageId: "message-parent",
    });
    expect(helpers.cloneMessagesForBranch([{ id: "m", role: "user", content: "hello" }], "branch")).toEqual([
      { id: "m__branch_branch_0", role: "user", content: "hello" },
    ]);
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal("crypto", undefined);
    try {
      expect(helpers.createRuntimeEntityId("fallback")).toMatch(/^fallback_\d+_[a-z0-9]+$/);
    } finally {
      vi.stubGlobal("crypto", originalCrypto);
    }
    expect(helpers.filterPersistedOpeningMessages([{ id: "assistant-greeting-1", role: "assistant", content: "hi" }, { id: "u", role: "user", content: "keep" }])).toEqual([
      { id: "u", role: "user", content: "keep" },
    ]);
    expect(helpers.getCardChats("card-rpg", sessions)[0].id).toBe("chat-stored");
    expect(helpers.getActiveChatForCard("card-rpg", sessions, { "card-rpg": "missing" })?.id).toBe("chat-stored");
    expect(helpers.upsertChatSession([{ ...created, title: "old" }], created)[0].title).toBe("Derived title");
    expect(helpers.upsertChatSession([], created)).toHaveLength(1);
    expect(helpers.deriveChatTitle()).toBe("New chat");
    expect(helpers.deriveChatTitle("short")).toBe("short");
  });

  it("builds write-for-me drafts, planner prompts, image prompts, and planned prompt fallbacks", () => {
    const assistantMessage = {
      id: "a1",
      role: "assistant",
      content: "**A bell rings.**\n```status\nLocation: Crossroads\nHealth: 8/10\n```",
    };
    const userMessage = { id: "u1", role: "user", content: "I enter the square." };
    const messages = [userMessage, assistantMessage] as any[];
    const fallback = {
      prompt: "fallback prompt",
      negativePrompt: "fallback negative",
      includedLayers: ["base"],
      providerFormatting: "generic" as const,
    };

    expect(helpers.buildWriteForMeDraft(rpgCard(), messages)).toContain("Crossroads using lantern");
    expect(helpers.buildWriteForMeDraft(characterCard(), [])).toMatch(/start the conversation/i);
    expect(helpers.buildWriteForMeDraft(characterCard(), messages)).toMatch(/relationship/i);
    expect(helpers.getCardOpeningText(characterCard({ greeting: "", scenario: "A candle gutters in the archive." }))).toBe(
      "A candle gutters in the archive.",
    );
    expect((helpers.renderTabIcon("chat") as any).props.size).toBe(15);
    expect((helpers.renderTabIcon("map") as any).props.size).toBe(15);
    expect(helpers.formatRecentChatForMapPlanner(rpgCard(), messages)).toContain("Blank Slate RPG: A bell rings.");
    expect(helpers.summarizeRecentMessagesForMap(rpgCard(), messages)).toContain("Player: I enter the square.");
    expect(helpers.compactForPromptPlanning("**Bold** *aside* ".repeat(40)).length).toBeLessThanOrEqual(220);

    const plannerPrompt = helpers.buildMapPromptPlannerPrompt(rpgCard(), messages, fallback, {
      textStreaming: true,
      banEmojis: true,
      promptDebugLogs: false,
      impersonationPrompt: "Do not write as the user.",
      accentColor: "",
    });
    expect(plannerPrompt).toContain("about 200 feet above ground");
    expect(plannerPrompt).toContain("do not make a map");
    expect(plannerPrompt).toContain("Do not use emojis.");
    expect(helpers.buildMapPromptPlannerPrompt(characterCard(), [], fallback, { ...runtimeSettings, banEmojis: false })).toContain("(no chat yet)");

    const atmosphere = helpers.deriveAerialAtmosphere(rpgCard(), [
      { id: "u1", role: "user", content: "We ride up toward the medieval keep." },
      { id: "a1", role: "assistant", content: "Rain lashes the ramparts.\n\nWeather: heavy rain\nTime: dusk" },
    ] as any);
    expect(atmosphere).toContain("rain");
    expect(atmosphere).toContain("medieval");
    expect(atmosphere).toContain("dusk light");
    expect(atmosphere).not.toMatch(/\b\d{1,2}:\d{2}\b/);
    const eraPlanner = helpers.buildMapPromptPlannerPrompt(
      rpgCard(),
      [{ id: "a2", role: "assistant", content: "Snow drifts over the ancient marble columns at first light." }] as any,
      fallback,
      runtimeSettings,
    );
    expect(eraPlanner).toContain("Never draw a clock");
    expect(eraPlanner).toMatch(/Atmosphere \(weather, era, light\):/);

    expect(helpers.parsePlannedImagePrompt('noise {"prompt":" map ","negative_prompt":" people "}')).toEqual({
      prompt: "map",
      negativePrompt: "people",
    });
    expect(helpers.parsePlannedImagePrompt('{"prompt":" map ","negativePrompt":" fog "}')).toEqual({
      prompt: "map",
      negativePrompt: "fog",
    });
    expect(helpers.parsePlannedImagePrompt('{"prompt":"map"}')).toEqual({
      prompt: "map",
      negativePrompt: "",
    });
    expect(helpers.parsePlannedImagePrompt("noise {bad}")).toEqual({
      prompt: "noise {bad}",
      negativePrompt: "",
    });
    expect(helpers.parsePlannedImagePrompt("{not-json")).toEqual({ prompt: "{not-json", negativePrompt: "" });
    expect(
      helpers.normalizeRpgAerialImagePrompt(
        "very high-altitude birdseye map from about 1000 feet above ground, top-down cartographic layout with readable labels",
      ),
    ).toBe("overhead birdseye aerial environment image from about 200 feet above ground, top-down aerial environment image with visible large landmarks");
    expect(helpers.sanitizeMapNegativePrompt("people, trees, roads, watermark")).toBe("people, watermark");
    expect(helpers.buildImagePromptRequest(rpgCard(), messages)).toMatchObject({
      scene: expect.stringMatching(/Overhead aerial RPG environment image/i),
      camera: expect.stringMatching(/200 feet/i),
      stylePreset: expect.stringMatching(/aerial terrain image/i),
    });
    const visualImageRequest = helpers.buildImagePromptRequest(rpgCard(), [
      {
        id: "a-city",
        role: "assistant",
        content: "FAILURE You look around, but there is no nearby large city in sight.",
      },
      {
        id: "u-spear",
        role: "user",
        content: "i decide to craft a spear from sticks and try to catch a fish near the water",
      },
      {
        id: "a-rest",
        role: "assistant",
        content: "SUCCESS You rest near a small clearing with a few trees and a pond.",
      },
    ] as any[]);
    const visualImagePrompt = [
      visualImageRequest.scene,
      visualImageRequest.locationVisuals,
      visualImageRequest.currentAction,
      visualImageRequest.mood,
      visualImageRequest.continuityLocks?.join(", "),
    ]
      .filter(Boolean)
      .join(" ");
    expect(visualImagePrompt).toContain("recent aerial-visible features only");
    expect(visualImagePrompt).toMatch(/clearing|tree cover|pond or lake/i);
    expect(visualImagePrompt).not.toMatch(/large city|spear|sticks|fish|Player:|FAILURE|SUCCESS|story so far|latest exchange|1000 feet|cartographic/i);
    expect(visualImageRequest.negativePrompt?.join(", ")).toMatch(/map|labels|fish|sticks|small handheld objects/i);
    expect(helpers.buildImagePromptRequest(characterCard(), messages)).toMatchObject({
      scene: "Story image for Archivist",
      camera: "cinematic medium shot",
    });
  });

  it("normalizes cards, story entities, memory-facing cards, and lorebook defaults", () => {
    const legacy = rpgCard({
      id: "card_blank_slate_rpg",
      playerRules: [],
      lorebooks: [{ id: "legacy-empty", name: "Blank RPG Lorebook", entries: [] }],
      storyEntities: [
        { id: "mara", name: "Mara", kind: "character", summary: "careful cartographer in a rainy alley", knownFacts: ["silver coin"] },
        { name: "Guild", kind: "faction", known_facts: ["Controls the bridge"], does_not_know: ["The key is gone"] },
      ],
    });
    const normalized = helpers.normalizeRuntimeCards([legacy, characterCard({ playerRules: [], storyEntities: [] })]);

    expect(normalized[0].lorebooks).toEqual([]);
    expect(normalized[0].playerRules.length).toBeGreaterThan(0);
    expect(normalized[0].storyEntities.map((entity: any) => entity.name)).toContain("Guild");
    expect(normalized[0].storyEntities.map((entity: any) => entity.name)).not.toContain("Mara");
    expect(normalized[1].storyEntities.map((entity: any) => entity.name)).toContain("Mira");
    expect(helpers.normalizeRuntimeCards([rpgCard({ rpg: undefined, storyEntities: [{ name: "", kind: "character" }] })])[0].rpg).toMatchObject({
      location: "Unmapped starting area",
      health: "not configured",
    });
    expect(helpers.isStaleDemoStoryEntity({
      id: "entity-elara",
      name: "Elara",
      kind: "character",
      summary: "rainy alley",
      knownFacts: [],
      doesNotKnow: [],
      notes: [],
    })).toBe(true);
    expect(helpers.isStaleDemoStoryEntity({
      id: "entity-mara-known",
      name: "Mara",
      kind: "character",
      summary: "",
      knownFacts: ["silver coin"],
      doesNotKnow: [],
      notes: [],
    })).toBe(true);
    expect(helpers.isStaleDemoStoryEntity({
      id: "entity-mara-secret",
      name: "Mara",
      kind: "character",
      summary: "",
      knownFacts: [],
      doesNotKnow: ["hidden in my boot"],
      notes: [],
    })).toBe(true);
    expect(helpers.createInitialStoryEntities("card-x", { cardKind: "character", cardCharacterName: "Ada" }).map((entity: any) => entity.name)).toEqual([
      "Player Character",
      "Ada",
    ]);
    expect(helpers.formatStoryEntityKind("player")).toBe("Player character");
    expect(helpers.formatStoryEntityKind("faction")).toBe("Faction");
    expect(helpers.formatStoryEntityKind("group")).toBe("Group");
    expect(helpers.formatStoryEntityKind("character")).toBe("Character");
    expect(helpers.parseStoryEntityKind("bad")).toBeNull();
    expect(helpers.orderStoryEntitiesForDisplay([
      { name: "Zed", kind: "group" },
      { name: "Ana", kind: "character" },
      { name: "Player", kind: "player" },
    ] as any[]).map((entity: any) => entity.name)).toEqual(["Player", "Ana", "Zed"]);
    expect(helpers.orderStoryEntitiesForDisplay([
      { name: "Zed", kind: "character" },
      { name: "Ana", kind: "character" },
    ] as any[]).map((entity: any) => entity.name)).toEqual(["Ana", "Zed"]);
    expect(helpers.toHiddenContinuityCard(rpgCard())).toMatchObject({ rpgState: { location: "Crossroads" } });
    expect(helpers.describeHiddenContinuityChanges({
      continuityBrief: "",
      memoryUpdates: [{ label: "Memory", detail: "Core detail" }],
      entityUpdates: [{
        name: "Rook",
        kind: "character",
        summary: "Scout",
        knownFacts: ["The gate is closed."],
        doesNotKnow: [],
        notes: [],
      }],
      knowledgeUpdates: [{ subject: "Rook", knows: ["The gate is closed."], doesNotKnow: ["The key is hidden."] }],
      warnings: [],
    })).toHaveLength(3);
    expect(helpers.getCleanString("  hello\nworld  ", 8)).toBe("hello wo");
    expect(helpers.parseStringList([" A ", "a", "", "B"])).toEqual(["A", "B"]);
    expect(helpers.slugRuntimeId(" ! ")).toBe("id");
    expect(helpers.normalizeCardLorebooks({
      id: "card-other",
      lorebooks: [{ id: "lore", entries: [{ id: "entry", title: "T", content: "C" }] }],
    } as any)[0].entries[0]).toMatchObject({ caseSensitive: false, wholeWord: false, probability: 100 });
    expect(helpers.normalizeCardLorebooks({
      id: "card-other",
      lorebooks: [{ id: "lore-emptyish", entries: "bad" }],
    } as any)[0].entries).toEqual([]);
  });

  it("normalizes provider settings, runtime settings, generated artifacts, and image readiness", () => {
    const secretReference = {
      providerId: "openrouter",
      secretName: "apiKey",
      storageKind: "os-keychain",
      storageKey: "openrouter:apiKey",
      providerBaseUrl: "https://openrouter.ai/api/v1",
    };
    const parsedProvider = helpers.parseProviderSettings({
      mode: "openai-compatible",
      providerId: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1?drop=1#hash",
      secretReference,
    });
    expect(parsedProvider.secretReference).toMatchObject(secretReference);
    expect(helpers.parseProviderSettings({ mode: "mock" }).model).toBe("mock-narrator");
    expect(helpers.parseProviderSettings({ mode: "openai-compatible", providerId: "openrouter" }).displayName).toBe(
      "Alibaba Cloud Model Studio / DashScope",
    );
    expect(helpers.getDefaultTextModel("openrouter")).toBeTruthy();
    expect(helpers.getDefaultTextModel("mock")).toBe("mock-narrator");
    expect(helpers.getDefaultTextModel("alibaba-model-studio")).toBeTruthy();
    expect(helpers.getTextModelChoices(providerSettings({ providerId: "custom", model: "custom-model" })).map((choice: any) => choice.id)).toContain("custom-model");
    expect(helpers.getImageModelChoices(["installed.safetensors"], "custom-current")[0]).toEqual({
      id: "custom-current",
      label: "custom-current",
    });

    const imageSettings = helpers.parseImageProviderSettings({
      mode: "prompt-only",
      model: "juggernautXL_v9.safetensors",
      workflowJson: '{"class_type":"CheckpointLoaderSimple","inputs":{"ckpt_name":"{{model}}","filename_prefix":"local_cards"},"latent":"EmptyLatentImage"}',
      width: 256,
      height: Number.NaN,
      steps: 1,
      cfg: 1,
      samplerName: "euler",
      scheduler: "normal",
      pollTimeoutMs: 1,
    });
    expect(imageSettings.model).not.toMatch(/juggernaut/i);
    expect(imageSettings.width).toBe(1024);
    expect(imageSettings.steps).toBe(28);
    expect(helpers.toLocalImageQualityDimension("bad")).toBe(1024);
    expect(helpers.toLocalImageQualityDimension(4096)).toBe(2048);
    expect(helpers.parseRuntimeSettings({ textStreaming: false, banEmojis: true, promptDebugLogs: true, impersonationPrompt: "custom" })).toMatchObject({
      banEmojis: true,
      impersonationPrompt: "custom",
    });
    const promptRuns = [{ id: "run", compiledPrompt: "secret prompt" }];
    expect(helpers.applyPromptDebugRetention(promptRuns as any, { ...runtimeSettings, promptDebugLogs: true })).toBe(promptRuns);
    expect(helpers.applyPromptDebugRetention(promptRuns as any, { ...runtimeSettings, promptDebugLogs: false })[0].compiledPrompt).toBe("");

    const artifacts = helpers.parseGeneratedMaps([
      artifact({ id: "old", createdAt: "2026-07-01T00:00:00.000Z" }),
      artifact({ id: "new", createdAt: "2026-07-01T00:01:00.000Z" }),
      artifact({ id: "portrait", imageKind: "character", subjectName: "Nia", createdAt: "2026-07-01T00:02:00.000Z" }),
      artifact({ id: "card-chat-fallback", chatId: undefined, cardId: "card-rpg", createdAt: "2026-07-01T00:03:00.000Z" }),
      { bad: true },
      { id: "no-card", imageKind: "map", prompt: "bad", negativePrompt: "", provider: "x", model: "x", status: "generated", createdAt: "2026-07-01T00:04:00.000Z" },
    ]);
    expect(artifacts.map((item: any) => item.id)).toEqual(["new", "portrait", "card-chat-fallback"]);
    expect(artifacts.find((item: any) => item.id === "card-chat-fallback")?.chatId).toBe("chat_card-rpg");
    expect(helpers.normalizeGeneratedImageKind("photo")).toBe("photo");
    expect(helpers.normalizeGeneratedImageKind("bad")).toBe("map");
    expect(helpers.isGeneratedMapArtifact(artifact())).toBe(true);
    expect(helpers.isGeneratedMapArtifact(null)).toBe(false);
    expect(helpers.findGeneratedMapForChat(artifacts, "card-rpg", "missing")?.id).toBe("card-chat-fallback");
    expect(helpers.dedupeGeneratedMaps([
      artifact({ id: "same", status: "prompt-only", imageUrl: undefined }),
      artifact({ id: "same", status: "error", imageUrl: undefined, error: "failed" }),
    ])[0]).toMatchObject({ status: "error", error: "failed" });
    expect(helpers.compareGeneratedArtifactRecency(
      artifact({ id: "same", status: "generated" }),
      artifact({ id: "same", status: "prompt-only", imageUrl: undefined }),
    )).toBeGreaterThan(0);
    expect(helpers.toGeneratedImageSrc(artifact())).toContain("lc_run=artifact-1");
    expect(helpers.toGeneratedImageSrc(artifact({ imageUrl: "" }))).toBe("");
    expect(helpers.findCharacterPortraitsForCard(artifacts, "card-rpg")).toHaveLength(1);
    expect(helpers.findCharacterPortraitForEntity(artifacts, "card-rpg", { id: "missing", name: "nia" } as any)?.id).toBe("portrait");
    expect(helpers.shouldAutoGenerateCharacterPortrait({
      kind: "player",
      name: "Player Character",
      summary: "Not described yet.",
      knownFacts: [],
      doesNotKnow: [],
    } as any)).toBe(false);
    expect(helpers.shouldAutoGenerateCharacterPortrait({ kind: "character", name: "Rook" } as any)).toBe(true);
    expect(helpers.buildCharacterPortraitPrompt(rpgCard(), { name: "Rook", kind: "character", summary: "scarred scout" } as any)).toContain("scarred scout");
    expect(helpers.isComfyUiImageProviderReady(imageSettings, "ready: selected model", [imageSettings.model])).toBe(false);
    expect(helpers.isComfyUiImageProviderReady({ ...imageSettings, mode: "comfyui" }, "ready: selected model", [imageSettings.model])).toBe(true);
    expect(helpers.buildCustomImagePrompt("doorway")).toContain("plus user inputs: doorway");
  });

  it("handles provider URL guards, display parsing, lorebook conversion, and primitive coercion helpers", async () => {
    expect(helpers.getAllowedProviderBaseUrl(providerSettings({ providerId: "local", baseUrl: "http://localhost:1234/v1?q=1" }))).toBe("http://localhost:1234/v1");
    expect(helpers.getAllowedProviderBaseUrl(providerSettings({ providerId: "local", baseUrl: "not a url" }))).toBeNull();
    expect(helpers.getAllowedProviderBaseUrl(providerSettings({ providerId: "local", baseUrl: "https://example.test/v1" }))).toBeNull();
    expect(helpers.getAllowedProviderBaseUrl(providerSettings({ providerId: "openrouter", baseUrl: "https://openrouter.ai/api/v1" }))).toBe("https://openrouter.ai/api/v1");
    expect(helpers.getAllowedProviderBaseUrl(providerSettings({ providerId: "openrouter", baseUrl: "https://example.test/v1" }))).toBeNull();
    expect(helpers.getAllowedProviderBaseUrl(providerSettings({ providerId: "unknown", baseUrl: "https://example.test/v1" }))).toBeNull();
    expect(helpers.normalizeProviderBaseUrlOrNull("not a url")).toBeNull();
    expect(helpers.isLoopbackBaseUrl("bad")).toBe(false);
    expect(helpers.formatDownloadTimestamp("2026-07-01T00:00:00.000Z")).not.toContain(":");
    expect(helpers.getErrorMessage("plain")).toBe("plain");

    expect(helpers.parseAssistantMessageDisplay("Body\n\nLocation: Tower\nHealth: Fine")).toEqual({
      paragraphs: ["Body"],
      statusItems: [
        { label: "Location", value: "Tower" },
        { label: "Health", value: "Fine" },
      ],
    });
    expect(helpers.parseAssistantMessageDisplay("```status\nLocation: Tower\n```").statusItems).toEqual([
      { label: "Location", value: "Tower" },
    ]);
    expect(helpers.parseAssistantMessageDisplay("Body\n\nLocation: Tower\n\nHealth: Fine").statusItems).toEqual([]);
    expect(helpers.parseAssistantMessageDisplay("Body\n\nLocation: Tower\nOnly prose").statusItems).toEqual([]);
    expect(helpers.looksLikeStatusBlock("Weather: rain")).toBe(true);
    expect(helpers.isStatusLine("Quest: find it")).toBe(true);

    const lorebook = helpers.parseChubLorebookPayload(JSON.stringify({
      title: "Imported",
      scan_depth: "40",
      token_budget: 50,
      recursive_scanning: true,
      entries: [
        {
          comment: "Entry",
          keys: "gate, key",
          secondary_keys: ["moon"],
          content: "The gate opens.",
          insertion_order: "9",
          priority: "3",
          enabled: false,
          constant: true,
          probability: 120,
          case_sensitive: true,
          whole_word: true,
        },
        { content: "   " },
      ],
    }));
    expect(lorebook).toMatchObject({
      name: "Imported",
      scanDepth: 30,
      tokenBudget: 100,
      recursiveScanning: true,
      entries: [expect.objectContaining({ title: "Entry", keys: ["gate", "key"], probability: 100 })],
    });
    expect(() => helpers.parseChubLorebookPayload("[]")).toThrow(/invalid/i);
    expect(() => helpers.parseJsonRecordOrThrow("{", "bad json")).toThrow(/bad json/i);
    await expect(helpers.readFileAsText({ text: () => Promise.resolve("uploaded lore") } as any)).resolves.toBe("uploaded lore");
    const payload = helpers.buildChubLorebookPayload(lorebook, rpgCard());
    expect(payload.entries[0]).toMatchObject({ selective: true, content: "The gate opens." });
    expect(helpers.slugify("!!!")).toBe("lorebook");
    expect(helpers.parseList("a, b\nc")).toEqual(["a", "b", "c"]);
    expect(helpers.formatFlagsForInput({ gate_open: true, hidden: false })).toContain("hidden=false");
    expect(helpers.parseFlags("gate_open=true\n\nhidden=false\n =bad\nloose")).toEqual({
      gate_open: true,
      hidden: false,
      loose: true,
    });
    expect(helpers.titleCase("two words")).toBe("Two Words");
    expect(helpers.toBoundedNumber("bad", 7, 1, 10)).toBe(7);
    expect(helpers.toBoundedNumber(99, 7, 1, 10)).toBe(10);
    expect(helpers.toBoundedFloat("bad", 1.5, 1, 3)).toBe(1.5);
    expect(helpers.toBoundedFloat(4.2, 1.5, 1, 3)).toBe(3);
  });

  it("covers local provider response and text provider factory branches", async () => {
    expect(helpers.buildLocalProviderResponse(rpgCard(), "Surprise me with a random opening scene.", 2)).toContain(
      "2 lore entry applies",
    );
    expect(helpers.buildLocalProviderResponse(characterCard(), "Surprise me with a random opening scene.", 0)).toContain(
      "Archivist is ready",
    );
    expect(helpers.buildLocalProviderResponse(rpgCard(), "I inspect the gate.", 1)).toContain(
      "1 lore entry applies",
    );
    expect(helpers.buildLocalProviderResponse(characterCard(), "Hello", 0)).toContain(
      "Archivist answers",
    );

    expect(helpers.buildMockHiddenContinuityResponse(rpgCard(), "I am Nia near Rook in the old tower.")).toMatchObject({
      memory_updates: [expect.objectContaining({ detail: "Nia is the player character." })],
    });
    expect(helpers.buildMockExtractionProposal(rpgCard(), "I walk to the cellar and open the gate.")).toMatchObject({
      rpg_state_updates: {
        location: "Cellar",
        world_flags: { gate_open: true },
      },
    });

    expect(() =>
      helpers.createTextProvider(
        {
          mode: "openai-compatible",
          providerId: "openrouter",
          displayName: "OpenRouter",
          baseUrl: "https://example.test/v1",
          model: "qwen",
        },
        "",
        rpgCard(),
        "Hello",
        0,
      ),
    ).toThrow(/known hosted URL/i);
    const previousTauriDescriptor = Object.getOwnPropertyDescriptor(window, "__TAURI_INTERNALS__");
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    try {
      expect(() =>
        helpers.createTextProvider(
          {
            mode: "openai-compatible",
            providerId: "openrouter",
            displayName: "OpenRouter",
            baseUrl: "https://openrouter.ai/api/v1",
            model: "qwen",
          },
          "",
          rpgCard(),
          "Hello",
          0,
        ),
      ).toThrow(/OS keychain/i);
    } finally {
      if (previousTauriDescriptor) {
        Object.defineProperty(window, "__TAURI_INTERNALS__", previousTauriDescriptor);
      } else {
        delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
      }
    }

    const storedProvider = helpers.createTextProvider(
      {
        mode: "openai-compatible",
        providerId: "openrouter",
        displayName: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        model: "qwen",
        secretReference: {
          providerId: "openrouter",
          secretName: "apiKey",
          storageKind: "os-keychain",
          storageKey: "openrouter:apiKey",
          providerBaseUrl: "https://openrouter.ai/api/v1",
        },
      },
      "",
      rpgCard(),
      "Hello",
      0,
    );
    await expect(storedProvider.listModels()).resolves.toEqual([
      expect.objectContaining({ id: "qwen", providerId: "openrouter" }),
    ]);
  });

  it("derives a location proposal from the trailing status block only when extraction lacks one", () => {
    const assistantText = [
      "You step onto the docks as the lanterns flare to life.",
      "",
      "Location: Harbor town of Vessa",
      "Health: 9/10",
    ].join("\n");
    const card = { kind: "rpg", rpg: { location: "Unmapped starting area" } };

    expect(helpers.deriveStatusBlockLocationProposal(assistantText, null, card)).toBe("Harbor town of Vessa");
    expect(helpers.deriveStatusBlockLocationProposal(assistantText, "Somewhere else", card)).toBeNull();
    expect(helpers.deriveStatusBlockLocationProposal("Plain narration with no block.", null, card)).toBeNull();
    expect(helpers.deriveStatusBlockLocationProposal(assistantText, null, { kind: "character" })).toBeNull();
    expect(
      helpers.deriveStatusBlockLocationProposal(assistantText, null, {
        kind: "rpg",
        rpg: { location: "harbor town of vessa" },
      }),
    ).toBeNull();
    expect(
      helpers.deriveStatusBlockLocationProposal(
        ["Narration.", "", "Location: Not specified", "Health: 9/10"].join("\n"),
        null,
        card,
      ),
    ).toBeNull();
  });

  it("strips a trailing call-to-action question without touching dialogue or status blocks", () => {
    const content = [
      "The gate swings open onto the moonlit road.",
      "",
      "*What would you like to do next?*",
      "",
      "Location: North road",
      "Health: 9/10",
    ].join("\n");
    const stripped = helpers.stripTrailingCallToAction(content);
    expect(stripped).not.toContain("What would you like to do next");
    expect(stripped).toContain("The gate swings open");
    expect(stripped).toContain("Location: North road");

    const dialogue = ["Mira tilts her head.", "", '"What do you want from me?"'].join("\n");
    expect(helpers.stripTrailingCallToAction(dialogue)).toBe(dialogue);

    const onlyQuestion = "What do you do?";
    expect(helpers.stripTrailingCallToAction(onlyQuestion)).toBe(onlyQuestion);

    const midQuestion = ["Do you hear that? The bells ring twice.", "", "The road ahead is quiet."].join("\n");
    expect(helpers.stripTrailingCallToAction(midQuestion)).toBe(midQuestion);
  });
});
