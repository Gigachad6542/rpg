import { describe, expect, it } from "vitest";

import {
  buildRuntimeCardFromTavern,
  extractPngTextChunks,
  extractTavernJsonFromPng,
  fetchChubCharacterCard,
  importCardFromJsonText,
  importCardFromPngBytes,
  parseChubReference,
  parseTavernCardJson,
} from "../../src/app/cardImport";

// --- helpers ---------------------------------------------------------------

function latin1Bytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 0xff;
  }
  return bytes;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, data.length, false);
  return concatBytes(length, latin1Bytes(type), data, new Uint8Array(4) /* CRC (unchecked) */);
}

/** Builds a minimal PNG carrying one tEXt chunk `keyword` -> base64(json). */
function makeCardPng(chunks: Record<string, string>): Uint8Array {
  const signature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const textChunks = Object.entries(chunks).map(([keyword, json]) => {
    const base64 = Buffer.from(json, "utf8").toString("base64");
    return pngChunk("tEXt", concatBytes(latin1Bytes(keyword), Uint8Array.from([0]), latin1Bytes(base64)));
  });
  return concatBytes(signature, ...textChunks, pngChunk("IEND", new Uint8Array(0)));
}

function sampleV2Card(): string {
  return JSON.stringify({
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: "Aria",
      description: "A wandering cartographer.",
      personality: "Curious and precise.",
      scenario: "A rainy port town.",
      first_mes: "You find me sketching the harbor.",
      mes_example: "<START>\n{{user}}: hi\n{{char}}: Well met.",
      system_prompt: "Stay in character as Aria.",
      post_history_instructions: "Keep replies grounded.",
      creator_notes: "Best with a slow-burn scenario.",
      creator: "mapmaker",
      character_version: "1.2",
      alternate_greetings: ["The market is loud today.", "You catch me mid-argument with a gull."],
      tags: ["adventure", "slow-burn"],
      character_book: {
        name: "Aria world",
        scan_depth: 6,
        token_budget: 900,
        recursive_scanning: true,
        entries: [
          { keys: ["harbor"], content: "The harbor smells of tar and salt.", enabled: true, insertion_order: 10 },
          { keys: ["gull"], secondary_keys: ["argue"], content: "The gulls here are notorious thieves." },
        ],
      },
    },
  });
}

// --- JSON parsing ----------------------------------------------------------

describe("parseTavernCardJson", () => {
  it("parses a v2 card with a data object", () => {
    const card = parseTavernCardJson(sampleV2Card());
    expect(card.spec).toBe("chara_card_v2");
    expect(card.name).toBe("Aria");
    expect(card.personality).toBe("Curious and precise.");
    expect(card.firstMessage).toBe("You find me sketching the harbor.");
    expect(card.alternateGreetings).toHaveLength(2);
    expect(card.tags).toEqual(["adventure", "slow-burn"]);
    expect(card.creator).toBe("mapmaker");
    expect(card.characterBook).toBeDefined();
  });

  it("parses a flat v1 card", () => {
    const json = JSON.stringify({ name: "Bex", description: "A tired sailor.", first_mes: "Ahoy." });
    const card = parseTavernCardJson(json);
    expect(card.spec).toBe("v1");
    expect(card.name).toBe("Bex");
    expect(card.firstMessage).toBe("Ahoy.");
  });

  it("throws when the JSON is not a character card", () => {
    expect(() => parseTavernCardJson(JSON.stringify({ foo: 1 }))).toThrow(/character card/i);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseTavernCardJson("not json")).toThrow();
  });
});

// --- mapping to runtime card ----------------------------------------------

