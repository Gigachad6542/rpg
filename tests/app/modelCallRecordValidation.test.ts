import { describe, expect, it } from "vitest";

import { parsePersistedModelCallRecords } from "../../src/app/modelCallRecordValidation";

const validCall = {
  phase: "visible-response",
  provider: "openrouter",
  model: "priced-model",
  usage: { inputTokens: 1_000, outputTokens: 500, totalTokens: 1_500 },
  durationMs: 12,
  status: "success",
  usageSource: "provider",
  cost: {
    status: "known",
    currency: "USD",
    amountUsd: 0.002,
    pricing: {
      model: "priced-model",
      currency: "USD",
      inputUsdPerMillionTokens: 1,
      outputUsdPerMillionTokens: 2,
      source: "test fixture",
      effectiveDate: "2026-07-01",
    },
  },
  stateProposalCount: 0,
} as const;

describe("persisted model-call validation", () => {
  it("accepts telemetry whose usage and immutable price snapshot reconcile", () => {
    expect(parsePersistedModelCallRecords([validCall])).toEqual([validCall]);
  });

  it("accepts a nontrivial runtime cost rounded with the canonical USD rule", () => {
    const roundedRuntimeCall = {
      ...validCall,
      usage: { inputTokens: 123, outputTokens: 57, totalTokens: 180 },
      cost: {
        ...validCall.cost,
        amountUsd: 0.000853333,
        pricing: {
          ...validCall.cost.pricing,
          inputUsdPerMillionTokens: 3.333333,
          outputUsdPerMillionTokens: 7.777777,
        },
      },
    };

    expect(parsePersistedModelCallRecords([roundedRuntimeCall])).toEqual([roundedRuntimeCall]);
  });

  it.each([
    ["token total", { ...validCall, usage: { ...validCall.usage, totalTokens: 9_999 } }],
    ["cost amount", { ...validCall, cost: { ...validCall.cost, amountUsd: 99 } }],
    ["pricing model", { ...validCall, cost: { ...validCall.cost, pricing: { ...validCall.cost.pricing, model: "other-model" } } }],
    ["secret failure", {
      ...validCall,
      status: "error",
      failure: { category: "authentication", message: "token=ghp_abcdefghijklmnopqrstuvwxyz123456" },
    }],
  ])("rejects an inconsistent or unsafe %s", (_label, call) => {
    expect(parsePersistedModelCallRecords([call])).toBeUndefined();
  });
});
