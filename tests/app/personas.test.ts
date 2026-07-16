import { describe, expect, it } from "vitest";

import {
  NO_PERSONA_ID,
  collectActiveLorebooks,
  createPersona,
  deletePersona,
  formatPersonaPrompt,
  getActivePersona,
  parseActivePersonaId,
  parsePersonas,
  sanitizePersistedPersonas,
  updatePersona,
} from "../../src/app/personas";
import { buildResponseContract, buildTurnPromptRequest } from "../../src/app/turnPromptBuilders";
import { selectActiveLorebookEntries } from "../../src/runtime/loreTriggerEngine";
import type { Lorebook, Persona, RuntimeCard, RuntimeSettings } from "../../src/app/runtimeTypes";
import { advanceRollingSummary } from "../../src/runtime/rollingSummary";

const runtimeSettings: RuntimeSettings = {
  textStreaming: false,
  banEmojis: false,
  promptDebugLogs: false,
  diceRollsEnabled: false,
  onboardingCompleted: false,
  accentColor: "",
};

function lorebook(id: string, key: string, content: string, overrides: Partial<Lorebook> = {}): Lorebook {
  return {
    id,
    name: `${id} book`,
    enabled: true,
    scanDepth: 4,
    tokenBudget: 800,
    recursiveScanning: false,
    entries: [
      {
        id: `${id}_entry`,
        title: `${id} entry`,
        keys: [key],
        secondaryKeys: [],
        content,
        insertionOrder: 100,
        priority: 0,
        enabled: true,
        constant: false,
        probability: 100,
        caseSensitive: false,
        wholeWord: false,
      },
    ],
    ...overrides,
  };
}

function card(lorebooks: Lorebook[] = []): RuntimeCard {
  return {
    id: "card_test",
    name: "Test card",
    kind: "character",
    summary: "",
    characterName: "Test",
    characterDescription: "",
    scenario: "",
    greeting: "",
    exampleDialogs: "",
    systemPrompt: "",
    preHistoryInstructions: "",
    postHistoryInstructions: "",
    playerRules: [],
    lorebooks,
    memory: [],
    storyEntities: [],
    mapEnabled: false,
  };
}

describe("parsePersonas", () => {
  it("migrates the legacy impersonation prompt into a custom persona when none are stored", () => {
    // Arrange
    const legacyPrompt = "Speak in first person.";

    // Act
    const personas = parsePersonas(undefined, legacyPrompt);

    // Assert
    expect(personas).toHaveLength(1);
    expect(personas[0].name).toBe("My persona");
    expect(personas[0].description).toBe(legacyPrompt);
  });

  it("ignores the legacy prompt once personas exist", () => {
    // Arrange
    const stored = [{ id: "persona_mara", name: "Mara", description: "A cartographer." }];

    // Act
    const personas = parsePersonas(stored, "legacy prompt that should not win");

    // Assert
    expect(personas).toHaveLength(1);
    expect(personas[0].description).toBe("A cartographer.");
  });

  it("returns an empty roster when nothing is stored and there is no legacy prompt", () => {
    // Arrange & Act & Assert
    expect(parsePersonas(undefined)).toEqual([]);
    expect(parsePersonas([])).toEqual([]);
  });

  it("drops malformed records and dedupes ids", () => {
    // Arrange
    const stored = [
      { name: "No id" },
      "not an object",
      { id: "persona_a", name: "A" },
      { id: "persona_a", name: "Duplicate" },
      { id: "persona_b", name: "B" },
    ];

    // Act
    const personas = parsePersonas(stored);

    // Assert
    expect(personas.map((persona) => persona.id)).toEqual(["persona_a", "persona_b"]);
  });

  it("drops an empty legacy default persona but keeps custom personas", () => {
    // Arrange: the pre-"No persona" empty default really meant "no persona".
    const stored = [
      { id: "persona_default", name: "Default persona", description: "" },
      { id: "persona_mara", name: "Mara", description: "A cartographer." },
    ];

    // Act
    const personas = parsePersonas(stored);

    // Assert
    expect(personas.map((persona) => persona.id)).toEqual(["persona_mara"]);
  });

  it("keeps a legacy default that carried text, renaming it to a custom persona", () => {
    // Arrange
    const stored = [{ id: "persona_default", name: "Default persona", description: "Speak plainly." }];

    // Act
    const personas = parsePersonas(stored);

    // Assert
    expect(personas).toHaveLength(1);
    expect(personas[0].name).toBe("My persona");
    expect(personas[0].description).toBe("Speak plainly.");
  });

  it("normalizes persona lorebook entries with trigger-engine defaults", () => {
    // Arrange
    const stored = [
      {
        id: "persona_a",
        name: "A",
        lorebooks: [
          { id: "book", name: "Book", enabled: true, entries: [{ id: "e", title: "T", keys: ["k"], content: "c" }] },
        ],
      },
    ];

    // Act
    const [persona] = parsePersonas(stored);

    // Assert
    expect(persona.lorebooks[0].entries[0]).toMatchObject({ caseSensitive: false, wholeWord: false, probability: 100 });
  });
});

