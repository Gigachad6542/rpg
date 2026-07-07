import { describe, expect, it } from "vitest";

import type {
  ModelInfo,
  TextGenerationRequest,
  TextGenerationResponse,
  TextModelAdapter,
} from "../../src/providers/TextModelAdapter";
import {
  buildMemoryConsolidationPrompt,
  parseMemoryConsolidationResponse,
  runMemoryConsolidation,
  runMemoryConsolidationSafely,
  type ConsolidationMemoryEntry,
} from "../../src/runtime/memoryConsolidation";

class StubAdapter implements TextModelAdapter {
  readonly id = "stub";
  readonly displayName = "Stub";
  readonly requests: TextGenerationRequest[] = [];

  constructor(private readonly text: string) {}

  async listModels(): Promise<ModelInfo[]> {
    return [];
  }

  async generateText(request: TextGenerationRequest): Promise<TextGenerationResponse> {
    this.requests.push(request);
    return {
      providerId: this.id,
      model: request.model,
      text: this.text,
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    };
  }
}

class ThrowingAdapter implements TextModelAdapter {
  readonly id = "throwing";
  readonly displayName = "Throwing";
  async listModels(): Promise<ModelInfo[]> {
    return [];
  }
  async generateText(): Promise<TextGenerationResponse> {
    throw new Error("provider rejected consolidation sk-secret-should-be-redacted");
  }
}

function entries(count: number): ConsolidationMemoryEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `m${index}`,
    label: "Fact",
    detail: `Detail number ${index}`,
  }));
}

describe("memory consolidation", () => {
  it("prompts with rules and the current memory", () => {
    const prompt = buildMemoryConsolidationPrompt([{ label: "Route", detail: "Player is based in the north." }]);
    expect(prompt).toContain("memory archivist");
    expect(prompt).toContain("Merge duplicate or overlapping entries");
    expect(prompt).toContain("- Route: Player is based in the north.");
  });

  it("parses, cleans, and deduplicates the consolidated memory", () => {
    const parsed = parseMemoryConsolidationResponse(
      [
        "prose before",
        "```json",
        JSON.stringify({
          memory: [
            { label: "Base", detail: "The player is based in the north." },
            { detail: "  The player is based in the north.  " },
            { label: "", detail: "" },
            { label: "Ally", detail: "Rook is a trusted guide." },
          ],
        }),
        "```",
      ].join("\n"),
      { now: () => "2026-07-05T00:00:00.000Z", randomId: () => "abc123" },
    );

    expect(parsed).toEqual([
      { id: expect.stringMatching(/^memory_/), label: "Base", detail: "The player is based in the north." },
      { id: expect.stringMatching(/^memory_/), label: "Ally", detail: "Rook is a trusted guide." },
    ]);
  });

  it("replaces memory only when the model returns a strictly smaller set", async () => {
    const adapter = new StubAdapter(
      JSON.stringify({ memory: [{ label: "Base", detail: "Player is based in the north." }] }),
    );
    const result = await runMemoryConsolidation({ modelAdapter: adapter, model: "m", entries: entries(6) });

    expect(result.changed).toBe(true);
    expect(result.entries).toHaveLength(1);
    expect(adapter.requests[0].metadata).toMatchObject({ memoryConsolidationPass: true });
  });

  it("skips the model call when there is too little to consolidate", async () => {
    const adapter = new StubAdapter("{}");
    const result = await runMemoryConsolidation({ modelAdapter: adapter, model: "m", entries: entries(2) });

    expect(result.changed).toBe(false);
    expect(adapter.requests).toHaveLength(0);
  });

  it("keeps the original memory when the result is empty or not smaller", async () => {
    const empty = new StubAdapter("no json here");
    const emptyResult = await runMemoryConsolidation({ modelAdapter: empty, model: "m", entries: entries(6) });
    expect(emptyResult.changed).toBe(false);
    expect(emptyResult.entries).toHaveLength(6);
    expect(emptyResult.warnings[0]).toMatch(/no smaller result/i);
  });

  it("fails open and redacts secrets when the provider throws", async () => {
    const result = await runMemoryConsolidationSafely({
      modelAdapter: new ThrowingAdapter(),
      model: "m",
      entries: entries(6),
    });
    expect(result.changed).toBe(false);
    expect(result.entries).toHaveLength(6);
    expect(result.warnings[0]).toContain("[redacted]");
    expect(result.warnings[0]).not.toContain("sk-secret");
  });
});
