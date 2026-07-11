import { describe, expect, it } from "vitest";

import {
  DEFAULT_LORE_SCAN_SCOPES,
  getLoreScanScopes,
  parseLoreMatchMode,
  parseLoreScanScopes,
  selectActiveLorebookEntries,
  validateLoreKeys,
  type LoreTriggerBook,
  type LoreTriggerEntry,
} from "../../src/runtime/loreTriggerEngine";

function entry(overrides: Partial<LoreTriggerEntry> & Pick<LoreTriggerEntry, "id" | "keys">): LoreTriggerEntry {
  return {
    title: overrides.id,
    secondaryKeys: [],
    content: `content for ${overrides.id}`,
    insertionOrder: 100,
    priority: 0,
    enabled: true,
    constant: false,
    probability: 100,
    ...overrides,
  };
}

function bookOf(entries: LoreTriggerEntry[], overrides: Partial<LoreTriggerBook> = {}): LoreTriggerBook {
  return { id: "book", enabled: true, scanDepth: 4, tokenBudget: 1000, recursiveScanning: false, entries, ...overrides };
}

const lorebook: LoreTriggerBook = {
  id: "book",
  enabled: true,
  scanDepth: 2,
  tokenBudget: 1000,
  recursiveScanning: false,
  entries: [
    {
      id: "gate",
      title: "Ancient Gate",
      keys: ["gate"],
      secondaryKeys: ["oath"],
      content: "The gate opens only for the remembered oath.",
      insertionOrder: 100,
      priority: 5,
      enabled: true,
      constant: false,
      probability: 100,
    },
    {
      id: "location",
      title: "Starting Area",
      keys: ["unmapped starting area"],
      secondaryKeys: [],
      content: "The starting area has not been mapped yet.",
      insertionOrder: 50,
      priority: 1,
      enabled: true,
      constant: false,
      probability: 100,
    },
  ],
};

describe("lore trigger engine", () => {
  it("uses primary and secondary keys when selecting entries", () => {
    const active = selectActiveLorebookEntries({
      lorebooks: [lorebook],
      messages: [{ content: "The old oath is carved nearby." }],
      draft: "I inspect the gate.",
    });

    expect(active.map((entry) => entry.id)).toEqual(["gate"]);
  });

  it("can trigger from RPG context such as current location", () => {
    const active = selectActiveLorebookEntries({
      lorebooks: [lorebook],
      messages: [],
      draft: "I look around.",
      context: { currentLocation: "Unmapped starting area" },
    });

    expect(active.map((entry) => entry.id)).toEqual(["location"]);
  });

  it("does not include a first lore entry that exceeds the lorebook token budget", () => {
    const active = selectActiveLorebookEntries({
      lorebooks: [
        {
          ...lorebook,
          tokenBudget: 10,
          entries: [
            {
              id: "huge",
              title: "Huge Gate Lore",
              keys: ["gate"],
              secondaryKeys: [],
              content: "oversized lore ".repeat(20),
              insertionOrder: 1,
              priority: 100,
              enabled: true,
              constant: false,
              probability: 100,
            },
            {
              id: "small",
              title: "Small Gate Lore",
              keys: ["gate"],
              secondaryKeys: [],
              content: "small lore",
              insertionOrder: 2,
              priority: 1,
              enabled: true,
              constant: false,
              probability: 100,
            },
          ],
        },
      ],
      messages: [],
      draft: "The gate opens.",
    });

    expect(active.map((entry) => entry.id)).toEqual(["small"]);
  });
});

describe("match modes", () => {
  it("matches a wildcard key across the words it spans", () => {
    // Arrange
    const lorebooks = [bookOf([entry({ id: "gate", keys: ["silver * gate"], matchMode: "wildcard" })])];

    // Act
    const active = selectActiveLorebookEntries({
      lorebooks,
      messages: [],
      draft: "I approach the silver filigreed gate.",
    });

    // Assert
    expect(active.map((item) => item.id)).toEqual(["gate"]);
  });

  it("treats ? as exactly one character in wildcard mode", () => {
    // Arrange
    const lorebooks = [bookOf([entry({ id: "cat", keys: ["c?t"], matchMode: "wildcard" })])];

    // Act
    const matched = selectActiveLorebookEntries({ lorebooks, messages: [], draft: "a cat sits" });
    const unmatched = selectActiveLorebookEntries({ lorebooks, messages: [], draft: "a coat sits" });

    // Assert
    expect(matched.map((item) => item.id)).toEqual(["cat"]);
    expect(unmatched).toEqual([]);
  });

  it("does not let literal keys be read as patterns", () => {
    // Arrange
    const lorebooks = [bookOf([entry({ id: "cost", keys: ["c*t"] })])];

    // Act
    const active = selectActiveLorebookEntries({ lorebooks, messages: [], draft: "a cat sits" });

    // Assert
    expect(active).toEqual([]);
  });

  it("matches a regex key with word boundaries and honors case sensitivity", () => {
    // Arrange
    const insensitive = [bookOf([entry({ id: "gate", keys: ["\\bsilver\\s+gates?\\b"], matchMode: "regex" })])];
    const sensitive = [
      bookOf([entry({ id: "gate", keys: ["\\bSilver\\b"], matchMode: "regex", caseSensitive: true })]),
    ];

    // Act
    const matched = selectActiveLorebookEntries({ lorebooks: insensitive, messages: [], draft: "The SILVER GATES." });
    const missed = selectActiveLorebookEntries({ lorebooks: sensitive, messages: [], draft: "the silver gate" });

    // Assert
    expect(matched.map((item) => item.id)).toEqual(["gate"]);
    expect(missed).toEqual([]);
  });

  it("never matches an invalid regex instead of throwing", () => {
    // Arrange
    const lorebooks = [bookOf([entry({ id: "broken", keys: ["([unclosed"], matchMode: "regex" })])];

    // Act
    const active = selectActiveLorebookEntries({ lorebooks, messages: [], draft: "[unclosed" });

    // Assert
    expect(active).toEqual([]);
  });

  it("refuses a catastrophic regex from an imported lorebook rather than hanging", () => {
    // Arrange: (a+)+$ against a long non-matching string is the classic ReDoS.
    const lorebooks = [bookOf([entry({ id: "redos", keys: ["(a+)+$"], matchMode: "regex" })])];
    const draft = `${"a".repeat(40)}!`;

    // Act
    const startedAt = Date.now();
    const active = selectActiveLorebookEntries({ lorebooks, messages: [], draft });

    // Assert
    expect(active).toEqual([]);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });
});

