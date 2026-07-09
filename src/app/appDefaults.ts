// Default runtime constants and seed data extracted from App.tsx.
import { type CompiledPrompt } from "../runtime/promptCompiler";
import { qwen37MaxReferencePreset, recommendedLocalImageProvider } from "../providers/modelPresets";
import type {
  CardKind,
  ImageProviderSettings,
  Message,
  ModelChoice,
  NewLorebookEntry,
  NewPlayerRule,
  ProviderSettings,
  RuntimeCard,
  RuntimeSettings,
} from "./runtimeTypes";
import { createDefaultRpgPlayerRules, createInitialStoryEntities } from "./cardNormalization";

export const initialCards: RuntimeCard[] = [
  {
    id: "card_blank_slate_rpg",
    name: "Blank Slate RPG",
    kind: "rpg",
    summary: "Empty RPG card for user-defined world rules, lore, state, and map generation.",
    characterName: "",
    characterDescription: "",
    scenario: "",
    greeting: "",
    exampleDialogs: "",
    systemPrompt:
      "Run only the RPG defined by this card. Do not invent permanent mechanics, lore, locations, rewards, or win conditions until they are established by the card, chat history, or active lorebook entries.",
    preHistoryInstructions: "",
    postHistoryInstructions: "",
    playerRules: createDefaultRpgPlayerRules(),
    mapEnabled: true,
    lorebooks: [],
    memory: [],
    storyEntities: createInitialStoryEntities("card_blank_slate_rpg"),
    rpg: {
      location: "Unmapped starting area",
      health: "not configured",
      inventory: [],
      quests: [],
      flags: {},
      knownPlaces: [],
      mapStyle: "birdseye map, readable labels, clean cartographic layout",
    },
  },
];

export const starterMessages: Message[] = [];
export const randomOpeningAction = "Surprise me with a random opening scene.";

export const defaultNewCard = {
  name: "",
  kind: "character" as CardKind,
  summary: "",
  characterName: "",
  characterDescription: "",
  scenario: "",
  greeting: "",
  exampleDialogs: "",
  systemPrompt: "",
  preHistoryInstructions: "",
  postHistoryInstructions: "",
  playerRules: "",
  lorebookName: "",
  mapEnabled: false,
};

export const defaultNewLorebookEntry: NewLorebookEntry = {
  title: "",
  keys: "",
  secondaryKeys: "",
  content: "",
  insertionOrder: "100",
  priority: "0",
  constant: false,
  probability: "100",
  caseSensitive: false,
  wholeWord: false,
};

export const defaultNewPlayerRule: NewPlayerRule = {
  title: "",
  description: "",
};

export const defaultProviderSettings: ProviderSettings = {
  mode: "mock",
  providerId: "mock",
  displayName: "Mock local runtime",
  baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  model: "mock-narrator",
};

export const openRouterModelChoices: ModelChoice[] = [
  { id: "qwen/qwen3-235b-a22b", label: "Qwen3 235B A22B" },
  { id: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
  { id: "openai/gpt-4o-mini", label: "GPT-4o Mini" },
  { id: "google/gemini-2.0-flash-001", label: "Gemini 2.0 Flash" },
  { id: "meta-llama/llama-3.1-70b-instruct", label: "Llama 3.1 70B Instruct" },
];

export const alibabaModelChoices: ModelChoice[] = [
  { id: qwen37MaxReferencePreset.id, label: qwen37MaxReferencePreset.displayName },
];

export const defaultComfyWorkflowJson = JSON.stringify(
  {
    "1": {
      class_type: "UNETLoader",
      inputs: {
        unet_name: "{{model}}",
        weight_dtype: "default",
      },
    },
    "2": {
      class_type: "CLIPLoader",
      inputs: {
        clip_name: "mistral_3_small_flux2_fp8.safetensors",
        type: "flux2",
      },
    },
    "3": {
      class_type: "VAELoader",
      inputs: {
        vae_name: "flux2-vae.safetensors",
      },
    },
    "4": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["2", 0],
        text: "{{prompt}}",
      },
    },
    "5": {
      class_type: "FluxGuidance",
      inputs: {
        conditioning: ["4", 0],
        guidance: "{{cfg}}",
      },
    },
    "6": {
      class_type: "ModelSamplingFlux",
      inputs: {
        model: ["1", 0],
        width: "{{width}}",
        height: "{{height}}",
        max_shift: 1.15,
        base_shift: 0.5,
      },
    },
    "7": {
      class_type: "EmptyFlux2LatentImage",
      inputs: {
        width: "{{width}}",
        height: "{{height}}",
        batch_size: 1,
      },
    },
    "8": {
      class_type: "BasicGuider",
      inputs: {
        model: ["6", 0],
        conditioning: ["5", 0],
      },
    },
    "9": {
      class_type: "KSamplerSelect",
      inputs: {
        sampler_name: "{{sampler}}",
      },
    },
    "10": {
      class_type: "Flux2Scheduler",
      inputs: {
        steps: "{{steps}}",
        width: "{{width}}",
        height: "{{height}}",
      },
    },
    "11": {
      class_type: "RandomNoise",
      inputs: {
        noise_seed: "{{seed}}",
      },
    },
    "12": {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        noise: ["11", 0],
        guider: ["8", 0],
        sampler: ["9", 0],
        sigmas: ["10", 0],
        latent_image: ["7", 0],
      },
    },
    "13": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["12", 0],
        vae: ["3", 0],
      },
    },
    "14": {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: "local_cards",
        images: ["13", 0],
      },
    },
  },
  null,
  2,
);

