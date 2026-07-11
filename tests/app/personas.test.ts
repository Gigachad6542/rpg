import { describe, expect, it } from "vitest";

import {
  DEFAULT_PERSONA_ID,
  collectActiveLorebooks,
  createPersona,
  deletePersona,
  formatPersonaPrompt,
  getActivePersona,
  parseActivePersonaId,
  parsePersonas,
  sanitizePersistedPersonas,
  setDefaultPersona,
  updatePersona,
} from "../../src/app/personas";
import { buildResponseContract } from "../../src/app/turnPromptBuilders";
import { selectActiveLorebookEntries } from "../../src/runtime/loreTriggerEngine";
import type { Lorebook, Persona, RuntimeCard, RuntimeSettings } from "../../src/app/runtimeTypes";

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
  it("migrates the legacy impersonation prompt into a default persona when none are stored", () => {
    // Arrange
    const legacyPrompt = "Speak in first person.";

    // Act
    const personas = parsePersonas(undefined, legacyPrompt);

    // Assert
    expect(personas).toHaveLength(1);
    expect(personas[0].id).toBe(DEFAULT_PERSONA_ID);
    expect(personas[0].description).toBe(legacyPrompt);
    expect(personas[0].isDefault).toBe(true);
  });

  it("ignores the legacy prompt once personas exist", () => {
    // Arrange
    const stored = [{ id: "persona_mara", name: "Mara", description: "A cartographer.", isDefault: true }];

    // Act
    const personas = parsePersonas(stored, "legacy prompt that should not win");

    // Assert
    expect(personas).toHaveLength(1);
    expect(personas[0].description).toBe("A cartographer.");
  });

  it("drops malformed records, dedupes ids, and keeps exactly one default", () => {
    // Arrange
    const stored = [
      { name: "No id" },
      "not an object",
      { id: "persona_a", name: "A", isDefault: true },
      { id: "persona_a", name: "Duplicate", isDefault: true },
      { id: "persona_b", name: "B", isDefault: true },
    ];

    // Act
    const personas = parsePersonas(stored);

    // Assert
    expect(personas.map((persona) => persona.id)).toEqual(["persona_a", "persona_b"]);
    expect(personas.filter((persona) => persona.isDefault)).toHaveLength(1);
    expect(personas[0].isDefault).toBe(true);
  });

  it("promotes the first persona to default when nothing is flagged", () => {
    // Arrange
    const stored = [
      { id: "persona_a", name: "A" },
      { id: "persona_b", name: "B" },
    ];

    // Act
    const personas = parsePersonas(stored);

    // Assert
    expect(personas[0].isDefault).toBe(true);
    expect(personas[1].isDefault).toBe(false);
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

  it("falls back to the default persona for a dangling id", () => {
    // Arrange
    const personas = parsePersonas([
      { id: "persona_a", name: "A" },
      { id: "persona_b", name: "B", isDefault: true },
    ]);

    // Act
    const activeId = parseActivePersonaId("persona_deleted", personas);

    // Assert
    expect(activeId).toBe("persona_b");
  });
});

describe("persona mutations", () => {
  it("creates a non-default persona with a generated id", () => {
    // Arrange & Act
    const persona = createPersona("  Rook  ");

    // Assert
    expect(persona.name).toBe("Rook");
    expect(persona.isDefault).toBe(false);
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

  it("moves the default flag to a survivor when the default persona is deleted", () => {
    // Arrange
    const personas = parsePersonas([
      { id: "persona_a", name: "A", isDefault: true },
      { id: "persona_b", name: "B" },
    ]);

    // Act
    const remaining = deletePersona(personas, "persona_a");

    // Assert
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ id: "persona_b", isDefault: true });
  });

  it("refuses to delete the last persona", () => {
    // Arrange
    const personas = parsePersonas([{ id: "persona_a", name: "A" }]);

    // Act
    const remaining = deletePersona(personas, "persona_a");

    // Assert
    expect(remaining).toEqual(personas);
  });

  it("keeps a single default when a new one is chosen", () => {
    // Arrange
    const personas = parsePersonas([
      { id: "persona_a", name: "A", isDefault: true },
      { id: "persona_b", name: "B" },
    ]);

    // Act
    const updated = setDefaultPersona(personas, "persona_b");

    // Assert
    expect(updated.filter((persona) => persona.isDefault).map((persona) => persona.id)).toEqual(["persona_b"]);
  });
});

describe("getActivePersona", () => {
  it("falls back to the first persona when the active id is unknown", () => {
    // Arrange
    const personas = parsePersonas([
      { id: "persona_a", name: "A" },
      { id: "persona_b", name: "B" },
    ]);

    // Act
    const active = getActivePersona(personas, "persona_missing");

    // Assert
    expect(active?.id).toBe("persona_a");
  });
});

describe("formatPersonaPrompt", () => {
  it("returns an empty string for an unnamed, empty default persona", () => {
    // Arrange
    const [persona] = parsePersonas(undefined, "");

    // Act & Assert
    expect(formatPersonaPrompt(persona)).toBe("");
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
  it("omits the persona clause when no persona text is set", () => {
    // Arrange
    const [persona] = parsePersonas(undefined, "");

    // Act
    const contract = buildResponseContract(runtimeSettings, persona);

    // Assert
    expect(contract).not.toContain("impersonation/persona prompt");
  });

  it("injects the active persona prompt", () => {
    // Arrange
    const [persona] = parsePersonas([{ id: "persona_mara", name: "Mara", description: "A careful cartographer." }]);

    // Act
    const contract = buildResponseContract(runtimeSettings, persona);

    // Assert
    expect(contract).toContain("Account for this user impersonation/persona prompt without speaking as the user:");
    expect(contract).toContain("The player is playing as Mara.");
    expect(contract).toContain("A careful cartographer.");
  });
});

describe("collectActiveLorebooks", () => {
  it("returns only card lorebooks when the persona has none", () => {
    // Arrange
    const cardBook = lorebook("card_book", "gate", "The gate remembers.");
    const [persona] = parsePersonas(undefined, "");

    // Act
    const lorebooks = collectActiveLorebooks(card([cardBook]), persona);

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

  it("strips unknown keys and rejects non-image avatar payloads", () => {
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
    expect(sanitized).toEqual([{ id: "persona_a", name: "A", description: "text", isDefault: true, lorebooks: [] }]);
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
