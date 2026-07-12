// Provider, model, and runtime-settings parsing plus text-provider construction, extracted from App.tsx.
import { MockTextProvider } from "../providers/mockTextProvider";
import { OpenAICompatibleTextProvider } from "../providers/openAICompatibleProvider";
import { mockNarratorModel, qwen37MaxReferencePreset } from "../providers/modelPresets";
import type { ModelInfo } from "../providers/TextModelAdapter";
import { TauriStoredSecretTextProvider } from "../providers/tauriStoredSecretTextProvider";
import { parseSecretReference } from "../security/keyStorage";
import type {
  ImageProviderSettings,
  ModelChoice,
  PromptRun,
  ProviderSettings,
  RuntimeCard,
  RuntimeSettings,
} from "./runtimeTypes";
import { toBoundedFloat, toBoundedNumber } from "./appUtils";
import {
  alibabaModelChoices,
  comfyUiModelChoices,
  defaultImageProviderSettings,
  defaultProviderSettings,
  defaultRuntimeSettings,
  localImageMinimumImageSize,
  localImageMinimumPollTimeoutMs,
  localImageMinimumUsableCfg,
  localImageMinimumUsableSteps,
  localImageRecommendedCfg,
  localImageRecommendedImageSize,
  localImageRecommendedSampler,
  localImageRecommendedScheduler,
  localImageRecommendedSteps,
  openRouterModelChoices,
} from "./appDefaults";
import {
  buildLocalProviderResponse,
  buildMockExtractionProposal,
  buildMockHiddenContinuityResponse,
  isTauriRuntime,
} from "./turnPromptBuilders";

export function parseProviderSettings(value?: Record<string, unknown>): ProviderSettings {
  const mode = value?.mode === "openai-compatible" ? "openai-compatible" : "mock";
  const providerId =
    typeof value?.providerId === "string" ? value.providerId : mode === "mock" ? "mock" : "alibaba-model-studio";
  const secretReference = parseSecretReference(value?.secretReference);
  const baseUrl = typeof value?.baseUrl === "string" ? value.baseUrl : defaultProviderSettings.baseUrl;
  const normalizedBaseUrl = normalizeProviderBaseUrlOrNull(baseUrl);
  return {
    mode,
    providerId,
    displayName:
      typeof value?.displayName === "string"
        ? value.displayName
        : mode === "mock"
          ? "Mock local runtime"
          : "Alibaba Cloud Model Studio / DashScope",
    baseUrl,
    model:
      typeof value?.model === "string"
        ? value.model
        : mode === "mock"
          ? "mock-narrator"
          : getDefaultTextModel(providerId),
    secretReference:
      secretReference?.providerId === providerId && secretReference.providerBaseUrl === normalizedBaseUrl
        ? secretReference
        : undefined,
  };
}

export function getDefaultTextModel(providerId: string): string {
  if (providerId === "openrouter") {
    return openRouterModelChoices[0].id;
  }
  if (providerId === "mock") {
    return "mock-narrator";
  }
  return qwen37MaxReferencePreset.id;
}

export function getTextModelChoices(settings: ProviderSettings): ModelChoice[] {
  if (settings.providerId === "openrouter") {
    return withCurrentModelChoice(openRouterModelChoices, settings.model);
  }
  if (settings.providerId === "mock") {
    return [{ id: "mock-narrator", label: "Mock Narrator" }];
  }
  return withCurrentModelChoice(alibabaModelChoices, settings.model);
}

export function getConfiguredTextModelInfo(settings: ProviderSettings): ModelInfo {
  if (settings.mode === "mock" || settings.providerId === "mock") {
    return { ...mockNarratorModel };
  }
  if (settings.providerId === qwen37MaxReferencePreset.providerId && settings.model === qwen37MaxReferencePreset.id) {
    return { ...qwen37MaxReferencePreset };
  }
  return {
    id: settings.model,
    displayName: settings.model,
    providerId: settings.providerId,
  };
}

export function getImageModelChoices(installedModels: string[], currentModel: string): ModelChoice[] {
  return withCurrentModelChoice(
    dedupeModelChoices([
      ...comfyUiModelChoices,
      ...installedModels.map((model) => ({
        id: model,
        label: model,
      })),
    ]),
    currentModel,
  );
}

export function dedupeModelChoices(choices: ModelChoice[]): ModelChoice[] {
  const seen = new Set<string>();
  return choices.filter((choice) => {
    if (seen.has(choice.id)) {
      return false;
    }
    seen.add(choice.id);
    return true;
  });
}

