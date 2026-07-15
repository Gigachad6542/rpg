import { describe, expect, it, vi } from "vitest";

import { defaultImageProviderSettings } from "../../src/app/appDefaults";
import { generateConfiguredImageArtifact } from "../../src/app/assetService";
import type { GeneratedMapArtifact } from "../../src/app/runtimeTypes";

const baseArtifact: GeneratedMapArtifact = {
  id: "map-test",
  imageKind: "map",
  cardId: "card-test",
  chatId: "chat-test",
  prompt: "Aerial map",
  negativePrompt: "watermark",
  provider: "prompt-only",
  model: "flux2.safetensors",
  status: "prompt-only",
  createdAt: "2026-07-14T00:00:00.000Z",
};

describe("assetService", () => {
  it("preserves a prompt-only artifact without constructing a provider", async () => {
    const createProvider = vi.fn();

    const result = await generateConfiguredImageArtifact({
      settings: { ...defaultImageProviderSettings, mode: "prompt-only" },
      sessionApiKey: "",
      baseArtifact,
      prompt: baseArtifact.prompt,
      negativePrompt: baseArtifact.negativePrompt,
      metadata: {},
      desktopRuntime: false,
      createProvider,
    });

    expect(result.artifact).toEqual(baseArtifact);
    expect(createProvider).not.toHaveBeenCalled();
  });

  it("returns an actionable error when ComfyUI has no API workflow", async () => {
    const result = await generateConfiguredImageArtifact({
      settings: { ...defaultImageProviderSettings, workflowJson: "" },
      sessionApiKey: "",
      baseArtifact,
      prompt: baseArtifact.prompt,
      negativePrompt: baseArtifact.negativePrompt,
      metadata: {},
      desktopRuntime: false,
    });

    expect(result.artifact.status).toBe("error");
    expect(result.artifact.error).toContain("Paste a ComfyUI API workflow");
  });

  it("rejects a provider response that contains no image", async () => {
    const result = await generateConfiguredImageArtifact({
      settings: defaultImageProviderSettings,
      sessionApiKey: "",
      baseArtifact,
      prompt: baseArtifact.prompt,
      negativePrompt: baseArtifact.negativePrompt,
      metadata: {},
      desktopRuntime: false,
      createProvider: () => ({
        generateImage: vi.fn().mockResolvedValue({
          providerId: "comfyui",
          model: defaultImageProviderSettings.model,
          images: [],
        }),
      }),
    });

    expect(result.artifact).toMatchObject({
      provider: "comfyui",
      status: "error",
      error: "Image provider finished without an image output.",
    });
  });

  it("replaces a transient image URL with the durable desktop asset URL", async () => {
    const persistImage = vi.fn().mockResolvedValue("asset://generated/map-test.png");
    const result = await generateConfiguredImageArtifact({
      settings: defaultImageProviderSettings,
      sessionApiKey: "",
      baseArtifact,
      prompt: baseArtifact.prompt,
      negativePrompt: baseArtifact.negativePrompt,
      metadata: { cardId: "card-test" },
      desktopRuntime: true,
      persistImage,
      createProvider: () => ({
        generateImage: vi.fn().mockResolvedValue({
          providerId: "comfyui",
          model: defaultImageProviderSettings.model,
          images: [{ url: "blob:transient" }],
        }),
      }),
    });

    expect(persistImage).toHaveBeenCalledWith("map-test", "blob:transient");
    expect(result.artifact).toMatchObject({
      status: "generated",
      imageUrl: "asset://generated/map-test.png",
    });
  });
});
