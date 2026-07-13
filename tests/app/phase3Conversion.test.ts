import { describe, expect, it } from "vitest";
import {
  CREATION_TEMPLATES,
  MOCK_DEMO_MESSAGES,
  PLAYABLE_SAMPLE_RPG,
  applyCreationTemplate,
} from "../../src/app/starterContent";
import { getReadinessChecklist } from "../../src/app/readiness";
import { filterAndSortCards } from "../../src/app/libraryControls";
import {
  LOCAL_PROVIDER_CANDIDATES,
  buildLocalProviderSettings,
  parseOpenAIModelList,
  probeLocalProviderCandidates,
} from "../../src/app/localProviderDiscovery";
import {
  MAX_LOREBOOK_IMPORT_ENTRIES,
  parseCompatibleLorebookPayload,
} from "../../src/app/lorebookIo";
import {
  buildChatExportPayload,
  createChatSession,
  getCardChats,
  renameChatSession,
  setChatArchived,
} from "../../src/app/chatSessions";
import type { RuntimeCard } from "../../src/app/runtimeTypes";

function card(overrides: Partial<RuntimeCard> = {}): RuntimeCard {
  return {
    ...PLAYABLE_SAMPLE_RPG,
    id: "card_test",
    name: "Test Card",
    tags: [],
    favorite: false,
    archived: false,
    ...overrides,
  };
}

describe("Phase 3 starter experience", () => {
  it("ships a genuinely playable sample RPG and a local-only mock opening", () => {
    expect(PLAYABLE_SAMPLE_RPG.kind).toBe("rpg");
    expect(PLAYABLE_SAMPLE_RPG.greeting.length).toBeGreaterThan(80);
    expect(PLAYABLE_SAMPLE_RPG.playerRules.length).toBeGreaterThanOrEqual(4);
    expect(PLAYABLE_SAMPLE_RPG.lorebooks[0]?.entries.length).toBeGreaterThanOrEqual(4);
    expect(PLAYABLE_SAMPLE_RPG.rpg?.location).not.toMatch(/unmapped|not configured/i);
    expect(PLAYABLE_SAMPLE_RPG.rpg?.quests.length).toBeGreaterThan(0);
    expect(MOCK_DEMO_MESSAGES).toHaveLength(0);
  });

  it("offers three creation templates without mutating their source definitions", () => {
    expect(CREATION_TEMPLATES).toHaveLength(3);
    expect(new Set(CREATION_TEMPLATES.map((template) => template.id)).size).toBe(3);
    const first = applyCreationTemplate(CREATION_TEMPLATES[0].id);
    first.name = "Changed";
    expect(applyCreationTemplate(CREATION_TEMPLATES[0].id).name).not.toBe("Changed");
    expect(first.systemPrompt.trim()).not.toBe("");
  });

  it("reports actionable readiness without requiring a paid provider", () => {
    const checklist = getReadinessChecklist({
      cards: [PLAYABLE_SAMPLE_RPG],
      activeCardId: PLAYABLE_SAMPLE_RPG.id,
      providerSettings: {
        mode: "mock",
        providerId: "mock",
        displayName: "Mock local runtime",
        baseUrl: "",
        model: "mock-narrator",
      },
    });
    expect(checklist.every((item) => item.ready)).toBe(true);
    expect(checklist.map((item) => item.id)).toEqual(["playable-content", "active-card", "text-provider"]);
  });
});

