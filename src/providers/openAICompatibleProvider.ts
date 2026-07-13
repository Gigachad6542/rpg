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
  requestTimeoutMs?: number;
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
  private readonly requestTimeoutMs: number;
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
    this.requestTimeoutMs = normalizeRequestTimeoutMs(config.requestTimeoutMs);
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

    const timeoutMs = normalizeRequestTimeoutMs(request.timeoutMs ?? this.requestTimeoutMs);
    const timeout = createRequestTimeout(request.signal, timeoutMs, "OpenAI-compatible provider request");
    try {
      const response = await timeout.run(
        this.fetchImpl(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          signal: timeout.signal,
          body: JSON.stringify({
            model: request.model,
            temperature: request.temperature,
            max_tokens: request.maxOutputTokens,
            messages: [
              request.systemPrompt ? { role: "system", content: request.systemPrompt } : null,
              { role: "user", content: request.prompt },
            ].filter(Boolean),
          }),
        }),
      );

      if (!response.ok) {
        const details = await readResponseText(timeout, response);
        throw new Error(
          `OpenAI-compatible provider request failed (${response.status}): ${sanitizeProviderError(
            details || response.statusText,
          )}`,
        );
      }

      const payload = (await timeout.run(response.json())) as ChatCompletionResponse;
      const text = payload.choices?.[0]?.message?.content?.trim() ?? "";
      const inputTokens =
        payload.usage?.prompt_tokens ??
        estimateTextTokens([request.systemPrompt, request.prompt].filter(Boolean).join("\n\n"));
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
        usageSource:
          payload.usage?.prompt_tokens !== undefined &&
          payload.usage.completion_tokens !== undefined &&
          payload.usage.total_tokens !== undefined
            ? "provider"
            : "estimated",
        raw: payload,
      };
    } finally {
      timeout.cleanup();
    }
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

    const timeoutMs = normalizeRequestTimeoutMs(request.timeoutMs ?? this.requestTimeoutMs);
    const timeout = createRequestTimeout(request.signal, timeoutMs, "OpenAI-compatible provider stream");
    try {
      const response = await timeout.run(
        this.fetchImpl(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          signal: timeout.signal,
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
        }),
      );

      if (!response.ok || !response.body) {
        const details = await readResponseText(timeout, response);
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
      let finishReason: TextGenerationResponse["finishReason"] | undefined;
      let usage: TextGenerationResponse["usage"] | undefined;

      while (true) {
        const { done, value } = await timeout.run(reader.read());
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const event = parseStreamLine(line);
          if (!event) {
            continue;
          }
          finishReason = event.finishReason ?? finishReason;
          usage = event.usage ?? usage;
          if (event.doneMarker) {
            yield {
              text: "",
              index,
              done: true,
              finishReason: finishReason ?? "stop",
              ...(usage ? { usage, usageSource: "provider" as const } : {}),
            };
            return;
          }
          if (event.text.length > 0) {
            yield {
              text: event.text,
              index,
              done: false,
            };
            index += 1;
          }
        }
      }

      buffer += decoder.decode();
      if (buffer.trim()) {
        const event = parseStreamLine(buffer);
        if (event) {
          finishReason = event.finishReason ?? finishReason;
          usage = event.usage ?? usage;
          if (event.text.length > 0) {
            yield { text: event.text, index, done: false };
            index += 1;
          }
          if (event.doneMarker) {
            yield {
              text: "",
              index,
              done: true,
              finishReason: finishReason ?? "stop",
              ...(usage ? { usage, usageSource: "provider" as const } : {}),
            };
            return;
          }
        }
      }

      if (!finishReason) {
        throw new Error("OpenAI-compatible provider stream was incomplete because it ended without a terminal marker or finish reason.");
      }
      yield {
        text: "",
        index,
        done: true,
        finishReason,
        ...(usage ? { usage, usageSource: "provider" as const } : {}),
      };
    } finally {
      timeout.cleanup();
    }
  }
}

function bindFetch(fetchImpl: typeof fetch = globalThis.fetch): typeof fetch {
  return fetchImpl.bind(globalThis) as typeof fetch;
}

const defaultRequestTimeoutMs = 60_000;
const maxRequestTimeoutMs = 300_000;

function normalizeRequestTimeoutMs(value: number | undefined): number {
  if (value === undefined) {
    return defaultRequestTimeoutMs;
  }
  if (!Number.isFinite(value) || value <= 0) {
    return defaultRequestTimeoutMs;
  }
  return Math.min(Math.trunc(value), maxRequestTimeoutMs);
}

