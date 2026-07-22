export interface ModelInfo {
  id: string;
  displayName: string;
  providerId: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsStreaming?: boolean;
  supportsJson?: boolean;
  supportsReasoning?: boolean;
  tags?: string[];
  notes?: string;
  referenceOnly?: boolean;
  apiKey?: never;
}

export type TextResponseFormat =
  | { type: "json_object" }
  | {
      type: "json_schema";
      json_schema: {
        name: string;
        strict?: boolean;
        schema: Record<string, unknown>;
      };
    };

export interface TextReasoningConfig {
  enabled?: boolean;
  effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens?: number;
  exclude?: boolean;
}

export type TextReasoningFormat = "text" | "summary" | "mixed" | "encrypted" | "unavailable";

/** Provider-returned reasoning. `trace` is private, ephemeral diagnostic data. */
export interface TextReasoningObservation {
  trace?: string;
  format: TextReasoningFormat;
  encrypted: boolean;
  tokenCount?: number;
}

export interface TextGenerationRequest {
  model: string;
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  seed?: number;
  responseFormat?: TextResponseFormat;
  reasoning?: TextReasoningConfig;
  maxOutputTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
}

export interface TextUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface TextGenerationResponse {
  providerId: string;
  model: string;
  text: string;
  finishReason: "stop" | "length" | "tool_call" | "error";
  usage: TextUsage;
  usageSource?: "provider" | "estimated";
  reasoning?: TextReasoningObservation;
  raw?: unknown;
}

export interface TextChunk {
  text: string;
  index: number;
  done: boolean;
  /** Present on the terminal chunk when the provider reports why generation ended. */
  finishReason?: TextGenerationResponse["finishReason"];
  /** Present on the terminal chunk when the streaming provider reports complete usage. */
  usage?: TextUsage;
  usageSource?: "provider" | "estimated";
  /** Separate from player-visible `text`; callers must not append this to the reply. */
  reasoning?: TextReasoningObservation;
}

export interface TextModelAdapter {
  id: string;
  displayName: string;
  listModels(): Promise<ModelInfo[]>;
  generateText(request: TextGenerationRequest): Promise<TextGenerationResponse>;
  streamText?(request: TextGenerationRequest): AsyncIterable<TextChunk>;
}
