import { describe, expect, it, vi } from "vitest";

import {
  createModelCallCaptureAdapter,
  toModelCallRecord,
} from "../../src/app/modelCallTelemetryAdapter";
import type {
  TextGenerationResponse,
  TextModelAdapter,
} from "../../src/providers/TextModelAdapter";
import { resolveModelCallBudget } from "../../src/runtime/modelCallBudget";

describe("model call telemetry adapter", () => {
  it("captures a completed stream with terminal provider usage", async () => {
    const capture = vi.fn();
    const adapter: TextModelAdapter = {
      id: "stream-provider",
      displayName: "Stream provider",
      async listModels() {
        return [];
      },
      async generateText(): Promise<TextGenerationResponse> {
        throw new Error("generateText should not run");
      },
      async *streamText() {
        yield { text: "Streamed ", index: 0, done: false };
        yield {
          text: "reply",
          index: 1,
          done: true,
          finishReason: "stop" as const,
          usage: { inputTokens: 9, outputTokens: 2, totalTokens: 11 },
          usageSource: "provider" as const,
        };
      },
    };

    const wrapped = createModelCallCaptureAdapter(adapter, capture);
    const chunks = [];
    for await (const chunk of wrapped.streamText?.({ model: "model-a", prompt: "Hello" }) ?? []) {
      chunks.push(chunk.text);
    }

    expect(chunks.join("")).toBe("Streamed reply");
    expect(capture).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledWith({
      response: expect.objectContaining({
        providerId: "stream-provider",
        model: "model-a",
        text: "Streamed reply",
        finishReason: "stop",
        usage: { inputTokens: 9, outputTokens: 2, totalTokens: 11 },
        usageSource: "provider",
      }),
    });
  });

  it("captures stream failures and builds explicit failure telemetry", async () => {
    const capture = vi.fn();
    const failure = new Error("provider stream failed");
    const adapter: TextModelAdapter = {
      id: "broken-provider",
      displayName: "Broken provider",
      async listModels() {
        return [];
      },
      async generateText(): Promise<TextGenerationResponse> {
        throw failure;
      },
      async *streamText() {
        yield await Promise.reject(failure);
      },
    };

    const wrapped = createModelCallCaptureAdapter(adapter, capture);
    await expect(async () => {
      for await (const _chunk of wrapped.streamText?.({ model: "model-b", prompt: "Hello" }) ?? []) {
        // exhaust the stream
      }
    }).rejects.toThrow("provider stream failed");
    expect(capture).toHaveBeenCalledWith({ error: failure });

    const record = toModelCallRecord({
      phase: "visible-response",
      fallbackProvider: adapter.id,
      fallbackModel: "model-b",
      budget: resolveModelCallBudget({
        providerId: adapter.id,
        model: "model-b",
        phase: "visible-response",
      }),
      durationMs: 12,
      outcome: { error: failure },
      stateProposalCount: 0,
    });
    expect(record).toMatchObject({
      phase: "visible-response",
      provider: "broken-provider",
      model: "model-b",
      status: "error",
      usageSource: "unavailable",
      durationMs: 12,
    });
  });
});
