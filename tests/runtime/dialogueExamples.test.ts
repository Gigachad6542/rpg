import { describe, expect, it } from "vitest";

import {
  formatDialogueExamplePrompt,
  parseDialogueExamples,
  selectDialogueExamples,
} from "../../src/runtime/dialogueExamples";

describe("dialogue examples", () => {
  const rawExamples = [
    "Player: I inspect the observatory door.",
    "Sera: Fresh charcoal marks the lock, but the hinges are untouched.",
    "",
    "Player: Can you tend this wound?",
    "Sera: Hold still. The bandage will buy us time, not a miracle.",
    "",
    "Player: I ask about the river route.",
    "Sera: Longer, quieter, and flooded wherever the red ash has settled.",
  ].join("\n");

  it("parses common player/character pairs into bounded examples", () => {
    const examples = parseDialogueExamples(rawExamples);

    expect(examples).toHaveLength(3);
    expect(examples[0]).toMatchObject({
      id: "dialogue-example-1",
      userText: "I inspect the observatory door.",
      assistantText: "Fresh charcoal marks the lock, but the hinges are untouched.",
    });
    expect(examples[1].text).toContain("Can you tend this wound?");
  });

  it("supports Tavern START blocks and template speaker names", () => {
    const examples = parseDialogueExamples(
      "<START>\n{{user}}: Who are you?\n{{char}}: The last honest warden.\n<START>\n{{user}}: Open the gate.\n{{char}}: Give me one reason.",
    );

    expect(examples).toHaveLength(2);
    expect(examples[1].userText).toBe("Open the gate.");
    expect(examples[1].assistantText).toBe("Give me one reason.");
  });

  it("selects the scene-relevant exchange instead of injecting every example", () => {
    const selected = selectDialogueExamples({
      rawExamples,
      query: "I study the charcoal around the observatory lock.",
      cardId: "card-ashfall",
      maxExamples: 1,
      maxCharacters: 1_000,
    });

    expect(selected).toHaveLength(1);
    expect(selected[0].text).toContain("observatory door");
    expect(selected[0].text).not.toContain("river route");
  });

  it("falls back to one style anchor when no example matches the scene", () => {
    const selected = selectDialogueExamples({
      rawExamples,
      query: "A completely unrelated greeting.",
      cardId: "card-ashfall",
      maxExamples: 3,
      maxCharacters: 1_000,
    });

    expect(selected).toHaveLength(1);
    expect(selected[0].id).toBe("dialogue-example-1");
  });

  it("labels selected examples as style guidance rather than story facts", () => {
    const prompt = formatDialogueExamplePrompt(parseDialogueExamples(rawExamples).slice(0, 1));

    expect(prompt).toContain("style and interaction demonstrations only");
    expect(prompt).toContain("Do not treat their events as current story continuity");
    expect(prompt).toContain("Example 1");
  });
});
