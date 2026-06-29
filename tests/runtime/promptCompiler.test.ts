import { describe, expect, it } from "vitest";

import { compilePrompt } from "../../src/runtime/promptCompiler";
import { estimateTextTokens, trimTextToTokenLimit } from "../../src/runtime/tokenBudget";

describe("prompt compiler", () => {
  it("compiles known prompt layers in the runtime order regardless of input order", () => {
    const compiled = compilePrompt({
      layers: [
        { id: "latest", kind: "latestUserMessage", content: "Open the threshold." },
        { id: "character", kind: "characterDefinition", content: "The guide keeps user-created boundaries." },
        { id: "post", kind: "postHistoryInstructions", content: "After history, keep the next action grounded." },
        { id: "pre", kind: "preHistoryInstructions", content: "Before history, apply the card's setup." },
        { id: "global", kind: "globalRuntimeRules", content: "The local app owns continuity truth." },
        { id: "contract", kind: "finalResponseContract", content: "Return narrative prose only." },
        { id: "social", kind: "socialExpectation", content: "Ask for the next grounded action." },
      ],
      includeLayerLabels: false,
    });

    expect(compiled.includedLayers.map((layer) => layer.kind)).toEqual([
      "globalRuntimeRules",
      "characterDefinition",
      "preHistoryInstructions",
      "socialExpectation",
      "latestUserMessage",
      "postHistoryInstructions",
      "finalResponseContract",
    ]);
    expect(compiled.prompt.indexOf("local app owns")).toBeLessThan(compiled.prompt.indexOf("guide"));
    expect(compiled.prompt.indexOf("guide")).toBeLessThan(compiled.prompt.indexOf("Before history"));
    expect(compiled.prompt.indexOf("Before history")).toBeLessThan(compiled.prompt.indexOf("grounded"));
    expect(compiled.prompt.indexOf("grounded")).toBeLessThan(compiled.prompt.indexOf("Open"));
    expect(compiled.prompt.indexOf("Open")).toBeLessThan(compiled.prompt.indexOf("After history"));
  });

  it("trims trimmable layers to stay inside the input token budget", () => {
    const compiled = compilePrompt({
      layers: [
        { id: "global", kind: "globalRuntimeRules", content: "RULES" },
        {
          id: "history",
          kind: "recentChatHistory",
          content: "0123456789 ".repeat(20),
          allowTrimming: true,
        },
        { id: "latest", kind: "latestUserMessage", content: "NEXT" },
      ],
      tokenBudget: { maxInputTokens: 80 },
      estimator: (text) => text.length,
      includeLayerLabels: false,
    });

    expect(compiled.tokenEstimate).toBeLessThanOrEqual(80);
    expect(compiled.truncatedLayerIds).toEqual(["history"]);
    expect(compiled.prompt).toContain("RULES");
    expect(compiled.prompt).toContain("NEXT");
    expect(compiled.prompt).not.toContain("0123456789 ".repeat(20));
  });

  it("throws instead of silently returning an over-budget prompt when required layers cannot fit", () => {
    expect(() =>
      compilePrompt({
        layers: [
          { id: "global", kind: "globalRuntimeRules", content: "REQUIRED GLOBAL" },
          { id: "latest", kind: "latestUserMessage", content: "REQUIRED USER MESSAGE" },
          { id: "contract", kind: "finalResponseContract", content: "REQUIRED CONTRACT" },
        ],
        tokenBudget: { maxInputTokens: 10 },
        estimator: (text) => text.length,
        includeLayerLabels: false,
      }),
    ).toThrow(/prompt exceeds token budget/i);
  });
});

describe("token budget utilities", () => {
  it("estimates empty text as zero tokens and trims oversized text", () => {
    expect(estimateTextTokens("")).toBe(0);

    const trimmed = trimTextToTokenLimit("abcdefghijklmnopqrstuvwxyz", 10, (text) => text.length);

    expect(trimmed.wasTrimmed).toBe(true);
    expect(trimmed.text).toHaveLength(10);
    expect(trimmed.estimatedTokens).toBe(10);
  });
});
