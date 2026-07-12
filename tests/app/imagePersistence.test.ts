import { describe, expect, it, vi } from "vitest";

import {
  persistGeneratedImageLocally,
  syncGeneratedImageFiles,
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

function imageResponse(bytes: Uint8Array, type: string, ok = true): Response {
  return {
    ok,
    blob: async () => ({
      type,
      arrayBuffer: async () => bytes.buffer,
    }),
  } as unknown as Response;
}

const JPEG_MAGIC = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

it("asks the desktop backend to remove files not referenced by active artifacts", async () => {
  const invokeImpl = vi.fn(async () => 2) as unknown as InvokeImpl;
  await expect(syncGeneratedImageFiles(["map_1", "image_2"], { invokeImpl })).resolves.toBe(2);
  expect(invokeImpl).toHaveBeenCalledWith("sync_generated_image_files", {
    activeArtifactIds: ["map_1", "image_2"],
  });
});

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

  it("derives the format from the image bytes when the provider omits a Content-Type", async () => {
    const invokeImpl = vi.fn(async () => "C:/app-data/generated-images/map_1.jpg");

    await persistGeneratedImageLocally("map_1", "http://127.0.0.1:8188/view?f=x", {
      fetchImpl: vi.fn(async () => imageResponse(JPEG_MAGIC, "")) as unknown as typeof fetch,
      invokeImpl: invokeImpl as unknown as InvokeImpl,
      convertFileSrcImpl: (path) => path,
    });

    expect(invokeImpl).toHaveBeenCalledWith("persist_generated_image", {
      artifactId: "map_1",
      format: "jpeg",
      base64Data: btoa(String.fromCharCode(...JPEG_MAGIC)),
    });
  });

  it("fails open without persisting when the bytes are not a recognized image", async () => {
    const invokeImpl = vi.fn(async () => "C:/should-not-happen.png");

    const result = await persistGeneratedImageLocally("map_1", "http://127.0.0.1:8188/view", {
      fetchImpl: vi.fn(async () => imageResponse(new Uint8Array([1, 2, 3, 4]), "")) as unknown as typeof fetch,
      invokeImpl: invokeImpl as unknown as InvokeImpl,
      convertFileSrcImpl: (path) => path,
    });

    expect(result).toBeNull();
    expect(invokeImpl).not.toHaveBeenCalled();
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
