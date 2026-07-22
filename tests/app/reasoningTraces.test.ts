import { describe, expect, it } from "vitest";

import {
  addReasoningTrace,
  MAX_SESSION_REASONING_TRACES,
  type ModelReasoningTraceMap,
} from "../../src/app/reasoningTraces";

describe("session reasoning traces", () => {
  it("keeps only the newest bounded set of private traces", () => {
    let traces: ModelReasoningTraceMap = {};
    for (let index = 0; index <= MAX_SESSION_REASONING_TRACES; index += 1) {
      traces = addReasoningTrace(traces, `run-${index}:visible-response`, {
        trace: `private-${index}`,
        format: "text",
        encrypted: false,
      });
    }

    expect(Object.keys(traces)).toHaveLength(MAX_SESSION_REASONING_TRACES);
    expect(traces["run-0:visible-response"]).toBeUndefined();
    expect(traces[`run-${MAX_SESSION_REASONING_TRACES}:visible-response`]?.trace).toBe(
      `private-${MAX_SESSION_REASONING_TRACES}`,
    );
  });

  it("replaces an existing trace without evicting another run", () => {
    const original: ModelReasoningTraceMap = {
      "run-1:visible-response": { trace: "old", format: "text", encrypted: false },
      "run-2:visible-response": { trace: "other", format: "text", encrypted: false },
    };

    const updated = addReasoningTrace(original, "run-1:visible-response", {
      trace: "new",
      format: "summary",
      encrypted: false,
    });

    expect(Object.keys(updated)).toHaveLength(2);
    expect(updated["run-1:visible-response"]?.trace).toBe("new");
    expect(updated["run-2:visible-response"]?.trace).toBe("other");
  });
});
