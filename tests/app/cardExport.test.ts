import { describe, expect, it } from "vitest";

import { buildTavernCardJson, buildTavernCardPng } from "../../src/app/cardExport";
import { extractTavernJsonFromPng, parseTavernCardJson } from "../../src/app/cardImport";
import type { RuntimeCard } from "../../src/app/runtimeTypes";

const card: RuntimeCard = {
  id: "card-export",
  name: "Mara",
  kind: "character",
  summary: "A careful cartographer.",
  characterName: "Mara",
  characterDescription: "A careful cartographer.",
  scenario: "At the old gate.",
  greeting: "The road bends north.",
  exampleDialogs: "{{user}}: Where now?\n{{char}}: North.",
  systemPrompt: "Stay in character.",
  preHistoryInstructions: "",
  postHistoryInstructions: "Keep continuity.",
  playerRules: [],
  lorebooks: [{
    id: "lore-1",
    name: "Road lore",
    enabled: true,
    scanDepth: 4,
    tokenBudget: 800,
    recursiveScanning: false,
    entries: [{
      id: "entry-1",
      title: "Gate",
      keys: ["gate"],
      secondaryKeys: [],
      content: "The gate is ancient.",
      insertionOrder: 10,
      priority: 1,
      enabled: true,
      constant: false,
      probability: 100,
      matchMode: "literal",
    }],
  }],
  memory: [],
  storyEntities: [],
  mapEnabled: false,
  alternateGreetings: ["Another road awaits."],
  creatorNotes: "Export test",
  tags: ["adventure"],
  creator: "Local user",
  characterVersion: "2.0",
};

describe("Tavern card export", () => {
  it("round-trips character fields and embedded lore through V2 JSON", () => {
    const parsed = parseTavernCardJson(buildTavernCardJson(card));
    expect(parsed).toMatchObject({
      spec: "chara_card_v2",
      name: "Mara",
      description: "A careful cartographer.",
      scenario: "At the old gate.",
      firstMessage: "The road bends north.",
      alternateGreetings: ["Another road awaits."],
    });
    expect(parsed.characterBook?.entries).toHaveLength(1);
  });

  it("embeds the same V2 payload in a valid Tavern PNG", () => {
    const png = buildTavernCardPng(card);
    const embedded = extractTavernJsonFromPng(png);
    expect(embedded).not.toBeNull();
    expect(parseTavernCardJson(embedded ?? "").name).toBe("Mara");
  });
});
