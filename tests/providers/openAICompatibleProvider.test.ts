import { describe, expect, it, vi } from "vitest";

import { OpenAICompatibleTextProvider } from "../../src/providers/openAICompatibleProvider";
import { estimateTextTokens } from "../../src/runtime/tokenBudget";

describe("OpenAI-compatible text provider", () => {
  it("calls chat completions with a session key and maps usage", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "The cellar door opens." }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200 },
      ),
    );
    const provider = new OpenAICompatibleTextProvider({
      id: "test-provider",
      baseUrl: "https://example.test/v1/",
      apiKey: "session-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const response = await provider.generateText({
      model: "qwen3.7-max",
      prompt: "Open the cellar door.",
      temperature: 0.4,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.test/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer session-key",
        }),
      }),
    );
    const fetchCalls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(JSON.parse(String(fetchCalls[0][1].body))).toMatchObject({
      model: "qwen3.7-max",
      temperature: 0.4,
    });
    expect(response).toMatchObject({
      providerId: "test-provider",
      model: "qwen3.7-max",
      text: "The cellar door opens.",
      usage: {
        totalTokens: 15,
      },
      usageSource: "provider",
    });
  });

  it("includes the trusted system prompt in fallback input-token usage", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "Fallback response." }, finish_reason: "stop" }],
        }),
        { status: 200 },
      ),
    );
    const provider = new OpenAICompatibleTextProvider({
      id: "fallback-provider",
      baseUrl: "https://example.test/v1",
      apiKey: "session-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const systemPrompt = "Trusted runtime authority ".repeat(8);
    const prompt = "Player-visible context ".repeat(4);

    const response = await provider.generateText({
      model: "qwen3.7-max",
      systemPrompt,
      prompt,
    });

    const expectedInputTokens = estimateTextTokens(`${systemPrompt}\n\n${prompt}`);
    expect(response.usage).toEqual({
      inputTokens: expectedInputTokens,
      outputTokens: estimateTextTokens("Fallback response."),
      totalTokens: expectedInputTokens + estimateTextTokens("Fallback response."),
    });
    expect(response.usageSource).toBe("estimated");
  });

  it("refuses to generate without a session key", async () => {
    const provider = new OpenAICompatibleTextProvider({
      baseUrl: "https://example.test/v1",
    });

    await expect(provider.generateText({ model: "qwen3.7-max", prompt: "Hello" })).rejects.toThrow(
      /session API key/i,
    );
  });

  it("can call unauthenticated local-compatible endpoints when explicitly allowed", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "Local response" } }] }), {
        status: 200,
      }),
    );
    const provider = new OpenAICompatibleTextProvider({
      baseUrl: "http://127.0.0.1:1234/v1",
      allowUnauthenticated: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(provider.generateText({ model: "local-model", prompt: "Hello" })).resolves.toMatchObject({
      text: "Local response",
    });
    const fetchCalls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(fetchCalls[0][1].headers).not.toHaveProperty("authorization");
  });

  it("binds the default browser fetch before generating text", async () => {
    const fetchImpl = vi.fn(function (this: unknown) {
      if (this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }

      return Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: "Bound response" } }] }), {
          status: 200,
        }),
      );
    });
    vi.stubGlobal("fetch", fetchImpl);

    try {
      const provider = new OpenAICompatibleTextProvider({
        baseUrl: "http://127.0.0.1:1234/v1",
        allowUnauthenticated: true,
      });

      await expect(provider.generateText({ model: "local-model", prompt: "Hello" })).resolves.toMatchObject({
        text: "Bound response",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refuses unauthenticated non-loopback endpoints", async () => {
    expect(
      () =>
        new OpenAICompatibleTextProvider({
          baseUrl: "https://example.test/v1",
          allowUnauthenticated: true,
        }),
    ).toThrow(/loopback/i);
  });

  it("streams OpenAI-compatible SSE chunks when requested", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'),
        );
        controller.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"content":" world"}}]}\n\n'),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const fetchImpl = vi.fn(async () => new Response(stream, { status: 200 }));
    const provider = new OpenAICompatibleTextProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "session-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const chunks: string[] = [];
    for await (const chunk of provider.streamText?.({ model: "qwen3.7-max", prompt: "Hello" }) ?? []) {
      chunks.push(chunk.text);
    }

    expect(chunks.join("")).toBe("Hello world");
    const fetchCalls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(JSON.parse(String(fetchCalls[0][1].body))).toMatchObject({
      stream: true,
    });
  });

  it("redacts sensitive provider error bodies", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("bad Authorization Bearer sk-test-token", { status: 401 }))
      .mockResolvedValueOnce(new Response("sk-rawsecretvalue", { status: 401 }));
    const provider = new OpenAICompatibleTextProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "sk-test-token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const keywordError = await provider
      .generateText({ model: "qwen3.7-max", prompt: "Hello" })
      .catch((error: unknown) => error);
    expect(keywordError).toBeInstanceOf(Error);
    expect((keywordError as Error).message).toMatch(/may contain sensitive data/i);
    expect((keywordError as Error).message).not.toMatch(/sk-test-token/i);

    const rawKeyError = await provider
      .generateText({ model: "qwen3.7-max", prompt: "Hello" })
      .catch((error: unknown) => error);
    expect(rawKeyError).toBeInstanceOf(Error);
    expect((rawKeyError as Error).message).toMatch(/may contain sensitive data/i);
    expect((rawKeyError as Error).message).not.toMatch(/sk-rawsecretvalue/i);
  });

  it("times out stalled text provider requests", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        });
      });
      const provider = new OpenAICompatibleTextProvider({
        baseUrl: "https://example.test/v1",
        apiKey: "session-key",
        requestTimeoutMs: 25,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      const pending = expect(provider.generateText({ model: "qwen3.7-max", prompt: "Hello" })).rejects.toThrow(/timed out/i);
      await vi.advanceTimersByTimeAsync(30);

      await pending;
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out stalled text provider response bodies", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(async () =>
        ({
          ok: true,
          json: () => new Promise<unknown>(() => undefined),
          text: () => Promise.resolve(""),
        }) as Response,
      );
      const provider = new OpenAICompatibleTextProvider({
        baseUrl: "https://example.test/v1",
        apiKey: "session-key",
        requestTimeoutMs: 25,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      const pending = expect(provider.generateText({ model: "qwen3.7-max", prompt: "Hello" })).rejects.toThrow(/timed out/i);
      await vi.advanceTimersByTimeAsync(30);

      await pending;
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out stalled text provider streams after headers arrive", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(async () =>
        ({
          ok: true,
          body: {
            getReader: () => ({
              read: () => new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined),
            }),
          },
          text: () => Promise.resolve(""),
        }) as Response,
      );
      const provider = new OpenAICompatibleTextProvider({
        baseUrl: "https://example.test/v1",
        apiKey: "session-key",
        requestTimeoutMs: 25,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      const iterator = provider.streamText!({ model: "qwen3.7-max", prompt: "Hello" })[Symbol.asyncIterator]();
      const pending = expect(iterator.next()).rejects.toThrow(/timed out/i);
      await vi.advanceTimersByTimeAsync(30);

      await pending;
    } finally {
      vi.useRealTimers();
    }
  });
});
