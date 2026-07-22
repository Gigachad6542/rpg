import { describe, expect, it } from "vitest";

import { buildTurnPromptRequest } from "../../src/app/turnPromptBuilders";
import { compileTurnPrompt } from "../../src/runtime/turnPipeline";
import type { RuntimeCard, RuntimeSettings } from "../../src/app/runtimeTypes";

const exampleDialogs = [
  "Player: I inspect the observatory door.",
  "Sera: Fresh charcoal marks the lock, but the hinges are untouched.",
  "",
  "Player: Can you tend this wound?",
  "Sera: Hold still. The bandage will buy us time, not a miracle.",
].join("\n");

const card: RuntimeCard = {
  id: "card-ashfall",
  name: "Ashfall",
  kind: "character",
  summary: "A mountain mystery.",
  characterName: "Sera",
  characterDescription: "A direct, observant warden.",
  scenario: "The observatory is sealed.",
  greeting: "State your business.",
  exampleDialogs,
  systemPrompt: "Keep the mystery grounded.",
  preHistoryInstructions: "",
  postHistoryInstructions: "",
  playerRules: [],
  lorebooks: [],
  memory: [],
  storyEntities: [],
  mapEnabled: false,
};

const settings: RuntimeSettings = {
  textStreaming: false,
  banEmojis: false,
  promptDebugLogs: false,
  diceRollsEnabled: false,
  onboardingCompleted: true,
  accentColor: "",
};

describe("dialogue example prompting", () => {
  it("preserves legacy all-example prompting when the setting is absent", () => {
    const request = buildTurnPromptRequest(card, [], [], "I wait.", settings);

    expect(request.card?.characterDefinition).toContain(`Example dialogs:\n${exampleDialogs}`);
    expect(request.card?.dialogueExamples).toBe("");
  });

  it("moves only relevant examples into an optional prompt layer", () => {
    const request = buildTurnPromptRequest(
      card,
      [],
      [],
      "I study the charcoal around the observatory lock.",
      { ...settings, dialogueExampleMode: "selective" },
      null,
      { retrievalContext: { chatId: "chat-a", branchId: "branch-a" } },
    );
    const compiled = compileTurnPrompt(request);
    const layer = compiled.includedLayers.find((candidate) => candidate.kind === "dialogueExamples");

    expect(request.card?.characterDefinition).not.toContain("Example dialogs:");
    expect(request.card?.dialogueExamples).toContain("observatory door");
    expect(request.card?.dialogueExamples).not.toContain("tend this wound");
    expect(layer).toMatchObject({ required: false, allowTrimming: true });
  });

  it("omits examples completely when the user turns them off", () => {
    const request = buildTurnPromptRequest(card, [], [], "I wait.", {
      ...settings,
      dialogueExampleMode: "off",
    });
    const compiled = compileTurnPrompt(request);

    expect(request.card?.characterDefinition).not.toContain("Example dialogs:");
    expect(request.card?.dialogueExamples).toBe("");
    expect(compiled.includedLayers.some((layer) => layer.kind === "dialogueExamples")).toBe(false);
  });
});