export const localImageRecommendedImageSize = 1024;
export const localImageMinimumImageSize = 768;
export const localImageRecommendedSteps = 28;
export const localImageMinimumUsableSteps = 8;
export const localImageRecommendedCfg = 3.5;
export const localImageMinimumUsableCfg = 1.5;
export const localImageRecommendedSampler = "euler";
export const localImageRecommendedScheduler = "simple";
export const localImageMinimumPollTimeoutMs = 120_000;

export const defaultImageProviderSettings: ImageProviderSettings = {
  mode: "comfyui",
  providerId: recommendedLocalImageProvider.providerId,
  displayName: "ComfyUI local API",
  endpoint: recommendedLocalImageProvider.endpoint,
  model: recommendedLocalImageProvider.model,
  workflowJson: defaultComfyWorkflowJson,
  width: localImageRecommendedImageSize,
  height: localImageRecommendedImageSize,
  seed: -1,
  steps: localImageRecommendedSteps,
  cfg: localImageRecommendedCfg,
  samplerName: localImageRecommendedSampler,
  scheduler: localImageRecommendedScheduler,
  pollTimeoutMs: 600_000,
};

export const customImagePresetPrompt =
  "realistic, 4k, high-detail, sharp focus, natural lighting, cinematic composition, vivid but grounded colors";

export const customImageNegativePrompt =
  "low resolution, blurry, watermark, logo, text artifacts, distorted anatomy, malformed objects, noisy artifacts";

export const characterPortraitPresetPrompt =
  "RPG character portrait, shoulders-up, clear face, consistent storybook realism, high-detail, natural lighting, neutral background, no text";

export const characterPortraitNegativePrompt =
  "low resolution, blurry, watermark, logo, text artifacts, extra limbs, distorted face, malformed hands, duplicate character";

export const maxGeneratedMediaArtifacts = 80;

export const comfyUiModelChoices: ModelChoice[] = [
  { id: recommendedLocalImageProvider.model, label: "FLUX.2 dev FP8 mixed" },
  { id: "flux2-dev-nvfp4-mixed.safetensors", label: "FLUX.2 dev NVFP4 mixed" },
  { id: "sd_xl_base_1.0.safetensors", label: "SDXL Base 1.0" },
  { id: "dreamshaperXL_v21TurboDPMSDE.safetensors", label: "DreamShaper XL Turbo" },
];

export const defaultRuntimeSettings: RuntimeSettings = {
  textStreaming: false,
  banEmojis: false,
  promptDebugLogs: false,
  diceRollsEnabled: false,
  onboardingCompleted: false,
  impersonationPrompt: "",
  accentColor: "",
};

export const emptyCompiledPrompt: CompiledPrompt = {
  prompt: "",
  includedLayers: [],
  omittedLayers: [],
  truncatedLayerIds: [],
  tokenEstimate: 0,
};