describe("buildRuntimeCardFromTavern", () => {
  it("maps fields, merges personality, and imports the embedded lorebook", () => {
    const normalized = parseTavernCardJson(sampleV2Card());
    const { card, warnings } = buildRuntimeCardFromTavern(normalized, { cardId: "card_test", source: "tavern-json" });

    expect(card.id).toBe("card_test");
    expect(card.kind).toBe("character");
    expect(card.characterName).toBe("Aria");
    expect(card.characterDescription).toContain("A wandering cartographer.");
    expect(card.characterDescription).toContain("Personality: Curious and precise.");
    expect(card.greeting).toBe("You find me sketching the harbor.");
    expect(card.systemPrompt).toBe("Stay in character as Aria.");
    expect(card.postHistoryInstructions).toBe("Keep replies grounded.");
    expect(card.alternateGreetings).toHaveLength(2);
    expect(card.tags).toEqual(["adventure", "slow-burn"]);
    expect(card.creator).toBe("mapmaker");
    expect(card.creatorNotes).toBe("Best with a slow-burn scenario.");
    expect(card.importSource).toBe("tavern-json");

    expect(card.lorebooks).toHaveLength(1);
    expect(card.lorebooks[0].scanDepth).toBe(6);
    expect(card.lorebooks[0].recursiveScanning).toBe(true);
    expect(card.lorebooks[0].entries).toHaveLength(2);
    expect(card.lorebooks[0].entries[1].secondaryKeys).toEqual(["argue"]);

    expect(warnings.join(" ")).toMatch(/embedded lorebook \(2 entries\)/);
    expect(warnings.join(" ")).toMatch(/alternate greeting/);
    expect(warnings.join(" ")).toMatch(/Personality/);
  });

  it("falls back to a default name and generates an id", () => {
    const normalized = parseTavernCardJson(JSON.stringify({ description: "no name here" }));
    const { card } = buildRuntimeCardFromTavern(normalized);
    expect(card.name).toBe("Imported Character");
    expect(card.id).toMatch(/^card_/);
  });
});

describe("importCardFromJsonText", () => {
  it("runs the full JSON pipeline with a supplied id", () => {
    const { card } = importCardFromJsonText(sampleV2Card(), { cardId: "card_json" });
    expect(card.id).toBe("card_json");
    expect(card.importSource).toBe("tavern-json");
    expect(card.name).toBe("Aria");
  });
});

// --- PNG extraction --------------------------------------------------------

describe("PNG extraction", () => {
  it("reads tEXt chunks and prefers ccv3 over chara", () => {
    const png = makeCardPng({ chara: sampleV2Card(), ccv3: JSON.stringify({ data: { name: "V3 Aria" } }) });
    const chunks = extractPngTextChunks(png);
    expect(Object.keys(chunks).sort()).toEqual(["ccv3", "chara"]);

    const json = extractTavernJsonFromPng(png);
    expect(json).toContain("V3 Aria");
  });

  it("imports a card straight from PNG bytes", () => {
    const png = makeCardPng({ chara: sampleV2Card() });
    const { card, warnings } = importCardFromPngBytes(png, { cardId: "card_png" });
    expect(card.id).toBe("card_png");
    expect(card.name).toBe("Aria");
    expect(card.importSource).toBe("tavern-png");
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("throws when a PNG carries no character data", () => {
    const png = makeCardPng({ note: "just a comment" });
    expect(() => importCardFromPngBytes(png)).toThrow(/No character data/i);
  });

  it("throws for non-PNG bytes", () => {
    expect(() => extractPngTextChunks(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/not a valid PNG/i);
  });
});

// --- Chub helper -----------------------------------------------------------

describe("parseChubReference", () => {
  it("parses full character URLs", () => {
    expect(parseChubReference("https://chub.ai/characters/mapmaker/aria")?.fullPath).toBe("mapmaker/aria");
    expect(parseChubReference("https://www.chub.ai/characters/mapmaker/aria")?.fullPath).toBe("mapmaker/aria");
  });

  it("accepts a bare author/name path", () => {
    expect(parseChubReference("mapmaker/aria")?.fullPath).toBe("mapmaker/aria");
  });

  it("returns null for junk", () => {
    expect(parseChubReference("")).toBeNull();
    expect(parseChubReference("just-a-word")).toBeNull();
  });
});

describe("fetchChubCharacterCard", () => {
  it("downloads a PNG and imports it via injected fetch", async () => {
    const png = makeCardPng({ chara: sampleV2Card() });
    const fakeFetch = (async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
    })) as unknown as typeof fetch;

    const { card } = await fetchChubCharacterCard("mapmaker/aria", { fetch: fakeFetch, cardId: "card_chub" });
    expect(card.id).toBe("card_chub");
    expect(card.importSource).toBe("chub");
    expect(card.name).toBe("Aria");
  });

  it("throws when the download fails", async () => {
    const fakeFetch = (async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) })) as unknown as typeof fetch;
    await expect(fetchChubCharacterCard("mapmaker/aria", { fetch: fakeFetch })).rejects.toThrow(/Chub download failed/i);
  });

  it("rejects an unparseable reference", async () => {
    await expect(fetchChubCharacterCard("nonsense")).rejects.toThrow(/Chub character URL/i);
  });
});
