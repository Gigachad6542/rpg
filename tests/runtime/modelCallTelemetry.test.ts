import { describe, expect, it } from "vitest";

import {
  calculateModelCallCost,
  classifyModelCallFailure,
  resolveModelPricing,
} from "../../src/runtime/modelCallTelemetry";

describe("model-call telemetry", () => {
  it("calculates immutable per-call USD cost from an explicit price snapshot", () => {
    const pricing = Object.freeze({
      model: "priced-model",
      currency: "USD" as const,
      inputUsdPerMillionTokens: 1,
      outputUsdPerMillionTokens: 2,
      source: "test fixture",
      effectiveDate: "2026-07-01",
    });

    expect(
      calculateModelCallCost(
        { inputTokens: 1_000, outputTokens: 500, totalTokens: 1_500 },
        pricing,
      ),
    ).toEqual({
      status: "known",
      currency: "USD",
      amountUsd: 0.002,
      pricing,
    });
  });

  it("reports unknown pricing rather than inventing zero cost", () => {
    expect(
      calculateModelCallCost(
        { inputTokens: 1_000, outputTokens: 500, totalTokens: 1_500 },
        undefined,
      ),
    ).toEqual({ status: "unknown", currency: "USD" });
  });

  it("recognizes zero-cost mock calls and rejects a snapshot for another model", () => {
    expect(resolveModelPricing({ providerId: "mock", model: "mock-narrator" })).toMatchObject({
      model: "mock-narrator",
      inputUsdPerMillionTokens: 0,
      outputUsdPerMillionTokens: 0,
      source: "built-in mock provider",
    });
    expect(
      resolveModelPricing({
        providerId: "openrouter",
        model: "selected-model",
        pricing: {
          model: "another-model",
          currency: "USD",
          inputUsdPerMillionTokens: 1,
          outputUsdPerMillionTokens: 2,
          source: "user configured",
          effectiveDate: "2026-07-01",
        },
      }),
    ).toBeUndefined();
  });

  it.each([
    [new DOMException("Stopped", "AbortError"), "aborted"],
    [new Error("401 unauthorized"), "authentication"],
    [new Error("429 rate limit"), "rate-limit"],
    [new Error("network connection failed"), "network"],
    [new Error("invalid request payload"), "validation"],
    [new Error("provider unavailable"), "provider"],
  ] as const)("classifies %s without persisting secret-bearing error bodies", (error, category) => {
    expect(classifyModelCallFailure(error)).toEqual({
      category,
      message: expect.not.stringContaining("Bearer "),
    });
  });
});
