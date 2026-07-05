import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalEndpointTextProvider } from "../../src/providers/localEndpointAdapter";

describe("local endpoint text provider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("wraps a loopback OpenAI-compatible endpoint without requiring an API key", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "Local model response" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchImpl);

    const provider = new LocalEndpointTextProvider({
      endpointUrl: "http://127.0.0.1:1234/v1",
      models: [{ id: "local-model", displayName: "Local Model", providerId: "local-endpoint" }],
    });

    await expect(provider.listModels()).resolves.toEqual([
      { id: "local-model", displayName: "Local Model", providerId: "local-endpoint" },
    ]);
    await expect(provider.generateText({ model: "local-model", prompt: "Hello" })).resolves.toMatchObject({
      providerId: "local-endpoint",
      text: "Local model response",
      usage: { totalTokens: 7 },
    });

    const fetchCalls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(fetchCalls[0][0]).toBe("http://127.0.0.1:1234/v1/chat/completions");
    expect(fetchCalls[0][1].headers).not.toHaveProperty("authorization");
  });

  it("refuses unauthenticated non-loopback local endpoints", () => {
    expect(() => new LocalEndpointTextProvider({ endpointUrl: "https://example.test/v1" })).toThrow(/loopback/i);
  });
});
