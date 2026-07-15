import { ComfyUIImageProvider } from "../providers/comfyUIProvider";
import type {
  ImageGenerationRequest,
  ImageGenerationResponse,
} from "../providers/ImageModelAdapter";
import { persistGeneratedImageLocally } from "./imagePersistence";
import { normalizeImageProviderQualitySettings } from "./providerConfig";
import type { GeneratedMapArtifact, ImageProviderSettings } from "./runtimeTypes";

type ImageGenerationProvider = {
  generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResponse>;
};

type ImageProviderFactory = (
  settings: ImageProviderSettings,
  sessionApiKey: string,
) => ImageGenerationProvider;

function createComfyUiProvider(
  settings: ImageProviderSettings,
  sessionApiKey: string,
): ImageGenerationProvider {
  return new ComfyUIImageProvider({
    endpoint: settings.endpoint,
    workflowJson: settings.workflowJson,
    model: settings.model,
    apiKey: sessionApiKey,
    pollTimeoutMs: settings.pollTimeoutMs,
  });
}

export async function generateConfiguredImageArtifact(input: {
  settings: ImageProviderSettings;
  sessionApiKey: string;
  baseArtifact: GeneratedMapArtifact;
  prompt: string;
  negativePrompt: string;
  metadata: Record<string, unknown>;
  desktopRuntime: boolean;
  createProvider?: ImageProviderFactory;
  persistImage?: (artifactId: string, imageUrl: string) => Promise<string | null>;
}): Promise<{
  artifact: GeneratedMapArtifact;
  settings: ImageProviderSettings;
}> {
  const settings = normalizeImageProviderQualitySettings(input.settings);
  if (settings.mode === "prompt-only" || !settings.workflowJson.trim()) {
    return {
      settings,
      artifact: {
        ...input.baseArtifact,
        status: settings.mode === "comfyui" ? "error" : input.baseArtifact.status,
        error:
          settings.mode === "comfyui"
            ? "Paste a ComfyUI API workflow in Image Provider settings to generate an image."
            : undefined,
      },
    };
  }

  const provider = (input.createProvider ?? createComfyUiProvider)(settings, input.sessionApiKey);
  const result = await provider.generateImage({
    model: settings.model,
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    width: settings.width,
    height: settings.height,
    seed: settings.seed,
    steps: settings.steps,
    cfg: settings.cfg,
    samplerName: settings.samplerName,
    scheduler: settings.scheduler,
    metadata: input.metadata,
  });
  const imageUrl = result.images[0]?.url;
  if (!imageUrl) {
    return {
      settings,
      artifact: {
        ...input.baseArtifact,
        provider: result.providerId,
        status: "error",
        error: "Image provider finished without an image output.",
      },
    };
  }

  const artifact: GeneratedMapArtifact = {
    ...input.baseArtifact,
    provider: result.providerId,
    status: "generated",
    imageUrl,
  };
  if (!input.desktopRuntime) {
    return { settings, artifact };
  }

  const durableImageUrl = await (input.persistImage ?? persistGeneratedImageLocally)(artifact.id, imageUrl);
  return {
    settings,
    artifact: durableImageUrl ? { ...artifact, imageUrl: durableImageUrl } : artifact,
  };
}
