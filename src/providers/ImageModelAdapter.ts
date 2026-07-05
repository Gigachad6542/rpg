export interface ImageGenerationRequest {
  model: string;
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  seed?: number;
  steps?: number;
  cfg?: number;
  samplerName?: string;
  scheduler?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
}

export interface ImageGenerationResponse {
  providerId: string;
  model: string;
  images: Array<{
    url?: string;
    bytes?: Uint8Array;
    mimeType?: string;
  }>;
  raw?: unknown;
}

export interface ImagePromptRequest {
  scenePrompt: string;
  negativePrompt?: string;
  providerFormatting?: string;
}

export interface ImageModelAdapter {
  id: string;
  displayName: string;
  generateImage?(request: ImageGenerationRequest): Promise<ImageGenerationResponse>;
  compilePromptOnly?(request: ImagePromptRequest): Promise<string>;
}
