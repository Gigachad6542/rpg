import type {
  ImageGenerationRequest,
  ImageGenerationResponse,
  ImageModelAdapter,
  ImagePromptRequest,
} from "./ImageModelAdapter";

export interface ComfyUIImageProviderConfig {
  endpoint: string;
  workflowJson: string;
  model?: string;
  clientId?: string;
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

interface PromptQueueResponse {
  prompt_id?: string;
  number?: number;
  node_errors?: unknown;
}

interface ComfyImageOutput {
  filename?: string;
  subfolder?: string;
  type?: string;
}

interface ComfyHistoryEntry {
  outputs?: Record<string, { images?: ComfyImageOutput[] }>;
}

type WorkflowValue = string | number | boolean | null | WorkflowValue[] | { [key: string]: WorkflowValue };

export class ComfyUIImageProvider implements ImageModelAdapter {
  readonly id = "comfyui";
  readonly displayName = "ComfyUI local API";

  private readonly endpoint: string;
  private readonly workflowJson: string;
  private readonly model?: string;
  private readonly clientId: string;
  private readonly fetchImpl: typeof fetch;
  private readonly pollIntervalMs: number;
  private readonly pollTimeoutMs: number;

  constructor(config: ComfyUIImageProviderConfig) {
    const endpoint = normalizeLoopbackEndpoint(config.endpoint);
    if (!endpoint) {
      throw new Error("ComfyUI endpoint must be a loopback URL such as http://127.0.0.1:8188.");
    }

    this.endpoint = endpoint;
    this.workflowJson = config.workflowJson.trim();
    this.model = config.model?.trim() || undefined;
    this.clientId = config.clientId ?? createClientId();
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.pollIntervalMs = config.pollIntervalMs ?? 1_000;
    this.pollTimeoutMs = config.pollTimeoutMs ?? 120_000;
  }

