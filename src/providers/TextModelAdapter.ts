export interface ModelInfo {
  id: string;
  displayName: string;
  providerId: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsStreaming?: boolean;
  supportsJson?: boolean;
  tags?: string[];
  notes?: string;
  referenceOnly?: boolean;
  apiKey?: never;
}

export interface TextGenerationRequest {
  model: string;
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
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
}

export interface TextModelAdapter {
  id: string;
  displayName: string;
  listModels(): Promise<ModelInfo[]>;
  generateText(request: TextGenerationRequest): Promise<TextGenerationResponse>;
  streamText?(request: TextGenerationRequest): AsyncIterable<TextChunk>;
}
