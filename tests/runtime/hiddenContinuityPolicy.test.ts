import { describe, expect, it } from "vitest";

import { resolveHiddenContinuityPlan } from "../../src/runtime/hiddenContinuityPolicy";

describe("hidden continuity call policy", () => {
  it("preserves the two-call full-continuity default", () => {
    expect(
      resolveHiddenContinuityPlan({
        mode: "full",
        selectedModel: "primary-model",
      }),
    ).toEqual({
      mode: "full",
      expectedCallCount: 2,
      hiddenModel: "primary-model",
      visibleModel: "primary-model",
    });
  });

  it("uses the explicitly configured economical model for the hidden call", () => {
    expect(
      resolveHiddenContinuityPlan({
        mode: "economical",
        selectedModel: "primary-model",
        economicalModel: "  economical-model  ",
      }),
    ).toEqual({
      mode: "economical",
      expectedCallCount: 2,
      hiddenModel: "economical-model",
      visibleModel: "primary-model",
    });
  });

  it("makes the off mode honestly perform only the visible call", () => {
    expect(
      resolveHiddenContinuityPlan({
        mode: "off",
        selectedModel: "primary-model",
      }),
    ).toEqual({
      mode: "off",
      expectedCallCount: 1,
      visibleModel: "primary-model",
    });
  });

  it("fails closed instead of silently using the full model for an incomplete economical configuration", () => {
    expect(() =>
      resolveHiddenContinuityPlan({
        mode: "economical",
        selectedModel: "primary-model",
        economicalModel: "  ",
      }),
    ).toThrow(/economical model/i);
  });
});
