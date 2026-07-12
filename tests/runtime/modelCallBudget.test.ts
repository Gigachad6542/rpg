import { describe, expect, it } from "vitest";

import { resolveModelCallBudget } from "../../src/runtime/modelCallBudget";

describe("model call budget", () => {
  it("uses a conservative fallback for an unknown local model", () => {
    expect(
      resolveModelCallBudget({
        providerId: "local",
        model: "unknown-local-model",
        phase: "visible-response",
      }),
    ).toEqual({
      effectiveContextWindowTokens: 16_000,
      inputBudgetTokens: 14_588,
      maxOutputTokens: 900,
      safetyReserveTokens: 512,
      source: "conservative-fallback",
    });
  });

  it("uses the same conservative fallback for unknown hosted models", () => {
    const local = resolveModelCallBudget({
      providerId: "local",
      model: "unknown-local-model",
      phase: "visible-response",
    });
    const hosted = resolveModelCallBudget({
      providerId: "openrouter",
      model: "vendor/unknown-model",
      phase: "visible-response",
    });

    expect(hosted).toEqual(local);
  });

  it("caps large advertised context windows and reserves the hidden-call output", () => {
    expect(
      resolveModelCallBudget({
        providerId: "alibaba-model-studio",
        model: "qwen3.7-max",
        phase: "hidden-continuity",
        modelInfo: {
          id: "qwen3.7-max",
          displayName: "Qwen3.7-Max",
          providerId: "alibaba-model-studio",
          contextWindow: 262_144,
          maxOutputTokens: 8_192,
        },
      }),
    ).toEqual({
      effectiveContextWindowTokens: 32_000,
      inputBudgetTokens: 29_688,
      maxOutputTokens: 1_800,
      safetyReserveTokens: 512,
      source: "model-metadata",
    });
  });
});
