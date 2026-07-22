import { describe, expect, it, vi } from "vitest";

import {
  buildMemoryEvidenceAnalysisRequest,
  buildVisibleUserMessageWithMemoryEvidence,
  parseMemoryEvidenceBrief,
  runMemoryEvidenceAnalysis,
} from "../../src/runtime/memoryEvidenceBrief";
import type { TextModelAdapter } from "../../src/providers/TextModelAdapter";

const messages = [
  { id: "message-old", role: "user", content: "The iron key was destroyed." },
  { id: "message-new", role: "assistant", content: "Mara kept that fact secret from Iven." },
] as const;

const card = {
  id: "card-1",
  name: "The North Gate",
  summary: "A guarded city gate.",
  memory: [{ id: "memory-1", label: "Passphrase", detail: "The current phrase is ashfall." }],
  storyEntities: [],
  rpgState: null,
};

const validBrief = {
  relevant_evidence: [
    { source_id: "message-old", fact: "The iron key was destroyed.", status: "active" },
  ],
  knowledge_boundaries: [
    { entity: "Iven", knows: [], does_not_know: ["The iron key was destroyed."] },
  ],
  uncertainties: [],
  response_constraints: ["Do not restore the iron key."],
  response_plan: ["Continue from the gate."],
};

describe("windowed memory evidence brief", () => {
  it("builds the tested strict, source-tagged, non-reasoning analysis request", () => {
    const request = buildMemoryEvidenceAnalysisRequest({
      model: "qwen/qwen3.7-max",
      card,
      messages,
      latestUserMessage: "I ask Iven about the key.",
      maxOutputTokens: 1000,
    });

    expect(request.model).toBe("qwen/qwen3.7-max");
    expect(request.reasoning).toEqual({ enabled: false });
    expect(request.responseFormat).toMatchObject({
      type: "json_schema",
      json_schema: { strict: true },
    });
    expect(request.prompt).toContain("[message-old] user: The iron key was destroyed.");
    expect(request.prompt).toContain("[message-new] assistant: Mara kept that fact secret from Iven.");
    expect(request.prompt).toContain("[card-memory:memory-1] Passphrase: The current phrase is ashfall.");
    expect(request.prompt).toContain("[latest-user] user: I ask Iven about the key.");
  });

  it("rejects structurally valid evidence that cites a source the analyst never received", () => {
    const forged = {
      ...validBrief,
      relevant_evidence: [{ source_id: "invented-source", fact: "A fabricated fact.", status: "active" }],
    };

    expect(() => parseMemoryEvidenceBrief(JSON.stringify(forged), new Set(["message-old"])))
      .toThrow(/unknown source/i);
  });

  it("rejects truncated analyst output before it can influence the visible call", async () => {
    const adapter: TextModelAdapter = {
      id: "provider",
      displayName: "Provider",
      listModels: vi.fn(async () => []),
      generateText: vi.fn(async (): Promise<import("../../src/providers/TextModelAdapter").TextGenerationResponse> => ({
        providerId: "provider",
        model: "qwen/qwen3.7-max",
        text: JSON.stringify(validBrief),
        finishReason: "length",
        usage: { inputTokens: 100, outputTokens: 1000, totalTokens: 1100 },
      })),
    };

    await expect(runMemoryEvidenceAnalysis({
      modelAdapter: adapter,
      model: "qwen/qwen3.7-max",
      card,
      messages,
      latestUserMessage: "I ask Iven about the key.",
    })).rejects.toThrow(/truncated/i);
  });

  it("withholds oversized full-branch analysis before contacting the provider", async () => {
    const generateText = vi.fn();

    await expect(runMemoryEvidenceAnalysis({
      modelAdapter: {
        id: "provider",
        displayName: "Provider",
        listModels: vi.fn(async () => []),
        generateText,
      },
      model: "qwen/qwen3.7-max",
      card,
      messages,
      latestUserMessage: "I ask Iven about the key.",
      inputBudgetTokens: 1,
    })).rejects.toThrow(/input budget/i);

    expect(generateText).not.toHaveBeenCalled();
  });

  it("serializes only a validated brief into the private visible-call context", () => {
    const brief = parseMemoryEvidenceBrief(
      JSON.stringify(validBrief),
      new Set(["message-old", "message-new", "card-memory:memory-1", "latest-user"]),
    );
    const visibleMessage = buildVisibleUserMessageWithMemoryEvidence("I ask Iven about the key.", brief);

    expect(visibleMessage).toContain("I ask Iven about the key.");
    expect(visibleMessage).toContain("Private memory evidence brief");
    expect(visibleMessage).toContain('"source_id":"message-old"');
    expect(visibleMessage).toContain("never quote or reveal it");
  });
});
