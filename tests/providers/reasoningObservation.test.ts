import { describe, expect, it } from "vitest";

import {
  extractReasoningObservation,
  mergeReasoningObservations,
} from "../../src/providers/reasoningObservation";

describe("reasoning observation boundary", () => {
  it("reports encrypted reasoning without pretending a viewable trace exists", () => {
    expect(extractReasoningObservation({
      choices: [{
        message: {
          reasoning_details: [{
            type: "reasoning.encrypted",
            data: "opaque-provider-value",
            format: "unknown",
            id: "encrypted-1",
          }],
        },
      }],
      usage: { completion_tokens_details: { reasoning_tokens: 32 } },
    })).toEqual({
      format: "encrypted",
      encrypted: true,
      tokenCount: 32,
    });
  });

  it("ignores invalid accounting and bounds provider-controlled trace text", () => {
    const observation = extractReasoningObservation({
      choices: [{ message: { reasoning: "x".repeat(70_000) } }],
      usage: { completion_tokens_details: { reasoning_tokens: -1 } },
    });

    expect(observation?.trace).toHaveLength(64_000);
    expect(observation).not.toHaveProperty("tokenCount");
  });

  it("merges streamed trace fragments while using the terminal token count", () => {
    expect(mergeReasoningObservations(
      { trace: "First. ", format: "text", encrypted: false },
      { trace: "Second.", format: "summary", encrypted: false, tokenCount: 14 },
    )).toEqual({
      trace: "First. Second.",
      format: "mixed",
      encrypted: false,
      tokenCount: 14,
    });
  });
});
