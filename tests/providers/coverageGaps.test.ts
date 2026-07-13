import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ComfyUIImageProvider,
  fetchComfyUICheckpointModels,
  fetchComfyUIImageModels,
} from "../../src/providers/comfyUIProvider";
import { LocalEndpointTextProvider } from "../../src/providers/localEndpointAdapter";
import { MockTextProvider } from "../../src/providers/mockTextProvider";
import { OpenAICompatibleTextProvider } from "../../src/providers/openAICompatibleProvider";
import { TauriStoredSecretTextProvider } from "../../src/providers/tauriStoredSecretTextProvider";

const tauriInvokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauriInvokeMock,
}));

describe("provider coverage gap characterization", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    tauriInvokeMock.mockReset();
  });

  it("covers mock provider default responses and streaming", async () => {
    const provider = new MockTextProvider();
    const streamed: string[] = [];

    for await (const chunk of provider.streamText({
      model: "mock-narrator",
      systemPrompt: "System",
      prompt: "Describe this threshold.",
    })) {
      streamed.push(`${chunk.index}:${chunk.done}:${chunk.text}`);
    }

    expect(streamed).toEqual(["0:true:Mock response for Describe this threshold."]);
  });

  it("uses the local endpoint default URL and display name", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "Default local response" } }] }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchImpl);
    const provider = new LocalEndpointTextProvider();

    expect(provider.displayName).toBe("Local OpenAI-compatible endpoint");
    await expect(provider.generateText({ model: "local-model", prompt: "Hello" })).resolves.toMatchObject({
      text: "Default local response",
    });
    const fetchCalls = fetchImpl.mock.calls as unknown as [string][];
    expect(fetchCalls[0]?.[0]).toBe("http://127.0.0.1:1234/v1/chat/completions");
  });

  it("covers OpenAI-compatible fallback usage, finish reasons, model cloning, and stream edge cases", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: " Uses fallback usage. " }, finish_reason: "tool_calls" }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "Length stop" }, finish_reason: "length" }],
            usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "Odd finish" }, finish_reason: "weird" }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response("   ", { status: 500, statusText: "" }))
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder();
              controller.enqueue(encoder.encode(": keepalive\n"));
              controller.enqueue(encoder.encode("data: not-json\n\n"));
              controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":""}}]}\n\n'));
               controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"tail"}}]}\n\n'));
               controller.enqueue(encoder.encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'));
               controller.close();
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response("stream failed", { status: 502, statusText: "Bad gateway" }));

    const provider = new OpenAICompatibleTextProvider({
      id: "edge-provider",
      displayName: "Edge Provider",
      baseUrl: "HTTPS://LOCALHOST:4321/v1/?q=remove#hash",
      apiKey: "session-key",
      defaultHeaders: { "x-test": "yes" },
      models: [{ id: "model-a", displayName: "Model A", providerId: "edge-provider" }],
      requestTimeoutMs: Number.NaN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const models = await provider.listModels();
    models[0].displayName = "mutated";
    await expect(provider.listModels()).resolves.toEqual([
      { id: "model-a", displayName: "Model A", providerId: "edge-provider" },
    ]);

    await expect(
      provider.generateText({
        model: "model-a",
        systemPrompt: "System instructions",
        prompt: "Hello",
        maxOutputTokens: 12,
      }),
    ).resolves.toMatchObject({
      finishReason: "tool_call",
      usage: { totalTokens: expect.any(Number) },
    });
    await expect(provider.generateText({ model: "model-a", prompt: "Hello" })).resolves.toMatchObject({
      finishReason: "length",
    });
    await expect(provider.generateText({ model: "model-a", prompt: "Hello" })).resolves.toMatchObject({
      finishReason: "error",
    });
    await expect(provider.generateText({ model: "model-a", prompt: "Hello" })).rejects.toThrow(
      /provider returned no details/i,
    );

    const streamed: string[] = [];
    for await (const chunk of provider.streamText({ model: "model-a", prompt: "Hello" })) {
      streamed.push(`${chunk.index}:${chunk.done}:${chunk.text}`);
    }
    expect(streamed).toEqual(["0:false:tail", "1:true:"]);
    await expect(async () => {
      for await (const _chunk of provider.streamText({ model: "model-a", prompt: "Hello" })) {
        // exhaust stream
      }
    }).rejects.toThrow(/stream failed/i);

    const firstBody = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(fetchImpl.mock.calls[0][0]).toBe("https://localhost:4321/v1/chat/completions");
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({
      authorization: "Bearer session-key",
      "x-test": "yes",
    });
    expect(firstBody.messages).toEqual([
      { role: "system", content: "System instructions" },
      { role: "user", content: "Hello" },
    ]);
    expect(firstBody.max_tokens).toBe(12);
  });

  it("covers OpenAI-compatible no-AbortController and pre-aborted signal paths", async () => {
    const originalAbortController = globalThis.AbortController;
    vi.stubGlobal("AbortController", undefined);
    try {
      const fetchImpl = vi.fn(async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "No abort controller" } }] }), {
          status: 200,
        }),
      );
      const provider = new OpenAICompatibleTextProvider({
        baseUrl: "http://127.0.0.1:4321/v1",
        allowUnauthenticated: true,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      await expect(provider.generateText({ model: "local", prompt: "Hello" })).resolves.toMatchObject({
        text: "No abort controller",
      });

      const unreadableProvider = new OpenAICompatibleTextProvider({
        baseUrl: "http://127.0.0.1:4321/v1",
        allowUnauthenticated: true,
        fetchImpl: (async () =>
          ({
            ok: false,
            status: 429,
            statusText: "Too Many Requests",
            text: () => Promise.reject(new Error("body locked")),
          }) as Response) as typeof fetch,
      });
      await expect(unreadableProvider.generateText({ model: "local", prompt: "Hello" })).rejects.toThrow(
        /Too Many Requests/i,
      );
    } finally {
      vi.stubGlobal("AbortController", originalAbortController);
    }

    const controller = new AbortController();
    controller.abort("already cancelled");
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      expect(init?.signal?.aborted).toBe(true);
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    });
    const provider = new OpenAICompatibleTextProvider({
      baseUrl: "http://127.0.0.1:4321/v1",
      allowUnauthenticated: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(
      provider.generateText({ model: "local", prompt: "Hello", signal: controller.signal }),
    ).rejects.toThrow(/Aborted/i);
  });

  it("covers OpenAI-compatible stream auth and unreadable error body fallbacks", async () => {
    const lockedErrorBody = {
      ok: false,
      status: 418,
      statusText: "Teapot",
      text: () => Promise.reject(new Error("body already read")),
    } as Response;
    const fetchImpl = vi.fn(async () => lockedErrorBody);
    const provider = new OpenAICompatibleTextProvider({
      baseUrl: "https://example.test/v1",
      apiKey: "session-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(provider.generateText({ model: "qwen", prompt: "Hello" })).rejects.toThrow(
      /request failed \(418\): Teapot/i,
    );
    await expect(
      async () => {
        const unauthenticated = new OpenAICompatibleTextProvider({
          baseUrl: "https://example.test/v1",
        });
        for await (const _chunk of unauthenticated.streamText({ model: "qwen", prompt: "Hello" })) {
          // exhaust stream
        }
      },
    ).rejects.toThrow(/session API key/i);
  });

  it("covers OpenAI-compatible stream null content and response-body timeout causes", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":null}}]}\n\n'));
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
    for await (const chunk of provider.streamText({ model: "qwen", prompt: "Hello" })) {
      chunks.push(`${chunk.index}:${chunk.done}:${chunk.text}`);
    }
    expect(chunks).toEqual(["0:true:"]);

    vi.useFakeTimers();
    try {
      const slowBodyProvider = new OpenAICompatibleTextProvider({
        baseUrl: "https://example.test/v1",
        apiKey: "session-key",
        requestTimeoutMs: 25,
        fetchImpl: (async () =>
          ({
            ok: true,
            json: () => Promise.reject(new Error("parser failed after timeout")),
            text: () => Promise.resolve(""),
          }) as Response) as typeof fetch,
      });

      const pending = expect(slowBodyProvider.generateText({ model: "qwen", prompt: "Hello" })).rejects.toThrow(
        /parser failed after timeout/i,
      );
      await vi.advanceTimersByTimeAsync(30);
      await pending;
    } finally {
      vi.useRealTimers();
    }

    vi.useFakeTimers();
    try {
      const slowErrorBodyProvider = new OpenAICompatibleTextProvider({
        baseUrl: "https://example.test/v1",
        apiKey: "session-key",
        requestTimeoutMs: 25,
        fetchImpl: (async () =>
          ({
            ok: false,
            status: 503,
            statusText: "Unavailable",
            text: () => new Promise<string>(() => undefined),
          }) as Response) as typeof fetch,
      });

      const pending = expect(slowErrorBodyProvider.generateText({ model: "qwen", prompt: "Hello" })).rejects.toThrow(
        /timed out/i,
      );
      await vi.advanceTimersByTimeAsync(30);
      await pending;
    } finally {
      vi.useRealTimers();
    }
  });

  it("covers stored-secret model listing, fallback usage, desktop guard, and default Tauri invoke", async () => {
    const secretReference = {
      providerId: "openrouter",
      secretName: "apiKey",
      storageKind: "os-keychain" as const,
      storageKey: "openrouter:apiKey",
    };
    const provider = new TauriStoredSecretTextProvider({
      id: "openrouter",
      displayName: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      secretReference,
      models: [{ id: "qwen", displayName: "Qwen", providerId: "openrouter" }],
      invokeImpl: async <T>() =>
        ({
          providerId: "openrouter",
          model: "qwen",
          text: "Stored response",
          finishReason: "stop" as const,
        }) as T,
    });

    const models = await provider.listModels();
    models[0].displayName = "mutated";
    await expect(provider.listModels()).resolves.toEqual([
      { id: "qwen", displayName: "Qwen", providerId: "openrouter" },
    ]);
    await expect(provider.generateText({ model: "qwen", prompt: "Stored prompt" })).resolves.toMatchObject({
      text: "Stored response",
      usage: {
        totalTokens: expect.any(Number),
      },
    });

    const guarded = new TauriStoredSecretTextProvider({
      id: "openrouter",
      displayName: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      secretReference,
    });
    await expect(guarded.generateText({ model: "qwen", prompt: "Hello" })).rejects.toThrow(/desktop app/i);

    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    tauriInvokeMock.mockResolvedValueOnce({
      providerId: "openrouter",
      model: "qwen",
      text: "Dynamic invoke response",
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    });
    try {
      await expect(guarded.generateText({ model: "qwen", prompt: "Hello" })).resolves.toMatchObject({
        text: "Dynamic invoke response",
        usage: { totalTokens: 3 },
      });
    } finally {
      delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    }
  });

  it("covers ComfyUI prompt-only compilation and common failure edges", async () => {
    const provider = new ComfyUIImageProvider({
      endpoint: "HTTP://LOCALHOST:8188/?drop=1#hash",
      workflowJson: "{}",
      pollIntervalMs: 1,
    });

    await expect(
      provider.compilePromptOnly({
        scenePrompt: "Map scene",
        negativePrompt: "text",
        providerFormatting: "Use ComfyUI JSON",
      }),
    ).resolves.toBe("Map scene\nNegative prompt: text\nProvider formatting: Use ComfyUI JSON");
    await expect(provider.compilePromptOnly({ scenePrompt: "Map scene" })).resolves.toBe("Map scene");

    expect(() => new ComfyUIImageProvider({ endpoint: "ftp://127.0.0.1:8188", workflowJson: "{}" })).toThrow(
      /loopback/i,
    );
    expect(() => new ComfyUIImageProvider({ endpoint: "not a url", workflowJson: "{}" })).toThrow(/loopback/i);
    await expect(
      new ComfyUIImageProvider({ endpoint: "http://127.0.0.1:8188", workflowJson: "" }).generateImage({
        model: "local",
        prompt: "map",
      }),
    ).rejects.toThrow(/Paste a ComfyUI workflow/i);
    await expect(
      new ComfyUIImageProvider({ endpoint: "http://127.0.0.1:8188", workflowJson: "{" }).generateImage({
        model: "local",
        prompt: "map",
      }),
    ).rejects.toThrow(/workflow JSON is invalid/i);
  });

  it("hydrates broad ComfyUI workflow placeholders and generation setting overrides", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ prompt_id: "prompt-rich" }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            "prompt-rich": {
              outputs: {
                alpha: { images: [{ filename: "other.png", subfolder: "", type: "other" }] },
                "2": { images: [{ filename: "temp.png", subfolder: "", type: "temp" }] },
                "10": { images: [{ filename: "final.png", subfolder: "out", type: "output" }] },
              },
            },
          }),
          { status: 200 },
        ),
      );
    const provider = new ComfyUIImageProvider({
      endpoint: "http://127.0.0.1:8188",
      model: "configured.safetensors",
      clientId: "client",
      workflowJson: JSON.stringify({
        "1": { class_type: "UNETLoader", inputs: { unet_name: "{{model}}" } },
        "2": { class_type: "EmptySD3LatentImage", inputs: { width: 1, height: 1 } },
        "3": { class_type: "EmptyFlux2LatentImage", inputs: { width: 1, height: 1 } },
        "4": { class_type: "ModelSamplingFlux", inputs: { width: 1, height: 1 } },
        "5": {
          class_type: "KSamplerAdvanced",
          inputs: { seed: 1, steps: 1, cfg: 1, sampler_name: "bad", scheduler: "bad" },
        },
        "6": { class_type: "BasicScheduler", inputs: { steps: 1, scheduler: "bad" } },
        "7": { class_type: "Flux2Scheduler", inputs: { steps: 1, width: 1, height: 1 } },
        "8": { class_type: "KSamplerSelect", inputs: { sampler_name: "bad" } },
        "9": { class_type: "RandomNoise", inputs: { noise_seed: 1 } },
        "10": { class_type: "CLIPTextEncodeFlux", inputs: { guidance: 1 } },
        "11": { class_type: "FluxGuidance", inputs: { guidance: 1 } },
        "12": { class_type: "Note", inputs: { text: "hello {{prompt}} {{negative_prompt}} {{model}} {{width}} {{height}} {{steps}} {{cfg}} {{sampler}} {{scheduler}}" } },
      }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pollIntervalMs: 1,
    });

    const result = await provider.generateImage({
      model: "request-model",
      prompt: "rich prompt",
      negativePrompt: "negative",
      width: 900.4,
      height: 700.6,
      seed: 42,
      steps: 12,
      cfg: 2,
      samplerName: "dpmpp",
      scheduler: "karras",
    });

    const queueBody = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(queueBody.prompt["1"].inputs.unet_name).toBe("configured.safetensors");
    expect(queueBody.prompt["2"].inputs.width).toBe(900);
    expect(queueBody.prompt["3"].inputs.height).toBe(701);
    expect(queueBody.prompt["4"].inputs.width).toBe(900);
    expect(queueBody.prompt["5"].inputs.sampler_name).toBe("dpmpp");
    expect(queueBody.prompt["6"].inputs.steps).toBe(12);
    expect(queueBody.prompt["7"].inputs.height).toBe(701);
    expect(queueBody.prompt["8"].inputs.sampler_name).toBe("dpmpp");
    expect(queueBody.prompt["9"].inputs.noise_seed).toBe(42);
    expect(queueBody.prompt["10"].inputs.guidance).toBe(2);
    expect(queueBody.prompt["11"].inputs.guidance).toBe(2);
    expect(queueBody.prompt["12"].inputs.text).toContain("rich prompt negative configured.safetensors 900 701 12 2 dpmpp karras");
    expect(result.images.map((image) => image.url)).toEqual([
      "http://127.0.0.1:8188/view?filename=final.png&subfolder=out&type=output",
      "http://127.0.0.1:8188/view?filename=temp.png&subfolder=&type=temp",
      "http://127.0.0.1:8188/view?filename=other.png&subfolder=&type=other",
    ]);
  });

  it("covers ComfyUI queue, history, polling, model-list, and request timeout edges", async () => {
    await expect(fetchComfyUICheckpointModels({ endpoint: "https://example.test" })).rejects.toThrow(/loopback/i);
    await expect(fetchComfyUIImageModels({ endpoint: "not a url" })).rejects.toThrow(/loopback/i);
    await expect(
      fetchComfyUICheckpointModels({
        endpoint: "http://127.0.0.1:8188",
        fetchImpl: (async () => new Response("down", { status: 503 })) as typeof fetch,
      }),
    ).rejects.toThrow(/checkpoint check failed/i);

    const objectInfoFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ UNETLoader: { input: { required: { unet_name: [["flux.safetensors", ""], {}] } } } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ UNETLoader: { input: { required: { unet_name: "bad" } } } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ CheckpointLoaderSimple: {} }), { status: 200 }));
    await expect(
      fetchComfyUIImageModels({
        endpoint: "http://127.0.0.1:8188",
        fetchImpl: objectInfoFetch as unknown as typeof fetch,
      }),
    ).resolves.toEqual(["flux.safetensors"]);
    await expect(
      fetchComfyUIImageModels({
        endpoint: "http://127.0.0.1:8188",
        fetchImpl: objectInfoFetch as unknown as typeof fetch,
      }),
    ).resolves.toEqual([]);
    await expect(
      fetchComfyUICheckpointModels({
        endpoint: "http://127.0.0.1:8188",
        fetchImpl: objectInfoFetch as unknown as typeof fetch,
      }),
    ).resolves.toEqual([]);

    await expect(
      new ComfyUIImageProvider({
        endpoint: "http://127.0.0.1:8188",
        workflowJson: JSON.stringify({ "1": { class_type: "SaveImage", inputs: { text: "{{prompt}}" } } }),
        fetchImpl: (async () => new Response(JSON.stringify({}), { status: 200 })) as typeof fetch,
      }).generateImage({ model: "local", prompt: "map" }),
    ).rejects.toThrow(/did not return a prompt id/i);

    await expect(
      new ComfyUIImageProvider({
        endpoint: "http://127.0.0.1:8188",
        workflowJson: JSON.stringify({ "1": { class_type: "SaveImage", inputs: { text: "{{prompt}}" } } }),
        fetchImpl: vi
          .fn()
          .mockResolvedValueOnce(new Response(JSON.stringify({ prompt_id: "prompt-no-image" }), { status: 200 }))
          .mockResolvedValueOnce(
            new Response(JSON.stringify({ "prompt-no-image": { status: { completed: true, status_str: "success" } } }), {
              status: 200,
            }),
          ) as unknown as typeof fetch,
        pollIntervalMs: 1,
      }).generateImage({ model: "local", prompt: "map" }),
    ).rejects.toThrow(/Status: success/i);

    await expect(
      new ComfyUIImageProvider({
        endpoint: "http://127.0.0.1:8188",
        workflowJson: JSON.stringify({ "1": { class_type: "SaveImage", inputs: { text: "{{prompt}}" } } }),
        fetchImpl: vi
          .fn()
          .mockResolvedValueOnce(new Response(JSON.stringify({ prompt_id: "prompt-history-fail" }), { status: 200 }))
          .mockResolvedValueOnce(new Response("history secret sk-should-redact", { status: 500 })) as unknown as typeof fetch,
        pollIntervalMs: 1,
      }).generateImage({ model: "local", prompt: "map" }),
    ).rejects.toThrow(/ComfyUI history failed \(500\): \[redacted\]/i);

    const pollingFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ prompt_id: "prompt-poll" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            "prompt-poll": {
              outputs: { "9": { images: [{ filename: "polled.png", subfolder: "", type: "output" }] } },
            },
          }),
          { status: 200 },
        ),
      );
    const pollingProvider = new ComfyUIImageProvider({
      endpoint: "http://127.0.0.1:8188",
      workflowJson: JSON.stringify({ "1": { class_type: "SaveImage", inputs: { text: "{{prompt}}" } } }),
      fetchImpl: pollingFetch as unknown as typeof fetch,
      pollIntervalMs: 1,
    });
    await expect(pollingProvider.generateImage({ model: "local", prompt: "map" })).resolves.toMatchObject({
      images: [{ url: expect.stringContaining("polled.png") }],
    });

    vi.useFakeTimers();
    try {
      const stalled = new ComfyUIImageProvider({
        endpoint: "http://127.0.0.1:8188",
        workflowJson: JSON.stringify({ "1": { class_type: "SaveImage", inputs: { text: "{{prompt}}" } } }),
        fetchImpl: (() => new Promise<Response>(() => undefined)) as typeof fetch,
        requestTimeoutMs: 25,
      });
      const pending = expect(stalled.generateImage({ model: "local", prompt: "map" })).rejects.toThrow(/timed out/i);
      await vi.advanceTimersByTimeAsync(30);
      await pending;
    } finally {
      vi.useRealTimers();
    }
  });

  it("covers ComfyUI parser fallbacks, queue details, and no-AbortController request handling", async () => {
    const originalAbortController = globalThis.AbortController;
    vi.stubGlobal("AbortController", undefined);
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal("crypto", undefined);
    try {
      const nonObjectWorkflowFetch = vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ prompt_id: "prompt-string" }), { status: 200 }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              "prompt-string": {
                outputs: {
                  beta: { images: [{ filename: "beta.png", subfolder: "", type: "preview" }] },
                  alpha: { images: [{ filename: "alpha.png", subfolder: "", type: "preview" }] },
                },
              },
            }),
            { status: 200 },
          ),
        );
      const provider = new ComfyUIImageProvider({
        endpoint: "http://127.0.0.1:8188",
        workflowJson: JSON.stringify("{{negative_prompt}} {{width}} {{height}} {{steps}} {{cfg}}"),
        fetchImpl: nonObjectWorkflowFetch as unknown as typeof fetch,
        pollIntervalMs: 1,
      });

      const result = await provider.generateImage({
        model: "local",
        prompt: "map",
        width: Number.NaN,
        height: -4,
      });

      const queueBody = JSON.parse(String(nonObjectWorkflowFetch.mock.calls[0][1]?.body));
      expect(queueBody.client_id).toMatch(/^local-cards-/);
      expect(queueBody.prompt).toBe(" 1024 1024 28 3.5");
      expect(result.images.map((image) => image.url)).toEqual([
        "http://127.0.0.1:8188/view?filename=alpha.png&subfolder=&type=preview",
        "http://127.0.0.1:8188/view?filename=beta.png&subfolder=&type=preview",
      ]);
    } finally {
      vi.stubGlobal("AbortController", originalAbortController);
      vi.stubGlobal("crypto", originalCrypto);
    }

    await expect(
      new ComfyUIImageProvider({
        endpoint: "http://127.0.0.1:8188",
        workflowJson: JSON.stringify({ "1": { class_type: "SaveImage", inputs: { text: "{{prompt}}" } } }),
        fetchImpl: vi.fn().mockResolvedValueOnce(
          new Response("validation failed ckpt_name: 'missing.safetensors'", {
            status: 400,
            statusText: "Bad Request",
          }),
        ) as unknown as typeof fetch,
      }).generateImage({ model: "local", prompt: "map" }),
    ).rejects.toThrow(/checkpoint "missing\.safetensors" is not installed/i);

    await expect(
      new ComfyUIImageProvider({
        endpoint: "http://127.0.0.1:8188",
        workflowJson: JSON.stringify({ "1": { class_type: "SaveImage", inputs: { text: "{{prompt}}" } } }),
        fetchImpl: vi.fn().mockResolvedValueOnce(new Response("", { status: 500, statusText: "" })) as unknown as typeof fetch,
      }).generateImage({ model: "local", prompt: "map" }),
    ).rejects.toThrow(/queue failed \(500\): no details/i);

    await expect(
      fetchComfyUIImageModels({
        endpoint: "http://127.0.0.1:8188",
        fetchImpl: (async () =>
          new Response(JSON.stringify({ UNETLoader: { input: { required: { unet_name: ["not-a-list"] } } } }), {
            status: 200,
          })) as typeof fetch,
      }),
    ).resolves.toEqual([]);
  });

  it("covers ComfyUI polling timeout, aborted signals, node-error variants, and unreadable bodies", async () => {
    vi.useFakeTimers();
    try {
      const pollingFetch = vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ prompt_id: "prompt-timeout" }), { status: 200 }))
        .mockImplementation(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200 })));
      const timeoutProvider = new ComfyUIImageProvider({
        endpoint: "http://127.0.0.1:8188",
        workflowJson: JSON.stringify({ "1": { class_type: "SaveImage", inputs: { text: "{{prompt}}" } } }),
        fetchImpl: pollingFetch as unknown as typeof fetch,
        pollIntervalMs: 1,
        pollTimeoutMs: 5,
      });

      const pending = expect(timeoutProvider.generateImage({ model: "local", prompt: "map" })).rejects.toThrow(
        /Timed out waiting for ComfyUI image output/i,
      );
      await vi.advanceTimersByTimeAsync(20);
      await pending;
    } finally {
      vi.useRealTimers();
    }

    const controller = new AbortController();
    controller.abort("already cancelled");
    const abortedFetch = vi.fn((_url: string, init?: RequestInit) => {
      expect(init?.signal?.aborted).toBe(true);
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    });
    await expect(
      new ComfyUIImageProvider({
        endpoint: "http://127.0.0.1:8188",
        workflowJson: JSON.stringify({ "1": { class_type: "SaveImage", inputs: { text: "{{prompt}}" } } }),
        fetchImpl: abortedFetch as unknown as typeof fetch,
      }).generateImage({ model: "local", prompt: "map", signal: controller.signal }),
    ).rejects.toThrow(/Could not reach ComfyUI/i);

    await expect(
      new ComfyUIImageProvider({
        endpoint: "http://127.0.0.1:8188",
        workflowJson: JSON.stringify({ "1": { class_type: "SaveImage", inputs: { text: "{{prompt}}" } } }),
        fetchImpl: vi.fn().mockResolvedValueOnce(
          new Response(JSON.stringify({ prompt_id: "prompt-node", node_errors: ["bad node"] }), {
            status: 200,
          }),
        ) as unknown as typeof fetch,
      }).generateImage({ model: "local", prompt: "map" }),
    ).rejects.toThrow(/node_errors/i);

    const unreadableBody = {
      ok: false,
      status: 502,
      statusText: "Gateway",
      text: () => Promise.reject(new Error("locked body")),
    } as Response;
    await expect(
      new ComfyUIImageProvider({
        endpoint: "http://127.0.0.1:8188",
        workflowJson: JSON.stringify({ "1": { class_type: "SaveImage", inputs: { text: "{{prompt}}" } } }),
        fetchImpl: vi.fn().mockResolvedValueOnce(unreadableBody) as unknown as typeof fetch,
      }).generateImage({ model: "local", prompt: "map" }),
    ).rejects.toThrow(/queue failed \(502\): Gateway/i);
  });

  it("covers ComfyUI linked prompt override oddities, nested checkpoints, and image sorting", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            CheckpointLoaderSimple: {
              input: {
                required: {
                  ckpt_name: [["nested.safetensors"], {}],
                },
              },
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ prompt_id: "prompt-linked" }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            "prompt-linked": {
              outputs: {
                "2": { images: [{ filename: "node-2.png", subfolder: "", type: "output" }] },
                "10": { images: [{ filename: "node-10.png", subfolder: "", type: "output" }] },
              },
            },
          }),
          { status: 200 },
        ),
      );
    const provider = new ComfyUIImageProvider({
      endpoint: "http://127.0.0.1:8188",
      requestTimeoutMs: Number.NaN,
      workflowJson: JSON.stringify({
        noise: "not a node",
        malformed: {
          class_type: "Note",
          inputs: "not input fields",
        },
        sampler: {
          class_type: "KSampler",
          inputs: {
            positive: ["positive-text", 0],
            negative: ["negative-text", 0],
          },
        },
        "positive-text": {
          class_type: "CLIPTextEncode",
          inputs: {
            text: "old positive",
          },
        },
        "negative-text": {
          class_type: "CLIPTextEncode",
          inputs: {
            text: "old negative",
            caption: "old caption",
            exactNegative: "{{negative_prompt}}",
          },
        },
        checkpointWrapper: {
          class_type: "Note",
          inputs: {
            nested: [
              {
                class_type: "CheckpointLoaderSimple",
                inputs: {
                  ckpt_name: "nested.safetensors",
                },
              },
            ],
          },
        },
      }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pollIntervalMs: 1,
    });

    const result = await provider.generateImage({
      model: "nested.safetensors",
      prompt: "new positive prompt",
      negativePrompt: "new negative prompt",
    });

    const queueBody = JSON.parse(String(fetchImpl.mock.calls[1][1]?.body));
    expect(queueBody.prompt["positive-text"].inputs.text).toBe("new positive prompt");
    expect(queueBody.prompt["negative-text"].inputs.text).toBe("new negative prompt");
    expect(queueBody.prompt["negative-text"].inputs.caption).toBe("new negative prompt");
    expect(queueBody.prompt["negative-text"].inputs.exactNegative).toBe("new negative prompt");
    expect(result.images.map((image) => image.url)).toEqual([
      "http://127.0.0.1:8188/view?filename=node-10.png&subfolder=&type=output",
      "http://127.0.0.1:8188/view?filename=node-2.png&subfolder=&type=output",
    ]);
  });

  it("covers ComfyUI primitive node errors and response-body timeout failures", async () => {
    await expect(
      new ComfyUIImageProvider({
        endpoint: "http://127.0.0.1:8188",
        workflowJson: JSON.stringify({ "1": { class_type: "SaveImage", inputs: { text: "{{prompt}}" } } }),
        fetchImpl: vi.fn().mockResolvedValueOnce(
          new Response(JSON.stringify({ prompt_id: "prompt-node-primitive", node_errors: "bad node" }), {
            status: 200,
          }),
        ) as unknown as typeof fetch,
      }).generateImage({ model: "local", prompt: "map" }),
    ).rejects.toThrow(/node_errors/i);

    vi.useFakeTimers();
    try {
      const timeoutBody = {
        ok: false,
        status: 503,
        statusText: "Unavailable",
        text: () => new Promise<string>(() => undefined),
      } as Response;
      const provider = new ComfyUIImageProvider({
        endpoint: "http://127.0.0.1:8188",
        workflowJson: JSON.stringify({ "1": { class_type: "SaveImage", inputs: { text: "{{prompt}}" } } }),
        requestTimeoutMs: 25,
        fetchImpl: vi.fn().mockResolvedValueOnce(timeoutBody) as unknown as typeof fetch,
      });

      const pending = expect(provider.generateImage({ model: "local", prompt: "map" })).rejects.toThrow(/timed out/i);
      await vi.advanceTimersByTimeAsync(30);
      await pending;
    } finally {
      vi.useRealTimers();
    }
  });

  it("covers ComfyUI no-AbortController unreadable body fallback", async () => {
    const originalAbortController = globalThis.AbortController;
    vi.stubGlobal("AbortController", undefined);
    try {
      const unreadableBody = {
        ok: false,
        status: 500,
        statusText: "Fallback body",
        text: () => Promise.reject(new Error("body locked")),
      } as Response;

      await expect(
        new ComfyUIImageProvider({
          endpoint: "http://127.0.0.1:8188",
          workflowJson: JSON.stringify({ "1": { class_type: "SaveImage", inputs: { text: "{{prompt}}" } } }),
          fetchImpl: vi.fn().mockResolvedValueOnce(unreadableBody) as unknown as typeof fetch,
        }).generateImage({ model: "local", prompt: "map" }),
      ).rejects.toThrow(/queue failed \(500\): Fallback body/i);
    } finally {
      vi.stubGlobal("AbortController", originalAbortController);
    }
  });
});