describe("parseActivePersonaId", () => {
  it("keeps a stored id that still resolves", () => {
    // Arrange
    const personas = parsePersonas([
      { id: "persona_a", name: "A" },
      { id: "persona_b", name: "B" },
    ]);

    // Act
    const activeId = parseActivePersonaId("persona_b", personas);

    // Assert
    expect(activeId).toBe("persona_b");
  });

  it("falls back to no persona for a dangling id", () => {
    // Arrange
    const personas = parsePersonas([
      { id: "persona_a", name: "A" },
      { id: "persona_b", name: "B" },
    ]);

    // Act
    const activeId = parseActivePersonaId("persona_deleted", personas);

    // Assert
    expect(activeId).toBe(NO_PERSONA_ID);
  });

  it("defaults to no persona when nothing is stored", () => {
    // Arrange & Act & Assert
    expect(parseActivePersonaId(undefined, [])).toBe(NO_PERSONA_ID);
  });
});

describe("persona mutations", () => {
  it("creates a persona with a generated id", () => {
    // Arrange & Act
    const persona = createPersona("  Rook  ");

    // Assert
    expect(persona.name).toBe("Rook");
    expect(persona.id).toMatch(/^persona_/);
  });

  it("updates a persona without letting the id be overwritten", () => {
    // Arrange
    const personas = parsePersonas([{ id: "persona_a", name: "A" }]);

    // Act
    const updated = updatePersona(personas, "persona_a", { name: "Renamed", id: "hacked" } as Partial<Persona>);

    // Assert
    expect(updated[0]).toMatchObject({ id: "persona_a", name: "Renamed" });
  });

  it("removes a persona by id", () => {
    // Arrange
    const personas = parsePersonas([
      { id: "persona_a", name: "A" },
      { id: "persona_b", name: "B" },
    ]);

    // Act
    const remaining = deletePersona(personas, "persona_a");

    // Assert
    expect(remaining.map((persona) => persona.id)).toEqual(["persona_b"]);
  });

  it("allows deleting the last persona, leaving an empty roster", () => {
    // Arrange
    const personas = parsePersonas([{ id: "persona_a", name: "A" }]);

    // Act
    const remaining = deletePersona(personas, "persona_a");

    // Assert
    expect(remaining).toEqual([]);
  });
});

describe("getActivePersona", () => {
  it("returns null when the active id is unknown", () => {
    // Arrange
    const personas = parsePersonas([
      { id: "persona_a", name: "A" },
      { id: "persona_b", name: "B" },
    ]);

    // Act & Assert
    expect(getActivePersona(personas, "persona_missing")).toBeNull();
  });

  it("returns null for the no-persona sentinel", () => {
    // Arrange
    const personas = parsePersonas([{ id: "persona_a", name: "A" }]);

    // Act & Assert
    expect(getActivePersona(personas, NO_PERSONA_ID)).toBeNull();
  });

  it("returns the matching persona for a valid id", () => {
    // Arrange
    const personas = parsePersonas([{ id: "persona_a", name: "A" }]);

    // Act & Assert
    expect(getActivePersona(personas, "persona_a")?.id).toBe("persona_a");
  });
});

describe("formatPersonaPrompt", () => {
  it("returns an empty string when there is no persona", () => {
    // Arrange & Act & Assert
    expect(formatPersonaPrompt(null)).toBe("");
  });

  it("includes the persona name and description for a named persona", () => {
    // Arrange
    const [persona] = parsePersonas([{ id: "persona_mara", name: "Mara", description: "A careful cartographer." }]);

    // Act
    const prompt = formatPersonaPrompt(persona);

    // Assert
    expect(prompt).toBe("The player is playing as Mara.\nA careful cartographer.");
  });
});

