// Provider, model, and runtime-settings parsing plus text-provider construction, extracted from App.tsx.
import { MockTextProvider } from "../providers/mockTextProvider";
import { OpenAICompatibleTextProvider } from "../providers/openAICompatibleProvider";
import { mockNarratorModel, qwen37MaxReferencePreset } from "../providers/modelPresets";
import type { ModelInfo } from "../providers/TextModelAdapter";
import { TauriStoredSecretTextProvider } from "../providers/tauriStoredSecretTextProvider";
import { parseSecretReference } from "../security/keyStorage";
import { sanitizeThemeColorOverrides } from "./themeColors";
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
  const model =
    typeof value?.model === "string"
      ? value.model
      : mode === "mock"
        ? "mock-narrator"
        : getDefaultTextModel(providerId);
  const contextWindowTokens = readPositiveInteger(value?.contextWindowTokens, 4_096_000);
  const maxOutputTokens = readPositiveInteger(value?.maxOutputTokens, contextWindowTokens ?? 1_000_000);
  const pricing = parseModelPricing(value?.pricing, model);
  const economicalPricing = parseModelPricing(value?.economicalPricing);
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
    model,
    ...(contextWindowTokens === undefined ? {} : { contextWindowTokens }),
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    ...(pricing ? { pricing } : {}),
    ...(economicalPricing ? { economicalPricing } : {}),
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
    ...(settings.contextWindowTokens === undefined ? {} : { contextWindow: settings.contextWindowTokens }),
    ...(settings.maxOutputTokens === undefined ? {} : { maxOutputTokens: settings.maxOutputTokens }),
  };
}

/**
 * Resolves metadata for an explicit routed model without borrowing context
 * limits that were entered for the selected visible model.
 */
export function getConfiguredTextModelInfoForModel(settings: ProviderSettings, model: string): ModelInfo {
  if (model === settings.model) {
    return getConfiguredTextModelInfo(settings);
  }
  if (settings.providerId === qwen37MaxReferencePreset.providerId && model === qwen37MaxReferencePreset.id) {
    return { ...qwen37MaxReferencePreset };
  }
  return {
    id: model,
    displayName: model,
    providerId: settings.providerId,
  };
}

function readPositiveInteger(value: unknown, maximum: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(maximum, Math.floor(value))
    : undefined;
}

function parseModelPricing(value: unknown, expectedModel?: string): ProviderSettings["pricing"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.model !== "string" ||
    record.model.length === 0 ||
    record.model.length > 300 ||
    (expectedModel !== undefined && record.model !== expectedModel) ||
    record.currency !== "USD" ||
    typeof record.inputUsdPerMillionTokens !== "number" ||
    !Number.isFinite(record.inputUsdPerMillionTokens) ||
    record.inputUsdPerMillionTokens < 0 ||
    typeof record.outputUsdPerMillionTokens !== "number" ||
    !Number.isFinite(record.outputUsdPerMillionTokens) ||
    record.outputUsdPerMillionTokens < 0 ||
    typeof record.source !== "string" ||
    record.source.length === 0 ||
    record.source.length > 200 ||
    typeof record.effectiveDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(record.effectiveDate)
  ) {
    return undefined;
  }
  return {
    model: record.model,
    currency: "USD",
    inputUsdPerMillionTokens: record.inputUsdPerMillionTokens,
    outputUsdPerMillionTokens: record.outputUsdPerMillionTokens,
    source: record.source,
    effectiveDate: record.effectiveDate,
  };
}

export function getProviderPricingSnapshots(settings: ProviderSettings) {
  return [settings.pricing, settings.economicalPricing].filter(
    (snapshot): snapshot is NonNullable<ProviderSettings["pricing"]> => snapshot !== undefined,
  );
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
  const hiddenContinuityMode = value?.hiddenContinuityMode === "off" ||
    value?.hiddenContinuityMode === "economical" ||
    value?.hiddenContinuityMode === "full"
    ? value.hiddenContinuityMode
    : defaultRuntimeSettings.hiddenContinuityMode;
  const settings: RuntimeSettings = {
    textStreaming: typeof value?.textStreaming === "boolean" ? value.textStreaming : defaultRuntimeSettings.textStreaming,
    banEmojis: typeof value?.banEmojis === "boolean" ? value.banEmojis : defaultRuntimeSettings.banEmojis,
    promptDebugLogs:
      typeof value?.promptDebugLogs === "boolean" ? value.promptDebugLogs : defaultRuntimeSettings.promptDebugLogs,
    diceRollsEnabled:
      typeof value?.diceRollsEnabled === "boolean" ? value.diceRollsEnabled : defaultRuntimeSettings.diceRollsEnabled,
    hiddenContinuityMode,
    economicalModel:
      typeof value?.economicalModel === "string" && value.economicalModel.length <= 200
        ? value.economicalModel.trim()
        : defaultRuntimeSettings.economicalModel,
    onboardingCompleted:
      typeof value?.onboardingCompleted === "boolean"
        ? value.onboardingCompleted
        : defaultRuntimeSettings.onboardingCompleted,
    accentColor:
      typeof value?.accentColor === "string" && /^#[0-9a-fA-F]{6}$/.test(value.accentColor)
        ? value.accentColor
        : defaultRuntimeSettings.accentColor,
  };
  const themeColors = sanitizeThemeColorOverrides(value?.themeColors);
  if (Object.keys(themeColors).length > 0) {
    settings.themeColors = themeColors;
  }
  return settings;
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
  includeHiddenContinuityCall = true,
) {
  if (settings.mode === "mock") {
    const visibleResponse = JSON.stringify({
      assistant_message: buildLocalProviderResponse(card, draft, activeLoreCount),
      extraction: buildMockExtractionProposal(card, draft),
    });
    return new MockTextProvider({
      responses: includeHiddenContinuityCall
        ? [JSON.stringify(buildMockHiddenContinuityResponse(card, draft)), visibleResponse]
        : [visibleResponse],
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
