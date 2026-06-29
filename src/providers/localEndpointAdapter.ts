import type {
  ModelInfo,
  TextModelAdapter,
} from "./TextModelAdapter";
import { OpenAICompatibleTextProvider } from "./openAICompatibleProvider";

export interface LocalEndpointTextProviderConfig {
  endpointUrl?: string;
  models?: ModelInfo[];
  displayName?: string;
}

export class LocalEndpointTextProvider implements TextModelAdapter {
  readonly id = "local-endpoint";
  readonly displayName: string;

  private readonly transport: OpenAICompatibleTextProvider;

  constructor(config: LocalEndpointTextProviderConfig = {}) {
    this.displayName = config.displayName ?? "Local OpenAI-compatible endpoint";
    this.transport = new OpenAICompatibleTextProvider({
      id: this.id,
      displayName: this.displayName,
      baseUrl: config.endpointUrl ?? "http://127.0.0.1:1234/v1",
      allowUnauthenticated: true,
      models: config.models ?? [],
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.transport.listModels();
  }

  async generateText(request: Parameters<TextModelAdapter["generateText"]>[0]) {
    return this.transport.generateText(request);
  }
}