export function withCurrentModelChoice(choices: ModelChoice[], currentModel: string): ModelChoice[] {
  if (!currentModel || choices.some((choice) => choice.id === currentModel)) {
    return choices;
  }
  return [{ id: currentModel, label: currentModel }, ...choices];
}

export function parseImageProviderSettings(value?: Record<string, unknown>): ImageProviderSettings {
  const mode = value?.mode === "prompt-only" ? "prompt-only" : "comfyui";
  const storedWorkflowJson = typeof value?.workflowJson === "string" ? value.workflowJson : "";
  const model = typeof value?.model === "string" && !isLegacyRemovedImageModel(value.model)
    ? value.model
    : defaultImageProviderSettings.model;
  return normalizeImageProviderQualitySettings({
    mode,
    portraitGenerationMode:
      value?.portraitGenerationMode === "auto" || value?.portraitGenerationMode === "off"
        ? value.portraitGenerationMode
        : "confirm-first",
    providerId: "comfyui",
    displayName: "ComfyUI local API",
    endpoint: typeof value?.endpoint === "string" ? value.endpoint : defaultImageProviderSettings.endpoint,
    model,
    workflowJson:
      storedWorkflowJson && !isLegacyDefaultSdxlWorkflow(storedWorkflowJson)
        ? storedWorkflowJson
        : defaultImageProviderSettings.workflowJson,
    width: toBoundedNumber(typeof value?.width === "number" ? value.width : "", localImageRecommendedImageSize, 1, 2048),
    height: toBoundedNumber(typeof value?.height === "number" ? value.height : "", localImageRecommendedImageSize, 1, 2048),
    seed: toBoundedNumber(typeof value?.seed === "number" ? value.seed : "", -1, -1, 2_147_483_647),
    steps: toBoundedNumber(typeof value?.steps === "number" ? value.steps : "", localImageRecommendedSteps, 1, 150),
    cfg: toBoundedFloat(typeof value?.cfg === "number" ? value.cfg : "", localImageRecommendedCfg, 1, 30),
    samplerName: typeof value?.samplerName === "string" ? value.samplerName : defaultImageProviderSettings.samplerName,
    scheduler: typeof value?.scheduler === "string" ? value.scheduler : defaultImageProviderSettings.scheduler,
    pollTimeoutMs: toBoundedNumber(
      typeof value?.pollTimeoutMs === "number" ? value.pollTimeoutMs : "",
      defaultImageProviderSettings.pollTimeoutMs,
      localImageMinimumPollTimeoutMs,
      600_000,
    ),
  });
}

export function isLegacyRemovedImageModel(model: unknown): boolean {
  return typeof model === "string" && /juggernaut[-_]?xl/i.test(model);
}

export function isLegacyDefaultSdxlWorkflow(workflowJson: string): boolean {
  return (
    workflowJson.includes("CheckpointLoaderSimple") &&
    workflowJson.includes("EmptyLatentImage") &&
    workflowJson.includes("{{model}}") &&
    workflowJson.includes("local_cards")
  );
}

export function normalizeImageProviderQualitySettings(settings: ImageProviderSettings): ImageProviderSettings {
  const width = toLocalImageQualityDimension(settings.width);
  const height = toLocalImageQualityDimension(settings.height);
  const hadLowResolution = settings.width < localImageMinimumImageSize || settings.height < localImageMinimumImageSize;
  const hadPreviewQualitySettings =
    hadLowResolution || settings.steps < localImageMinimumUsableSteps || settings.cfg < localImageMinimumUsableCfg;
  const steps = hadPreviewQualitySettings ? Math.max(settings.steps, localImageRecommendedSteps) : settings.steps;
  const cfg = hadPreviewQualitySettings ? localImageRecommendedCfg : settings.cfg;
  const samplerName =
    hadPreviewQualitySettings && settings.samplerName.trim().toLowerCase() === "euler"
      ? localImageRecommendedSampler
      : settings.samplerName;
  const scheduler =
    hadPreviewQualitySettings && settings.scheduler.trim().toLowerCase() === "normal"
      ? localImageRecommendedScheduler
      : settings.scheduler;
  const pollTimeoutMs =
    settings.pollTimeoutMs < localImageMinimumPollTimeoutMs
      ? defaultImageProviderSettings.pollTimeoutMs
      : settings.pollTimeoutMs;

  if (
    width === settings.width &&
    height === settings.height &&
    steps === settings.steps &&
    cfg === settings.cfg &&
    samplerName === settings.samplerName &&
    scheduler === settings.scheduler &&
    pollTimeoutMs === settings.pollTimeoutMs
  ) {
    return settings;
  }

  return {
    ...settings,
    width,
    height,
    steps,
    cfg,
    samplerName,
    scheduler,
    pollTimeoutMs,
  };
}

