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

  it.each([
    "request failed with token=ghp_abcdefghijklmnopqrstuvwxyz123456",
    "request failed with sessionToken=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.signature",
    "request failed with clientSecret=super-private-client-value",
    "request failed with AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE",
    "request failed with privateKey=-----BEGIN_PRIVATE_KEY-----abc123-----END_PRIVATE_KEY-----",
  ])("redacts common non-OpenAI credential formats from failure telemetry", (message) => {
    const failure = classifyModelCallFailure(new Error(message));

    expect(failure.message).not.toMatch(/ghp_|eyJhbGci|super-private|AKIA|BEGIN_PRIVATE_KEY|abc123/i);
    expect(failure.message).toMatch(/REDACTED/);
  });
});
