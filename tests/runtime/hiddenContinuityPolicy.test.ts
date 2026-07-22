import { describe, expect, it } from "vitest";

import {
  MEMORY_EVIDENCE_RECENT_MESSAGE_COUNT,
  resolveHiddenContinuityPlan,
} from "../../src/runtime/hiddenContinuityPolicy";

describe("two-call memory policy", () => {
  it("uses one call while the complete transcript fits inside the tested recent window", () => {
    expect(
      resolveHiddenContinuityPlan({
        mode: "evidence-brief",
        selectedModel: "primary-model",
        messageCount: MEMORY_EVIDENCE_RECENT_MESSAGE_COUNT,
      }),
    ).toEqual({
      mode: "evidence-brief",
      expectedCallCount: 1,
      recentMessageCount: MEMORY_EVIDENCE_RECENT_MESSAGE_COUNT,
      visibleModel: "primary-model",
    });
  });

  it("uses the same selected model for an evidence brief only when older messages fall outside the window", () => {
    expect(
      resolveHiddenContinuityPlan({
        mode: "evidence-brief",
        selectedModel: "primary-model",
        messageCount: MEMORY_EVIDENCE_RECENT_MESSAGE_COUNT + 1,
      }),
    ).toEqual({
      mode: "evidence-brief",
      expectedCallCount: 2,
      analysisModel: "primary-model",
      recentMessageCount: MEMORY_EVIDENCE_RECENT_MESSAGE_COUNT,
      visibleModel: "primary-model",
    });
  });

  it("makes the off mode perform only the ordinary visible call regardless of history length", () => {
    expect(
      resolveHiddenContinuityPlan({
        mode: "off",
        selectedModel: "primary-model",
        messageCount: 200,
      }),
    ).toEqual({
      mode: "off",
      expectedCallCount: 1,
      recentMessageCount: MEMORY_EVIDENCE_RECENT_MESSAGE_COUNT,
      visibleModel: "primary-model",
    });
  });

  it("migrates legacy two-call modes to the sole evidence-brief behavior without economical routing", () => {
    expect(
      resolveHiddenContinuityPlan({
        mode: "economical",
        selectedModel: "primary-model",
        economicalModel: "old-small-model",
        messageCount: 20,
      }),
    ).toMatchObject({
      mode: "evidence-brief",
      analysisModel: "primary-model",
      visibleModel: "primary-model",
    });
  });
});
