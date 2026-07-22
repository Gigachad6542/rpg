import { describe, expect, it, vi } from "vitest";

import {
  readBoundedResponseJson,
  readBoundedResponseText,
} from "../../src/providers/boundedResponse";
import { fetchComfyUIImageModels } from "../../src/providers/comfyUIProvider";

describe("bounded provider responses", () => {
  it("rejects an oversized declared body before reading it", async () => {
    const response = new Response("small", {
      headers: { "content-length": "2048" },
    });

    await expect(readBoundedResponseText(response, {
      maxBytes: 1024,
      label: "Test response",
    })).rejects.toThrow(/2048|safety limit/i);
  });

  it("stops a chunked body as soon as its accumulated bytes exceed the limit", async () => {
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(700));
        controller.enqueue(new Uint8Array(700));
        controller.close();
      },
    }));

    await expect(readBoundedResponseText(response, {
      maxBytes: 1024,
      label: "Chunked response",
    })).rejects.toThrow(/safety limit/i);
  });

  it("parses a JSON body only after bounded streaming completes", async () => {
    const response = new Response(JSON.stringify({ ready: true }));

    await expect(readBoundedResponseJson<{ ready: boolean }>(response, {
      maxBytes: 1024,
      label: "JSON response",
    })).resolves.toEqual({ ready: true });
  });

  it("enforces the bound in the ComfyUI JSON path and disables redirects", async () => {
    const response = new Response("{}", {
      headers: { "content-length": String(9 * 1024 * 1024) },
    });
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      return response;
    });

    await expect(fetchComfyUIImageModels({
      endpoint: "http://127.0.0.1:8188",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })).rejects.toThrow(/safety limit/i);
    expect(response.bodyUsed).toBe(false);
  });
});
