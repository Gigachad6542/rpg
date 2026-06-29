import { estimateTextTokens } from "../runtime/tokenBudget";
import { mockNarratorModel, qwen37MaxReferencePreset } from "./modelPresets";
import type {
  ModelInfo,
  TextChunk,
  TextGenerationRequest,
  TextGenerationResponse,
  TextModelAdapter,
} from "./TextModelAdapter";

export interface MockTextProviderOptions {
  responses?: string[];
  models?: ModelInfo[];
}

export class MockTextProvider implements TextModelAdapter {
  readonly id = "mock";
  readonly displayName = "Mock text provider";

  private responseIndex = 0;
  private readonly responses: string[];
  private readonly models: ModelInfo[];

  constructor(options: MockTextProviderOptions = {}) {
    this.responses = options.responses ?? [];
    this.models = options.models ?? [mockNarratorModel, qwen37MaxReferencePreset];
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.models.map((model) => ({ ...model }));
  }

  async generateText(request: TextGenerationRequest): Promise<TextGenerationResponse> {
    const text = this.nextResponse(request);
    const inputTokens = estimateTextTokens([request.systemPrompt, request.prompt].filter(Boolean).join("\n\n"));
    const outputTokens = estimateTextTokens(text);

    return {
      providerId: this.id,
      model: request.model,
      text,
      finishReason: "stop",
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      raw: {
        mock: true,
      },
    };
  }

  async *streamText(request: TextGenerationRequest): AsyncIterable<TextChunk> {
    const response = await this.generateText(request);

    yield {
      text: response.text,
      index: 0,
      done: true,
    };
  }

  private nextResponse(request: TextGenerationRequest): string {
    if (this.responses.length === 0) {
      return `Mock response for ${request.prompt.slice(0, 120)}`;
    }

    const response = this.responses[this.responseIndex % this.responses.length];
    this.responseIndex += 1;

    return response;
  }
}
