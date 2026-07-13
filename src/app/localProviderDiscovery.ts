import type { ProviderSettings } from "./runtimeTypes";

export type LocalProviderCandidate = {
  id: "ollama" | "lm-studio" | "llama-cpp" | "koboldcpp";
  displayName: string;
  baseUrl: string;
  modelsUrl: string;
};

export type LocalProviderDetection = LocalProviderCandidate & { models: string[] };

export const LOCAL_PROVIDER_CANDIDATES: readonly LocalProviderCandidate[] = [
  { id: "ollama", displayName: "Ollama", baseUrl: "http://127.0.0.1:11434/v1", modelsUrl: "http://127.0.0.1:11434/v1/models" },
  { id: "lm-studio", displayName: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1", modelsUrl: "http://127.0.0.1:1234/v1/models" },
  { id: "llama-cpp", displayName: "llama.cpp server", baseUrl: "http://127.0.0.1:8080/v1", modelsUrl: "http://127.0.0.1:8080/v1/models" },
  { id: "koboldcpp", displayName: "KoboldCpp", baseUrl: "http://127.0.0.1:5001/v1", modelsUrl: "http://127.0.0.1:5001/v1/models" },
];

const MAX_DISCOVERED_MODELS = 100;
const MAX_MODEL_ID_CHARS = 160;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  });
}

export function parseOpenAIModelList(payload: unknown): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return [];
  const seen = new Set<string>();
  const models: string[] = [];
  for (const item of payload.data) {
    if (!isRecord(item) || typeof item.id !== "string") continue;
    const model = item.id.trim();
    if (!model || model.length > MAX_MODEL_ID_CHARS || hasControlCharacters(model) || seen.has(model)) continue;
    seen.add(model);
    models.push(model);
    if (models.length >= MAX_DISCOVERED_MODELS) break;
  }
  return models;
}

export async function probeLocalProviderCandidates(
  probe: (candidate: LocalProviderCandidate) => Promise<unknown>,
): Promise<LocalProviderDetection[]> {
  const settled = await Promise.allSettled(LOCAL_PROVIDER_CANDIDATES.map(async (candidate) => ({
    ...candidate,
    models: parseOpenAIModelList(await probe(candidate)),
  })));
  return settled
    .filter((result): result is PromiseFulfilledResult<LocalProviderDetection> => result.status === "fulfilled")
    .map((result) => result.value)
    .filter((result) => result.models.length > 0);
}

export function buildLocalProviderSettings(
  detection: LocalProviderDetection,
  model = detection.models[0] ?? "local-model",
): ProviderSettings {
  if (!detection.models.includes(model)) throw new Error("Select a model reported by the local server.");
  return {
    mode: "openai-compatible",
    providerId: "local",
    displayName: detection.displayName,
    baseUrl: detection.baseUrl,
    model,
  };
}

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export async function discoverLocalProviders(invokeOverride?: Invoke): Promise<LocalProviderDetection[]> {
  const invoke = invokeOverride ?? await getDesktopInvoke();
  if (invoke) return invoke<LocalProviderDetection[]>("discover_local_text_providers");

  return probeLocalProviderCandidates(async (candidate) => {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), 1_200);
    try {
      const response = await fetch(candidate.modelsUrl, {
        signal: controller.signal,
        cache: "no-store",
        redirect: "error",
      });
      if (!response.ok) throw new Error(`Local model endpoint returned ${response.status}.`);
      const text = await response.text();
      if (text.length > 512_000) throw new Error("Local model response was too large.");
      return JSON.parse(text) as unknown;
    } finally {
      globalThis.clearTimeout(timeout);
    }
  });
}

async function getDesktopInvoke(): Promise<Invoke | undefined> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return undefined;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke as Invoke;
}
