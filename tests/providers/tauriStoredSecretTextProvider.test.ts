import { describe, expect, it, vi } from "vitest";

import { TauriStoredSecretTextProvider } from "../../src/providers/tauriStoredSecretTextProvider";

describe("Tauri stored-secret text provider", () => {
  it("delegates generation to the desktop command with a secret reference only", async () => {
    const invokeImpl = vi.fn(async () => ({
      providerId: "openrouter",
      model: "qwen3.7-max",
      text: "The gate opens.",
      finishReason: "stop",
      usage: {
        inputTokens: 12,
        outputTokens: 4,
        totalTokens: 16,
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

    await expect(
      provider.generateText({
        model: "qwen3.7-max",
        prompt: "Open the gate.",
        temperature: 0.4,
        timeoutMs: 12_000,
      }),
    ).resolves.toMatchObject({
      providerId: "openrouter",
      text: "The gate opens.",
      usage: {
        totalTokens: 16,
      },
    });

    expect(invokeImpl).toHaveBeenCalledWith(
      "generate_text_with_stored_secret",
      expect.objectContaining({
        request: expect.objectContaining({
          secretReference: expect.objectContaining({
            storageKey: "openrouter:apiKey",
          }),
          timeoutMs: 12_000,
        }),
      }),
    );
    expect(JSON.stringify(invokeImpl.mock.calls)).not.toContain("sk-");
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
});
