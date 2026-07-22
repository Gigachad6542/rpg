import { describe, expect, it, vi } from "vitest";

import { TauriStoredSecretTextProvider } from "../../src/providers/tauriStoredSecretTextProvider";
import type { TextModelAdapter } from "../../src/providers/TextModelAdapter";
import { estimateTextTokens } from "../../src/runtime/tokenBudget";

describe("Tauri stored-secret text provider", () => {
  it("delegates generation to the desktop command with a secret reference only", async () => {
    const invokeImpl = vi.fn(async () => ({
      providerId: "openrouter",
      model: "qwen3.7-max",
      text: "The gate opens.",
      finishReason: "stop",
      usage: {
        inputTokens: 12,
        outputTokens: 14,
        totalTokens: 26,
      },
      raw: {
        choices: [{ message: { content: "The gate opens.", reasoning: "The key matches the lock." } }],
        usage: { completion_tokens_details: { reasoning_tokens: 9 } },
      },
    }));
    const provider = new TauriStoredSecretTextProvider({
      id: "openrouter",
      displayName: "OpenRouter BYOK",
      baseUrl: "https://openrouter.ai/api/v1",
      secretReference: {
        providerId: "openrouter",
        secretName: "apiKey",
        storageKind: "os-keychain",
        storageKey: "openrouter:apiKey",
        providerBaseUrl: "https://openrouter.ai/api/v1",
      },
      invokeImpl: invokeImpl as unknown as <T>(command: string, args?: Record<string, unknown>) => Promise<T>,
    });

    expect((provider as TextModelAdapter).streamText).toBeUndefined();

    await expect(
      provider.generateText({
        model: "qwen3.7-max",
        prompt: "Open the gate.",
        temperature: 0.4,
        seed: 37119,
        responseFormat: { type: "json_object" },
        timeoutMs: 12_000,
        reasoning: { enabled: true, exclude: false },
      }),
    ).resolves.toMatchObject({
      providerId: "openrouter",
      text: "The gate opens.",
      usage: {
        totalTokens: 26,
      },
      reasoning: {
        trace: "The key matches the lock.",
        tokenCount: 9,
      },
      usageSource: "provider",
    });

    expect(invokeImpl).toHaveBeenCalledWith(
      "generate_text_with_stored_secret",
      expect.objectContaining({
        request: expect.objectContaining({
          requestId: expect.stringMatching(/^generation-/),
          secretReference: expect.objectContaining({
            storageKey: "openrouter:apiKey",
          }),
          timeoutMs: 12_000,
          seed: 37119,
          responseFormat: { type: "json_object" },
          reasoning: { enabled: true, exclude: false },
        }),
      }),
    );
    expect(JSON.stringify(invokeImpl.mock.calls)).not.toContain("sk-");
  });

  it("includes the trusted system prompt in desktop fallback input-token usage", async () => {
    const invokeImpl = vi.fn(async () => ({
      providerId: "openrouter",
      model: "qwen3.7-max",
      text: "Fallback desktop response.",
      finishReason: "stop",
    }));
    const provider = new TauriStoredSecretTextProvider({
      id: "openrouter",
      displayName: "OpenRouter BYOK",
      baseUrl: "https://openrouter.ai/api/v1",
      secretReference: {
        providerId: "openrouter",
        secretName: "apiKey",
        storageKind: "os-keychain",
        storageKey: "openrouter:apiKey",
        providerBaseUrl: "https://openrouter.ai/api/v1",
      },
      invokeImpl: invokeImpl as unknown as <T>(command: string, args?: Record<string, unknown>) => Promise<T>,
    });
    const systemPrompt = "Trusted desktop authority ".repeat(8);
    const prompt = "Player context ".repeat(4);

    const response = await provider.generateText({ model: "qwen3.7-max", systemPrompt, prompt });

    const expectedInputTokens = estimateTextTokens(`${systemPrompt}\n\n${prompt}`);
    expect(response.usage).toEqual({
      inputTokens: expectedInputTokens,
      outputTokens: estimateTextTokens("Fallback desktop response."),
      totalTokens: expectedInputTokens + estimateTextTokens("Fallback desktop response."),
    });
    expect(response.usageSource).toBe("estimated");
  });

  it("rejects an aborted desktop generation without invoking the command", async () => {
    const invokeImpl = vi.fn(async () => ({
      providerId: "openrouter",
      model: "qwen3.7-max",
      text: "late response",
      finishReason: "stop",
    }));
    const provider = new TauriStoredSecretTextProvider({
      id: "openrouter",
      displayName: "OpenRouter BYOK",
      baseUrl: "https://openrouter.ai/api/v1",
      secretReference: {
        providerId: "openrouter",
        secretName: "apiKey",
        storageKind: "os-keychain",
        storageKey: "openrouter:apiKey",
        providerBaseUrl: "https://openrouter.ai/api/v1",
      },
      invokeImpl: invokeImpl as unknown as <T>(command: string, args?: Record<string, unknown>) => Promise<T>,
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      provider.generateText({ model: "qwen3.7-max", prompt: "Wait.", signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(invokeImpl).not.toHaveBeenCalled();
  });

  it("waits for desktop cancellation acknowledgement before reporting a stopped request", async () => {
    let acknowledgeCancellation!: (acknowledged: boolean) => void;
    const cancellationAcknowledgement = new Promise<boolean>((resolve) => {
      acknowledgeCancellation = resolve;
    });
    const invokeMock = vi.fn((command: string, _args?: Record<string, unknown>) => {
      if (command === "cancel_text_generation") {
        return cancellationAcknowledgement;
      }
      return new Promise<unknown>(() => undefined);
    });
    const invokeImpl = invokeMock as unknown as <T>(
      command: string,
      args?: Record<string, unknown>,
    ) => Promise<T>;
    const provider = new TauriStoredSecretTextProvider({
      id: "openrouter",
      displayName: "OpenRouter BYOK",
      baseUrl: "https://openrouter.ai/api/v1",
      secretReference: {
        providerId: "openrouter",
        secretName: "apiKey",
        storageKind: "os-keychain",
        storageKey: "openrouter:apiKey",
        providerBaseUrl: "https://openrouter.ai/api/v1",
      },
      invokeImpl,
    });
    const controller = new AbortController();
    const pending = provider.generateText({
      model: "qwen3.7-max",
      prompt: "Wait.",
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();

    let settled = false;
    void pending.finally(() => {
      settled = true;
    }).catch(() => undefined);
    await Promise.resolve();
    expect(settled).toBe(false);
    acknowledgeCancellation(true);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    const generationRequest = invokeMock.mock.calls.find(([command]) => command === "generate_text_with_stored_secret");
    const cancellationRequest = invokeMock.mock.calls.find(([command]) => command === "cancel_text_generation");
    expect(cancellationRequest?.[1]).toEqual({
      requestId: (generationRequest?.[1] as { request: { requestId: string } }).request.requestId,
    });
  });
});