describe("buildResponseContract", () => {
  it("keeps persona data out of the trusted response contract", () => {
    const contract = buildResponseContract(runtimeSettings);

    expect(contract).not.toContain("impersonation/persona prompt");
  });

  it("places the active persona in untrusted card context", () => {
    // Arrange
    const [persona] = parsePersonas([{ id: "persona_mara", name: "Mara", description: "A careful cartographer." }]);

    // Act
    const request = buildTurnPromptRequest(card(), [], [], "I check the map.", runtimeSettings, persona);

    // Assert
    expect(request.card?.userPersona).toContain("The player is playing as Mara.");
    expect(request.card?.userPersona).toContain("A careful cartographer.");
    expect(request.responseContract).not.toContain("Mara");
    expect(request.responseContract).not.toContain("A careful cartographer.");
  });

  it("injects a branch-scoped rolling summary and uses local semantic retrieval without a model call", () => {
    const runtimeCard: RuntimeCard = {
      ...card(),
      memory: [
        { id: "memory-healer", label: "Field care", detail: "The healer tends serious wounds." },
        { id: "memory-weather", label: "Weather", detail: "Rain falls over the old map." },
      ],
    };
    const history = [{ id: "message-old", role: "user" as const, content: "I arrived at Blackglass Harbor." }];
    const rollingSummary = advanceRollingSummary({
      previous: null,
      messages: history,
      scope: { cardId: runtimeCard.id, chatId: "chat-a", branchId: "branch-a" },
      retainRecentMessages: 0,
      maxCharacters: 500,
      now: "2026-07-12T12:00:00.000Z",
    }) ?? undefined;
    const request = buildTurnPromptRequest(
      runtimeCard,
      [],
      history,
      "The doctor treats my injury.",
      runtimeSettings,
      null,
      {
        retrievalContext: {
          chatId: "chat-a",
          branchId: "branch-a",
          rollingSummary,
        },
      },
    );

    expect(request.memoryEntries?.[0].id).toBe("rolling-summary:message-old");
    expect(request.memoryEntries?.[1].id).toBe("memory-healer");
    expect(request.memoryEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "rolling-summary:message-old", detail: expect.stringContaining("Blackglass Harbor") }),
    ]));
  });

  it("does not relabel another branch's persisted memory as current", () => {
    const runtimeCard: RuntimeCard = {
      ...card(),
      memory: [
        {
          id: "global",
          label: "Gate",
          detail: "The harbor gate is sealed.",
          retrievalScope: { level: "card-global" },
          visibility: "narrator",
        },
        {
          id: "other-branch",
          label: "Secret",
          detail: "The harbor gate code is 991.",
          retrievalScope: { level: "branch", chatId: "chat-other", branchId: "branch-other" },
          visibility: "narrator",
        },
      ],
    };

    const request = buildTurnPromptRequest(
      runtimeCard,
      [],
      [],
      "I inspect the harbor gate.",
      runtimeSettings,
      null,
      { retrievalContext: { chatId: "chat-current", branchId: "branch-current" } },
    );

    expect(request.memoryEntries?.map((entry) => entry.id)).toEqual(["global"]);
  });
});

describe("collectActiveLorebooks", () => {
  it("returns only card lorebooks when there is no active persona", () => {
    // Arrange
    const cardBook = lorebook("card_book", "gate", "The gate remembers.");

    // Act
    const lorebooks = collectActiveLorebooks(card([cardBook]), null);

    // Assert
    expect(lorebooks).toEqual([cardBook]);
  });

  it("fires persona lore entries alongside card lore entries", () => {
    // Arrange
    const cardBook = lorebook("card_book", "gate", "The gate remembers every oath.");
    const personaBook = lorebook("persona_book", "coast", "I grew up on the coast.");
    const [persona] = parsePersonas([{ id: "persona_mara", name: "Mara", lorebooks: [personaBook] }]);

    // Act
    const active = selectActiveLorebookEntries({
      lorebooks: collectActiveLorebooks(card([cardBook]), persona),
      messages: [{ content: "We reach the gate." }],
      draft: "I mention the coast.",
    });

    // Assert
    expect(active.map((entry) => entry.id).sort()).toEqual(["card_book_entry", "persona_book_entry"]);
  });

  it("skips a disabled persona lorebook", () => {
    // Arrange
    const personaBook = lorebook("persona_book", "coast", "I grew up on the coast.", { enabled: false });
    const [persona] = parsePersonas([{ id: "persona_mara", name: "Mara", lorebooks: [personaBook] }]);

    // Act
    const active = selectActiveLorebookEntries({
      lorebooks: collectActiveLorebooks(card(), persona),
      messages: [],
      draft: "I mention the coast.",
    });

    // Assert
    expect(active).toEqual([]);
  });
});

describe("sanitizePersistedPersonas", () => {
  it("returns undefined for non-array input", () => {
    // Arrange & Act & Assert
    expect(sanitizePersistedPersonas(undefined)).toBeUndefined();
    expect(sanitizePersistedPersonas({ id: "persona_a" })).toBeUndefined();
  });

  it("strips unknown keys (including the legacy default flag) and rejects non-image avatar payloads", () => {
    // Arrange
    const stored = [
      {
        id: "persona_a",
        name: "A",
        description: "text",
        isDefault: true,
        avatarDataUrl: "javascript:alert(1)",
        secretToken: "sk-should-not-persist",
      },
    ];

    // Act
    const sanitized = sanitizePersistedPersonas(stored);

    // Assert
    expect(sanitized).toEqual([{ id: "persona_a", name: "A", description: "text", lorebooks: [] }]);
  });

  it("keeps a valid base64 image avatar", () => {
    // Arrange
    const avatarDataUrl = "data:image/png;base64,iVBORw0KGgo=";

    // Act
    const sanitized = sanitizePersistedPersonas([{ id: "persona_a", name: "A", avatarDataUrl }]);

    // Assert
    expect(sanitized?.[0].avatarDataUrl).toBe(avatarDataUrl);
  });

  it("drops avatar data urls that exceed the persistence budget", () => {
    // Arrange: base64 payload large enough that the SQLite text cap would reject the save.
    const avatarDataUrl = `data:image/png;base64,${"A".repeat(200_000)}`;

    // Act
    const sanitized = sanitizePersistedPersonas([{ id: "persona_a", name: "A", avatarDataUrl }]);

    // Assert
    expect(sanitized?.[0].avatarDataUrl).toBeUndefined();
  });
});
