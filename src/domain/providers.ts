import type {
  EntityTimestamps,
  JsonObject,
  ModelPresetId,
  ModelProviderConfigId,
  SecretRef,
} from "./ids";

export const MODEL_PROVIDER_KINDS = [
  "openai",
  "anthropic",
  "openrouter",
  "local_endpoint",
  "custom",
] as const;

export type ModelProviderKind = (typeof MODEL_PROVIDER_KINDS)[number];

export const MODEL_MODALITIES = ["text", "image", "multimodal"] as const;

export type ModelModality = (typeof MODEL_MODALITIES)[number];

export interface ModelInfo {
  readonly id: string;
  readonly displayName: string;
  readonly modality: ModelModality;
  readonly contextWindow?: number;
  readonly maxOutputTokens?: number;
  readonly supportsStreaming?: boolean;
  readonly supportsTools?: boolean;
}

export interface BaseModelProviderConfig extends EntityTimestamps {
  readonly id: ModelProviderConfigId;
  readonly providerKind: ModelProviderKind;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly secretRef?: SecretRef;
  readonly endpointUrl?: string;
  readonly defaultModel?: string;
  readonly defaultSettings?: JsonObject;
}

export interface OpenAIProviderConfig extends BaseModelProviderConfig {
  readonly providerKind: "openai";
  readonly organizationId?: string;
  readonly projectId?: string;
}

export interface AnthropicProviderConfig extends BaseModelProviderConfig {
  readonly providerKind: "anthropic";
}

export interface OpenRouterProviderConfig extends BaseModelProviderConfig {
  readonly providerKind: "openrouter";
  readonly appReferer?: string;
  readonly appTitle?: string;
}

export interface LocalEndpointProviderConfig extends BaseModelProviderConfig {
  readonly providerKind: "local_endpoint";
  readonly endpointUrl: string;
  readonly secretRef?: never;
}

export interface CustomProviderConfig extends BaseModelProviderConfig {
  readonly providerKind: "custom";
  readonly requestTemplate?: JsonObject;
}

export type ModelProviderConfig =
  | OpenAIProviderConfig
  | AnthropicProviderConfig
  | OpenRouterProviderConfig
  | LocalEndpointProviderConfig
  | CustomProviderConfig;

export interface ModelPreset extends EntityTimestamps {
  readonly id: ModelPresetId;
  readonly providerConfigId: ModelProviderConfigId;
  readonly name: string;
  readonly model: string;
  readonly modality: ModelModality;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly topP?: number;
  readonly frequencyPenalty?: number;
  readonly presencePenalty?: number;
  readonly stopSequences: readonly string[];
  readonly metadata?: JsonObject;
}

export interface TextGenerationRequest {
  readonly prompt: string;
  readonly model: string;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly metadata?: JsonObject;
}

export interface TextChunk {
  readonly text: string;
  readonly done?: boolean;
  readonly metadata?: JsonObject;
}

export interface TextGenerationResponse {
  readonly text: string;
  readonly model: string;
  readonly finishReason?: "stop" | "length" | "tool_call" | "error";
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly raw?: JsonObject;
}

export interface ImageGenerationRequest {
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly model: string;
  readonly width?: number;
  readonly height?: number;
  readonly seed?: number;
  readonly metadata?: JsonObject;
}

export interface ImageGenerationResponse {
  readonly imageUris: readonly string[];
  readonly seed?: number;
  readonly model: string;
  readonly raw?: JsonObject;
}

export interface ImagePromptRequest {
  readonly sceneSummary: string;
  readonly stylePreset?: string;
  readonly metadata?: JsonObject;
}

export interface TextModelAdapter {
  readonly id: string;
  readonly displayName: string;
  listModels(): Promise<ModelInfo[]>;
  generateText(request: TextGenerationRequest): Promise<TextGenerationResponse>;
  streamText?(request: TextGenerationRequest): AsyncIterable<TextChunk>;
}

export interface ImageModelAdapter {
  readonly id: string;
  readonly displayName: string;
  generateImage?(request: ImageGenerationRequest): Promise<ImageGenerationResponse>;
  compilePromptOnly?(request: ImagePromptRequest): Promise<string>;
}