describe("Phase 3 library and chat controls", () => {
  it("searches tags and ranks favorites while hiding archived cards by default", () => {
    const cards = [
      card({ id: "plain", name: "Quiet Harbor", tags: ["mystery"] }),
      card({ id: "favorite", name: "Ashfall", tags: ["survival"], favorite: true }),
      card({ id: "archived", name: "Old Mystery", tags: ["mystery"], archived: true }),
    ];
    expect(filterAndSortCards(cards, { query: "", tag: "", favoritesOnly: false, includeArchived: false }).map((item) => item.id))
      .toEqual(["favorite", "plain"]);
    expect(filterAndSortCards(cards, { query: "mystery", tag: "mystery", favoritesOnly: false, includeArchived: true }).map((item) => item.id))
      .toEqual(["archived", "plain"]);
  });

  it("renames, archives, filters, and exports chats without losing history", () => {
    const original = createChatSession("card_test", "Original", {
      id: "chat_test",
      messages: [{ id: "m1", role: "user", content: "Hello" }],
    });
    const renamed = renameChatSession(original, "  Expedition log  ", "2026-07-13T10:00:00.000Z");
    const archived = setChatArchived(renamed, true, "2026-07-13T10:01:00.000Z");
    expect(archived).toMatchObject({ title: "Expedition log", archived: true });
    expect(archived.messages).toEqual(original.messages);
    expect(getCardChats("card_test", [archived])).toEqual([]);
    expect(getCardChats("card_test", [archived], { includeArchived: true })).toHaveLength(1);
    expect(buildChatExportPayload(archived, card())).toMatchObject({
      format: "local-first-rpg-chat",
      version: 1,
      card: { id: "card_test", name: "Test Card" },
      chat: { id: "chat_test", title: "Expedition log", archived: true },
    });
  });
});

describe("Phase 3 local provider discovery", () => {
  it("only contains fixed loopback OpenAI-compatible candidates", () => {
    expect(LOCAL_PROVIDER_CANDIDATES.map((candidate) => candidate.id)).toEqual([
      "ollama",
      "lm-studio",
      "llama-cpp",
      "koboldcpp",
    ]);
    for (const candidate of LOCAL_PROVIDER_CANDIDATES) {
      const url = new URL(candidate.modelsUrl);
      expect(["127.0.0.1", "localhost", "[::1]"]).toContain(url.hostname);
      expect(url.pathname).toBe("/v1/models");
    }
  });

  it("bounds and sanitizes model-list responses", () => {
    const payload = {
      data: [
        { id: "qwen3:8b" },
        { id: "qwen3:8b" },
        { id: "  llama-3.2  " },
        { id: "x".repeat(161) },
        { id: "bad\nmodel" },
        { nope: "ignored" },
      ],
    };
    expect(parseOpenAIModelList(payload)).toEqual(["qwen3:8b", "llama-3.2"]);
  });

  it("isolates failed probes and builds a keyless local provider selection", async () => {
    const detections = await probeLocalProviderCandidates(async (candidate) => {
      if (candidate.id === "lm-studio") return { data: [{ id: "local-model" }] };
      throw new Error("not running");
    });
    expect(detections).toHaveLength(1);
    expect(buildLocalProviderSettings(detections[0], "local-model")).toMatchObject({
      mode: "openai-compatible",
      providerId: "local",
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "local-model",
    });
  });
});

describe("Phase 3 compatible lorebook imports", () => {
  it("imports SillyTavern object entries and preserves explicit substring compatibility", () => {
    const lorebook = parseCompatibleLorebookPayload(JSON.stringify({
      name: "SillyTavern World Info",
      entries: {
        "0": {
          uid: 7,
          comment: "The Gate",
          key: ["gate"],
          keysecondary: ["oath"],
          content: "The old gate remembers every oath.",
          order: 120,
          disable: false,
          constant: false,
          caseSensitive: true,
          matchWholeWords: false,
          probability: 75,
        },
      },
    }));
    expect(lorebook.entries[0]).toMatchObject({
      title: "The Gate",
      keys: ["gate"],
      secondaryKeys: ["oath"],
      enabled: true,
      insertionOrder: 120,
      probability: 75,
      caseSensitive: true,
      literalMatchBehavior: "substring",
    });
  });

  it("unwraps Character Card books and rejects unbounded entry collections", () => {
    const wrapped = parseCompatibleLorebookPayload(JSON.stringify({
      spec: "chara_card_v3",
      data: {
        character_book: {
          name: "Risu-compatible book",
          entries: [{ keys: ["captain"], content: "The captain keeps the brass key." }],
        },
      },
    }));
    expect(wrapped.entries).toHaveLength(1);

    const tooMany = Array.from({ length: MAX_LOREBOOK_IMPORT_ENTRIES + 1 }, (_, index) => ({
      keys: [`key-${index}`],
      content: "bounded",
    }));
    expect(() => parseCompatibleLorebookPayload(JSON.stringify({ entries: tooMany }))).toThrow(/too many lorebook entries/i);
  });
});
