import { estimateTextTokens } from "../runtime/tokenBudget";
import type { SecretReference } from "../security/keyStorage";
import type {
  ModelInfo,
  TextGenerationRequest,
  TextGenerationResponse,
  TextModelAdapter,
} from "./TextModelAdapter";

export interface TauriStoredSecretTextProviderConfig {
  id: string;
  displayName: string;
  baseUrl: string;
  secretReference: SecretReference;
  models?: ModelInfo[];
  invokeImpl?: TauriInvoke;
}

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

interface StoredSecretTextResponse {
  providerId: string;
  model: string;
  text: string;
  finishReason: TextGenerationResponse["finishReason"];
  usage?: Partial<TextGenerationResponse["usage"]>;
  raw?: unknown;
}

export class TauriStoredSecretTextProvider implements TextModelAdapter {
  readonly id: string;
  readonly displayName: string;

  private readonly baseUrl: string;
  private readonly secretReference: SecretReference;
  private readonly models: ModelInfo[];
  private readonly invokeImpl: TauriInvoke;

  constructor(config: TauriStoredSecretTextProviderConfig) {
    this.id = config.id;
    this.displayName = config.displayName;
    this.baseUrl = config.baseUrl;
    this.secretReference = config.secretReference;
    this.models = config.models ?? [];
    this.invokeImpl = config.invokeImpl ?? invokeTauriCommand;
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.models.map((model) => ({ ...model }));
  }

  async generateText(request: TextGenerationRequest): Promise<TextGenerationResponse> {
    const response = await this.invokeImpl<StoredSecretTextResponse>("generate_text_with_stored_secret", {
      request: {
        providerId: this.id,
        displayName: this.displayName,
        baseUrl: this.baseUrl,
        model: request.model,
        secretReference: this.secretReference,
        prompt: request.prompt,
        systemPrompt: request.systemPrompt,
        temperature: request.temperature,
        maxOutputTokens: request.maxOutputTokens,
      },
    });
    const inputTokens = response.usage?.inputTokens ?? estimateTextTokens(request.prompt);
    const outputTokens = response.usage?.outputTokens ?? estimateTextTokens(response.text);

    return {
      providerId: response.providerId,
      model: response.model,
      text: response.text,
      finishReason: response.finishReason,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: response.usage?.totalTokens ?? inputTokens + outputTokens,
      },
      raw: response.raw,
    };
  }
}

async function invokeTauriCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error("Stored OS keychain provider calls are available only in the desktop app.");
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
