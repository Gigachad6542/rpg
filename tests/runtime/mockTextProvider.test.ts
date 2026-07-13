import { describe, expect, it } from "vitest";

import { MockTextProvider } from "../../src/providers/mockTextProvider";
import { qwen37MaxReferencePreset } from "../../src/providers/modelPresets";

describe("mock text provider", () => {
  it("lists non-secret model metadata including the Qwen reference preset", async () => {
    const provider = new MockTextProvider();

    const models = await provider.listModels();

    expect(models).toContainEqual(qwen37MaxReferencePreset);
    expect(models.some((model) => "apiKey" in model)).toBe(false);
  });

  it("returns a deterministic scripted response and usage estimate", async () => {
    const provider = new MockTextProvider({
      responses: ["The runtime asks which local rule should govern entry."],
    });

    const response = await provider.generateText({
      model: "mock-narrator",
      prompt: "The threshold opens.",
      temperature: 0.2,
    });

    expect(response.text).toBe("The runtime asks which local rule should govern entry.");
    expect(response.model).toBe("mock-narrator");
    expect(response.providerId).toBe("mock");
    expect(response.usage.inputTokens).toBeGreaterThan(0);
    expect(response.usage.outputTokens).toBeGreaterThan(0);
    expect(response.usageSource).toBe("estimated");
  });
});
