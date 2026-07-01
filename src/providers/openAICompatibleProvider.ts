import { estimateTextTokens } from "../runtime/tokenBudget";
import type {
  ModelInfo,
  TextChunk,
  TextGenerationRequest,
  TextGenerationResponse,
  TextModelAdapter,
} from "./TextModelAdapter";

export interface OpenAICompatibleTextProviderConfig {
  id?: string;
  displayName?: string;
  baseUrl: string;
  apiKey?: string;
  allowUnauthenticated?: boolean;
  defaultHeaders?: Record<string, string>;
  models?: ModelInfo[];
  fetchImpl?: typeof fetch;
}

interface ChatCompletionChoice {
  message?: {
    content?: string | null;
  };
  finish_reason?: string | null;
}

interface ChatCompletionResponse {
  choices?: ChatCompletionChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export class OpenAICompatibleTextProvider implements TextModelAdapter {
  readonly id: string;
  readonly displayName: string;

  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly allowUnauthenticated: boolean;
  private readonly defaultHeaders: Record<string, string>;
  private readonly models: ModelInfo[];
  private readonly fetchImpl: typeof fetch;

  constructor(config: OpenAICompatibleTextProviderConfig) {
    this.id = config.id ?? "openai-compatible";
    this.displayName = config.displayName ?? "OpenAI-compatible provider";
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.apiKey = config.apiKey?.trim() || undefined;
    this.allowUnauthenticated = config.allowUnauthenticated ?? false;
    if (this.allowUnauthenticated && !isLoopbackBaseUrl(this.baseUrl)) {
      throw new Error("Unauthenticated OpenAI-compatible endpoints must be loopback URLs.");
    }
    this.defaultHeaders = config.defaultHeaders ?? {};
    this.models = config.models ?? [];
    this.fetchImpl = bindFetch(config.fetchImpl);
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.models.map((model) => ({ ...model }));
  }

  async generateText(request: TextGenerationRequest): Promise<TextGenerationResponse> {
    if (!this.apiKey && !this.allowUnauthenticated) {
      throw new Error("OpenAI-compatible provider needs a session API key. The key is not persisted by the app.");
    }

    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...this.defaultHeaders,
    };
    if (this.apiKey) {
      headers.authorization = `Bearer ${this.apiKey}`;
    }

    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: request.model,
        temperature: request.temperature,
        max_tokens: request.maxOutputTokens,
        messages: [
          request.systemPrompt ? { role: "system", content: request.systemPrompt } : null,
          { role: "user", content: request.prompt },
        ].filter(Boolean),
      }),
    });

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      throw new Error(
        `OpenAI-compatible provider request failed (${response.status}): ${sanitizeProviderError(
          details || response.statusText,
        )}`,
      );
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const text = payload.choices?.[0]?.message?.content?.trim() ?? "";
    const inputTokens = payload.usage?.prompt_tokens ?? estimateTextTokens(request.prompt);
    const outputTokens = payload.usage?.completion_tokens ?? estimateTextTokens(text);

    return {
      providerId: this.id,
      model: request.model,
      text,
      finishReason: mapFinishReason(payload.choices?.[0]?.finish_reason),
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: payload.usage?.total_tokens ?? inputTokens + outputTokens,
      },
      raw: payload,
    };
  }

  async *streamText(request: TextGenerationRequest): AsyncIterable<TextChunk> {
    if (!this.apiKey && !this.allowUnauthenticated) {
      throw new Error("OpenAI-compatible provider needs a session API key. The key is not persisted by the app.");
    }

    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...this.defaultHeaders,
    };
    if (this.apiKey) {
      headers.authorization = `Bearer ${this.apiKey}`;
    }

    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: request.model,
        temperature: request.temperature,
        max_tokens: request.maxOutputTokens,
        stream: true,
        messages: [
          request.systemPrompt ? { role: "system", content: request.systemPrompt } : null,
          { role: "user", content: request.prompt },
        ].filter(Boolean),
      }),
    });

    if (!response.ok || !response.body) {
      const details = await response.text().catch(() => "");
      throw new Error(
        `OpenAI-compatible provider stream failed (${response.status}): ${sanitizeProviderError(
          details || response.statusText,
        )}`,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let index = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const chunkText = parseStreamLine(line);
        if (chunkText === undefined) {
          continue;
        }
        if (chunkText === "[DONE]") {
          yield { text: "", index, done: true };
          return;
        }
        if (chunkText.length > 0) {
          yield {
            text: chunkText,
            index,
            done: false,
          };
          index += 1;
        }
      }
    }

    yield { text: "", index, done: true };
  }
}

function bindFetch(fetchImpl: typeof fetch = globalThis.fetch): typeof fetch {
  return fetchImpl.bind(globalThis) as typeof fetch;
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  return url.toString().replace(/\/+$/, "");
}

function isLoopbackBaseUrl(value: string): boolean {
  const url = new URL(value);
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
  );
}

function sanitizeProviderError(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) {
    return "provider returned no details";
  }
  if (
    /authorization|bearer|api[-_ ]?key|token|secret|password/i.test(trimmed) ||
    /(?:sk-[A-Za-z0-9_-]{6,}|[A-Za-z0-9_-]{40,})/.test(trimmed)
  ) {
    return "provider returned an error body that may contain sensitive data";
  }
  return trimmed.slice(0, 300);
}

function mapFinishReason(reason?: string | null): TextGenerationResponse["finishReason"] {
  switch (reason) {
    case "length":
      return "length";
    case "tool_calls":
    case "function_call":
      return "tool_call";
    case "stop":
    case null:
    case undefined:
      return "stop";
    default:
      return "error";
  }
}

function parseStreamLine(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) {
    return undefined;
  }
  const data = trimmed.slice("data:".length).trim();
  if (data === "[DONE]") {
    return "[DONE]";
  }

  try {
    const parsed = JSON.parse(data) as {
      choices?: Array<{
        delta?: {
          content?: string | null;
        };
      }>;
    };
    return parsed.choices?.[0]?.delta?.content ?? "";
  } catch {
    return undefined;
  }
}
