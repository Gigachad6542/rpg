import { describe, expect, it, vi } from "vitest";

import {
  persistGeneratedImageLocally,
  type PersistGeneratedImageDeps,
} from "../../src/app/imagePersistence";

type InvokeImpl = PersistGeneratedImageDeps["invokeImpl"];

function pngResponse(bytes: Uint8Array, ok = true): Response {
  return {
    ok,
    blob: async () => ({
      type: "image/png",
      arrayBuffer: async () => bytes.buffer,
    }),
  } as unknown as Response;
}

describe("generated image persistence", () => {
  it("persists downloaded image bytes through the desktop command and returns an asset URL", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const fetchImpl = vi.fn(async () => pngResponse(bytes));
    const invokeImpl = vi.fn(async () => "C:/app-data/generated-images/map_1.png");
    const convertFileSrcImpl = vi.fn((path: string) => `asset://localhost/${encodeURIComponent(path)}`);

    const result = await persistGeneratedImageLocally("map_1", "http://127.0.0.1:8188/view?f=x.png", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      invokeImpl: invokeImpl as unknown as InvokeImpl,
      convertFileSrcImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:8188/view?f=x.png");
    expect(invokeImpl).toHaveBeenCalledWith("persist_generated_image", {
      artifactId: "map_1",
      format: "png",
      base64Data: btoa(String.fromCharCode(...bytes)),
    });
    expect(result).toBe(`asset://localhost/${encodeURIComponent("C:/app-data/generated-images/map_1.png")}`);
  });

  it("fails open when the download or the desktop command fails", async () => {
    const failedFetch = vi.fn(async () => pngResponse(new Uint8Array([1]), false));
    expect(
      await persistGeneratedImageLocally("map_1", "http://127.0.0.1:8188/view", {
        fetchImpl: failedFetch as unknown as typeof fetch,
        invokeImpl: vi.fn(),
        convertFileSrcImpl: (path) => path,
      }),
    ).toBeNull();

    const rejectingInvoke = vi.fn(async () => {
      throw new Error("desktop command rejected the payload");
    });
    expect(
      await persistGeneratedImageLocally("map_1", "http://127.0.0.1:8188/view", {
        fetchImpl: vi.fn(async () => pngResponse(new Uint8Array([1]))) as unknown as typeof fetch,
        invokeImpl: rejectingInvoke as unknown as InvokeImpl,
        convertFileSrcImpl: (path) => path,
      }),
    ).toBeNull();

    expect(
      await persistGeneratedImageLocally("map_1", "http://127.0.0.1:8188/view", {
        fetchImpl: vi.fn(async () => pngResponse(new Uint8Array([1]))) as unknown as typeof fetch,
        invokeImpl: vi.fn(async () => "") as unknown as InvokeImpl,
        convertFileSrcImpl: (path) => path,
      }),
    ).toBeNull();
  });
});