  async compilePromptOnly(request: ImagePromptRequest): Promise<string> {
    return [
      request.scenePrompt,
      request.negativePrompt ? `Negative prompt: ${request.negativePrompt}` : "",
      request.providerFormatting ? `Provider formatting: ${request.providerFormatting}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResponse> {
    if (!this.workflowJson) {
      throw new Error("Paste a ComfyUI workflow exported in API format before generating images.");
    }

    const workflow = hydrateWorkflow(parseWorkflow(this.workflowJson), request, this.model);
    const queued = await this.queueWorkflow(workflow);
    const promptId = queued.prompt_id;
    if (!promptId) {
      throw new Error("ComfyUI did not return a prompt id.");
    }

    const historyEntry = await this.waitForHistory(promptId);
    const imageUrls = extractImageOutputs(historyEntry).map((image) => this.toViewUrl(image));
    if (imageUrls.length === 0) {
      throw new Error("ComfyUI completed without an image output.");
    }

    return {
      providerId: this.id,
      model: request.model,
      images: imageUrls.map((url) => ({ url })),
      raw: {
        promptId,
        outputCount: imageUrls.length,
      },
    };
  }

  private async queueWorkflow(workflow: WorkflowValue): Promise<PromptQueueResponse> {
    const response = await this.fetchImpl(`${this.endpoint}/prompt`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        prompt: workflow,
        client_id: this.clientId,
      }),
    });

    if (!response.ok) {
      throw new Error(`ComfyUI queue failed (${response.status}): ${await safeResponseText(response)}`);
    }

    return (await response.json()) as PromptQueueResponse;
  }

  private async waitForHistory(promptId: string): Promise<ComfyHistoryEntry> {
    const deadline = Date.now() + this.pollTimeoutMs;
    while (Date.now() <= deadline) {
      const response = await this.fetchImpl(`${this.endpoint}/history/${encodeURIComponent(promptId)}`);
      if (!response.ok) {
        throw new Error(`ComfyUI history failed (${response.status}): ${await safeResponseText(response)}`);
      }

      const history = (await response.json()) as Record<string, ComfyHistoryEntry>;
      const entry = history[promptId];
      if (entry?.outputs && extractImageOutputs(entry).length > 0) {
        return entry;
      }

      await delay(this.pollIntervalMs);
    }

    throw new Error("Timed out waiting for ComfyUI image output.");
  }

  private toViewUrl(image: Required<ComfyImageOutput>): string {
    const params = new URLSearchParams({
      filename: image.filename,
      subfolder: image.subfolder,
      type: image.type,
    });
    return `${this.endpoint}/view?${params.toString()}`;
  }
}

function parseWorkflow(workflowJson: string): WorkflowValue {
  try {
    return JSON.parse(workflowJson) as WorkflowValue;
  } catch {
    throw new Error("ComfyUI workflow JSON is invalid.");
  }
}

function hydrateWorkflow(value: WorkflowValue, request: ImageGenerationRequest, configuredModel?: string): WorkflowValue {
  if (typeof value === "string") {
    const exact = placeholderValue(value, request, configuredModel);
    if (exact !== undefined) {
      return exact;
    }

    return replacePlaceholder(
      replacePlaceholder(
        replacePlaceholder(
          replacePlaceholder(value, "{{prompt}}", request.prompt),
          "{{sampler}}",
          request.samplerName ?? "euler",
        ),
        "{{scheduler}}",
        request.scheduler ?? "normal",
      ),
      "{{negative_prompt}}",
      request.negativePrompt ?? "",
    )
      .split("{{model}}")
      .join(configuredModel ?? request.model)
      .split("{{seed}}")
      .join(String(normalizeSeed(request.seed)))
      .split("{{width}}")
      .join(String(request.width ?? 1024))
      .split("{{height}}")
      .join(String(request.height ?? 1024))
      .split("{{steps}}")
      .join(String(request.steps ?? 20))
      .split("{{cfg}}")
      .join(String(request.cfg ?? 7));
  }

  if (Array.isArray(value)) {
    return value.map((item) => hydrateWorkflow(item, request, configuredModel));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, hydrateWorkflow(nested, request, configuredModel)]),
    );
  }

  return value;
}

function placeholderValue(
  value: string,
  request: ImageGenerationRequest,
  configuredModel?: string,
): string | number | undefined {
  switch (value.trim()) {
    case "{{prompt}}":
      return request.prompt;
    case "{{negative_prompt}}":
      return request.negativePrompt ?? "";
    case "{{model}}":
      return configuredModel ?? request.model;
    case "{{seed}}":
      return normalizeSeed(request.seed);
    case "{{width}}":
      return request.width ?? 1024;
    case "{{height}}":
      return request.height ?? 1024;
    case "{{steps}}":
      return request.steps ?? 20;
    case "{{cfg}}":
      return request.cfg ?? 7;
    case "{{sampler}}":
      return request.samplerName ?? "euler";
    case "{{scheduler}}":
      return request.scheduler ?? "normal";
    default:
      return undefined;
  }
}

function extractImageOutputs(historyEntry: ComfyHistoryEntry): Required<ComfyImageOutput>[] {
  return Object.values(historyEntry.outputs ?? {})
    .flatMap((output) => output.images ?? [])
    .filter((image): image is Required<ComfyImageOutput> =>
      Boolean(image.filename && image.subfolder !== undefined && image.type),
    );
}

function replacePlaceholder(value: string, placeholder: string, replacement: string): string {
  return value.split(placeholder).join(replacement);
}

function normalizeLoopbackEndpoint(value: string): string | null {
  try {
    const url = new URL(value.trim());
    url.hash = "";
    url.search = "";
    url.hostname = url.hostname.toLowerCase();
    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }
    if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
      return null;
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

async function safeResponseText(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  return text.trim().slice(0, 300) || response.statusText || "no details";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function randomSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647);
}

function normalizeSeed(seed: number | undefined): number {
  return seed === undefined || seed < 0 ? randomSeed() : seed;
}

function createClientId(): string {
  if (globalThis.crypto && "randomUUID" in globalThis.crypto) {
    return globalThis.crypto.randomUUID();
  }

  return `local-cards-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
