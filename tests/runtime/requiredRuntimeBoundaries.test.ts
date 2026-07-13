import { describe, expect, it } from "vitest";

import { TURN_PIPELINE_LAYER_IDS, compileTurnPrompt } from "../../src/runtime/turnPipeline";

describe("required runtime boundaries", () => {
  it("keeps deterministic mode rules and knowledge boundaries when optional context must be omitted", () => {
    const compiled = compileTurnPrompt({
      session: { id: "session", mode: "rpg" },
      messages: [{ id: "user", role: "user", content: "I open the gate." }],
      latestUserMessage: "I open the gate.",
      rules: [{ id: "inventory", description: "Inventory is authoritative." }],
      knowledgeBoundaries: "Rook does not know the hidden password.",
      memoryEntries: [
        { id: "oversized-memory", text: "Optional memory. ".repeat(1_000) },
      ],
      tokenBudget: { maxInputTokens: 1_000, reservedOutputTokens: 100 },
    });

    expect(
      compiled.includedLayers.find((layer) => layer.id === TURN_PIPELINE_LAYER_IDS.modeRules),
    ).toMatchObject({ required: true });
    expect(
      compiled.includedLayers.find((layer) => layer.id === TURN_PIPELINE_LAYER_IDS.knowledgeBoundaries),
    ).toMatchObject({ required: true });
    expect([
      ...compiled.omittedLayers.map((layer) => layer.id),
      ...compiled.truncatedLayerIds,
    ]).toContain(TURN_PIPELINE_LAYER_IDS.longTermMemory);
  });

  it("fails closed when the required boundaries cannot fit at all", () => {
    expect(() =>
      compileTurnPrompt({
        session: { id: "session", mode: "rpg" },
        messages: [{ id: "user", role: "user", content: "Continue." }],
        latestUserMessage: "Continue.",
        rules: [{ id: "safety", description: "Never invent inventory. ".repeat(30) }],
        knowledgeBoundaries: "Never expose narrator-only knowledge. ".repeat(30),
        tokenBudget: { maxInputTokens: 120, reservedOutputTokens: 100 },
      }),
    ).toThrow(/required prompt layer/i);
  });
});