interface RequestTimeout {
  signal?: AbortSignal;
  run<T>(operation: Promise<T>): Promise<T>;
  cleanup(): void;
  timedOut(): boolean;
}

function createRequestTimeout(
  existingSignal: AbortSignal | null | undefined,
  timeoutMs: number,
  label: string,
): RequestTimeout {
  if (typeof AbortController === "undefined") {
    return {
      signal: existingSignal ?? undefined,
      run: async <T>(operation: Promise<T>) => operation,
      cleanup: () => undefined,
      timedOut: () => false,
    };
  }

  const controller = new AbortController();
  let didTimeOut = false;
  const abortFromExistingSignal = () => controller.abort(existingSignal?.reason);
  if (existingSignal?.aborted) {
    abortFromExistingSignal();
  } else {
    existingSignal?.addEventListener("abort", abortFromExistingSignal, { once: true });
  }
  let rejectTimeout: ((error: Error) => void) | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    rejectTimeout = reject;
  });
  const timer = globalThis.setTimeout(() => {
    didTimeOut = true;
    controller.abort();
    rejectTimeout?.(createTimeoutError(label, timeoutMs));
  }, timeoutMs);

  return {
    signal: controller.signal,
    run: async <T>(operation: Promise<T>): Promise<T> => {
      try {
        return await Promise.race([operation, timeoutPromise]);
      } catch (error) {
        if (didTimeOut) {
          if (isTimeoutError(error, label, timeoutMs)) {
            throw error;
          }
          throw createTimeoutError(label, timeoutMs, error);
        }
        throw error;
      }
    },
    cleanup: () => {
      globalThis.clearTimeout(timer);
      existingSignal?.removeEventListener("abort", abortFromExistingSignal);
    },
    timedOut: () => didTimeOut,
  };
}

async function readResponseText(timeout: RequestTimeout, response: Response): Promise<string> {
  try {
    return await timeout.run(response.text());
  } catch (error) {
    if (timeout.timedOut()) {
      throw error;
    }
    return "";
  }
}

function createTimeoutError(label: string, timeoutMs: number, cause?: unknown): Error {
  const timedOut = new Error(`${label} timed out after ${String(timeoutMs)}ms.`);
  if (cause !== undefined) {
    (timedOut as Error & { cause?: unknown }).cause = cause;
  }
  return timedOut;
}

function isTimeoutError(error: unknown, label: string, timeoutMs: number): boolean {
  return error instanceof Error && error.message === `${label} timed out after ${String(timeoutMs)}ms.`;
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

interface ParsedStreamEvent {
  text: string;
  doneMarker: boolean;
  finishReason?: TextGenerationResponse["finishReason"];
  usage?: TextGenerationResponse["usage"];
}

function parseStreamLine(line: string): ParsedStreamEvent | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) {
    return undefined;
  }
  const data = trimmed.slice("data:".length).trim();
  if (data === "[DONE]") {
    return { text: "", doneMarker: true };
  }

  try {
    const parsed = JSON.parse(data) as {
      choices?: Array<{
        delta?: {
          content?: string | null;
        };
        finish_reason?: string | null;
      }>;
      usage?: ChatCompletionResponse["usage"];
    };
    const reportedUsage = readCompleteStreamUsage(parsed.usage);
    const rawFinishReason = parsed.choices?.[0]?.finish_reason;
    return {
      text: parsed.choices?.[0]?.delta?.content ?? "",
      doneMarker: false,
      ...(typeof rawFinishReason === "string" ? { finishReason: mapFinishReason(rawFinishReason) } : {}),
      ...(reportedUsage ? { usage: reportedUsage } : {}),
    };
  } catch {
    return undefined;
  }
}

function readCompleteStreamUsage(
  usage: ChatCompletionResponse["usage"] | undefined,
): TextGenerationResponse["usage"] | undefined {
  if (
    !usage ||
    !Number.isFinite(usage.prompt_tokens) ||
    !Number.isFinite(usage.completion_tokens) ||
    !Number.isFinite(usage.total_tokens) ||
    (usage.prompt_tokens ?? -1) < 0 ||
    (usage.completion_tokens ?? -1) < 0 ||
    (usage.total_tokens ?? -1) < 0
  ) {
    return undefined;
  }
  return {
    inputTokens: usage.prompt_tokens!,
    outputTokens: usage.completion_tokens!,
    totalTokens: usage.total_tokens!,
  };
}
