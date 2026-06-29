import type { ModelInfo } from "./TextModelAdapter";

export const qwen37MaxReferencePreset: ModelInfo = Object.freeze({
  id: "qwen3.7-max",
  displayName: "Qwen3.7-Max",
  providerId: "alibaba-model-studio",
  contextWindow: 262_144,
  maxOutputTokens: 8_192,
  supportsStreaming: true,
  supportsJson: true,
  tags: ["recommended", "chat", "rpg-runtime", "byok"],
  notes:
    "Recommended LLM preset. Store only provider metadata and a secret reference; never store API keys in SQLite.",
  referenceOnly: true,
});

export const mockNarratorModel: ModelInfo = Object.freeze({
  id: "mock-narrator",
  displayName: "Mock Narrator",
  providerId: "mock",
  contextWindow: 16_000,
  maxOutputTokens: 1_024,
  supportsStreaming: true,
  supportsJson: true,
  tags: ["mock", "test"],
});

export const recommendedLocalImageProvider = Object.freeze({
  id: "comfyui-sdxl-local",
  displayName: "ComfyUI local + user-installed SDXL checkpoint",
  providerId: "comfyui",
  endpoint: "http://127.0.0.1:8188",
  model: "juggernautXL_v9Rundiffusionphoto2.safetensors",
  notes:
    "Free local recommendation for maps and card art. User supplies the exact installed checkpoint filename; app should enforce lawful-use boundaries.",
});