export function toLocalImageQualityDimension(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return localImageRecommendedImageSize;
  }
  const dimension = Math.trunc(parsed);
  if (dimension < localImageMinimumImageSize) {
    return localImageRecommendedImageSize;
  }
  return Math.min(2048, dimension);
}

export function parseRuntimeSettings(value?: Record<string, unknown>): RuntimeSettings {
  return {
    textStreaming: typeof value?.textStreaming === "boolean" ? value.textStreaming : defaultRuntimeSettings.textStreaming,
    banEmojis: typeof value?.banEmojis === "boolean" ? value.banEmojis : defaultRuntimeSettings.banEmojis,
    promptDebugLogs:
      typeof value?.promptDebugLogs === "boolean" ? value.promptDebugLogs : defaultRuntimeSettings.promptDebugLogs,
    diceRollsEnabled:
      typeof value?.diceRollsEnabled === "boolean" ? value.diceRollsEnabled : defaultRuntimeSettings.diceRollsEnabled,
    onboardingCompleted:
      typeof value?.onboardingCompleted === "boolean"
        ? value.onboardingCompleted
        : defaultRuntimeSettings.onboardingCompleted,
    accentColor:
      typeof value?.accentColor === "string" && /^#[0-9a-fA-F]{6}$/.test(value.accentColor)
        ? value.accentColor
        : defaultRuntimeSettings.accentColor,
  };
}

export function applyPromptDebugRetention(promptRuns: PromptRun[], settings: RuntimeSettings): PromptRun[] {
  if (settings.promptDebugLogs) {
    return promptRuns;
  }

  let changed = false;
  const retained = promptRuns.map((run) => {
    if (!run.compiledPrompt) {
      return run;
    }
    changed = true;
    return { ...run, compiledPrompt: "" };
  });

  return changed ? retained : promptRuns;
}

export function getAllowedProviderBaseUrl(settings: ProviderSettings): string | null {
  const normalized = normalizeProviderBaseUrlOrNull(settings.baseUrl);
  if (!normalized) {
    return null;
  }
  if (settings.providerId === "local") {
    return isLoopbackBaseUrl(normalized) ? normalized : null;
  }

  const knownHostedBaseUrls: Record<string, string> = {
    "alibaba-model-studio": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    openrouter: "https://openrouter.ai/api/v1",
  };
  const knownBaseUrl = knownHostedBaseUrls[settings.providerId];
  if (knownBaseUrl) {
    return normalized === knownBaseUrl ? normalized : null;
  }

  return null;
}

export function normalizeProviderBaseUrlOrNull(value: string): string | null {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function isLoopbackBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

export function isHostedDesktopProvider(settings: ProviderSettings): boolean {
  return isTauriRuntime() && settings.providerId !== "local" && settings.mode !== "mock";
}

export function createTextProvider(
  settings: ProviderSettings,
  sessionApiKey: string,
  card: RuntimeCard,
  draft: string,
  activeLoreCount: number,
) {
  if (settings.mode === "mock") {
    return new MockTextProvider({
      responses: [
        JSON.stringify(buildMockHiddenContinuityResponse(card, draft)),
        JSON.stringify({
          assistant_message: buildLocalProviderResponse(card, draft, activeLoreCount),
          extraction: buildMockExtractionProposal(card, draft),
        }),
      ],
    });
  }

  const baseUrl = getAllowedProviderBaseUrl(settings);
  if (!baseUrl) {
    throw new Error("Provider endpoint must be the known hosted URL or a loopback local endpoint.");
  }
  if (settings.providerId !== "local" && settings.secretReference) {
    return new TauriStoredSecretTextProvider({
      id: settings.providerId,
      displayName: settings.displayName,
      baseUrl,
      secretReference: settings.secretReference,
      models: [getConfiguredTextModelInfo(settings)],
    });
  }
  if (isHostedDesktopProvider(settings)) {
    throw new Error("Store this hosted provider key in the OS keychain before generation.");
  }

  return new OpenAICompatibleTextProvider({
    id: settings.providerId,
    displayName: settings.displayName,
    baseUrl,
    apiKey: sessionApiKey,
    allowUnauthenticated: settings.providerId === "local",
    models: [getConfiguredTextModelInfo(settings)],
  });
}