describe("validateLoreKeys", () => {
  it("accepts any literal key", () => {
    expect(validateLoreKeys(["(a+)+$", "([unclosed"], "literal")).toBeNull();
  });

  it("rejects an invalid regex", () => {
    expect(validateLoreKeys(["([unclosed"], "regex")).toMatch(/invalid/i);
  });

  it("rejects a nested quantifier", () => {
    expect(validateLoreKeys(["(a+)+"], "regex")).toMatch(/hang the app/i);
    expect(validateLoreKeys(["(a|a)*"], "regex")).toMatch(/hang the app/i);
  });

  it("rejects an over-long pattern", () => {
    expect(validateLoreKeys(["a".repeat(201)], "wildcard")).toMatch(/longer than 200/i);
  });

  it("accepts a well-formed regex", () => {
    expect(validateLoreKeys(["\\bsilver\\s+gates?\\b"], "regex")).toBeNull();
  });
});

describe("scan scopes", () => {
  const sources = {
    cardDefinition: "Character name: Vell\nDescription:\nA silver-haired archivist.",
    personaDescription: "I am Mara, who grew up on the storm coast.",
    memoryEntries: ["Player character: Mara owes a debt to the guild."],
  };

  it("defaults to history, draft, and rpg state", () => {
    // Arrange & Act & Assert
    expect(getLoreScanScopes(entry({ id: "e", keys: ["k"] }))).toEqual(DEFAULT_LORE_SCAN_SCOPES);
  });

  it("does not scan the card definition unless the card scope is selected", () => {
    // Arrange
    const defaulted = [bookOf([entry({ id: "archivist", keys: ["archivist"] })])];
    const scoped = [bookOf([entry({ id: "archivist", keys: ["archivist"], scanScopes: ["card"] })])];

    // Act
    const withoutScope = selectActiveLorebookEntries({ lorebooks: defaulted, messages: [], draft: "", sources });
    const withScope = selectActiveLorebookEntries({ lorebooks: scoped, messages: [], draft: "", sources });

    // Assert
    expect(withoutScope).toEqual([]);
    expect(withScope.map((item) => item.id)).toEqual(["archivist"]);
  });

  it("scans the active persona and card memory when those scopes are selected", () => {
    // Arrange
    const lorebooks = [
      bookOf([
        entry({ id: "coast", keys: ["storm coast"], scanScopes: ["persona"] }),
        entry({ id: "debt", keys: ["debt to the guild"], scanScopes: ["memory"] }),
      ]),
    ];

    // Act
    const active = selectActiveLorebookEntries({ lorebooks, messages: [], draft: "", sources });

    // Assert
    expect(active.map((item) => item.id).sort()).toEqual(["coast", "debt"]);
  });

  it("ignores the draft when an entry only scans chat history", () => {
    // Arrange
    const lorebooks = [bookOf([entry({ id: "gate", keys: ["gate"], scanScopes: ["history"] })])];

    // Act
    const fromDraft = selectActiveLorebookEntries({ lorebooks, messages: [], draft: "I open the gate." });
    const fromHistory = selectActiveLorebookEntries({
      lorebooks,
      messages: [{ content: "The gate stands open." }],
      draft: "",
    });

    // Assert
    expect(fromDraft).toEqual([]);
    expect(fromHistory.map((item) => item.id)).toEqual(["gate"]);
  });

  it("still feeds recursively triggered content to a scoped entry", () => {
    // Arrange
    const lorebooks = [
      bookOf(
        [
          entry({ id: "gate", keys: ["gate"], content: "The gate was forged from moonsteel.", scanScopes: ["draft"] }),
          entry({ id: "moonsteel", keys: ["moonsteel"], scanScopes: ["draft"] }),
        ],
        { recursiveScanning: true },
      ),
    ];

    // Act
    const active = selectActiveLorebookEntries({ lorebooks, messages: [], draft: "I open the gate." });

    // Assert
    expect(active.map((item) => item.id).sort()).toEqual(["gate", "moonsteel"]);
  });
});

describe("parse helpers", () => {
  it("falls back to literal for an unknown match mode", () => {
    expect(parseLoreMatchMode("fuzzy")).toBe("literal");
    expect(parseLoreMatchMode("regex")).toBe("regex");
  });

  it("drops unknown scopes and returns undefined when nothing survives", () => {
    expect(parseLoreScanScopes(["card", "nonsense"])).toEqual(["card"]);
    expect(parseLoreScanScopes(["nonsense"])).toBeUndefined();
    expect(parseLoreScanScopes("card")).toBeUndefined();
  });

  it("returns scopes in a canonical order regardless of stored order", () => {
    expect(parseLoreScanScopes(["rpg", "history"])).toEqual(["history", "rpg"]);
  });
});
