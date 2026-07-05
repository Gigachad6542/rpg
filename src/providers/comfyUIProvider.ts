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
  apiKey?: string;
  clientId?: string;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

export interface ComfyUICheckpointListConfig {
  endpoint: string;
  apiKey?: string;
  requestTimeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
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
  status?: {
    completed?: boolean;
    status_str?: string;
  };
}

interface ComfyObjectInfo {
  input?: {
    required?: Record<string, unknown>;
  };
}

type WorkflowValue = string | number | boolean | null | WorkflowValue[] | { [key: string]: WorkflowValue };

const localImageRecommendedImageSize = 1024;
const localImageRecommendedSteps = 28;
const localImageMinimumUsableSteps = 8;
const localImageRecommendedCfg = 3.5;
const localImageMinimumUsableCfg = 1.5;
const localImageRecommendedSampler = "euler";
const localImageRecommendedScheduler = "simple";

export class ComfyUIImageProvider implements ImageModelAdapter {
  readonly id = "comfyui";
  readonly displayName = "ComfyUI local API";

  private readonly endpoint: string;
  private readonly workflowJson: string;
  private readonly model?: string;
  private readonly apiKey?: string;
  private readonly clientId: string;
  private readonly requestTimeoutMs: number;
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
    this.apiKey = config.apiKey?.trim() || undefined;
    this.clientId = config.clientId ?? createClientId();
    this.requestTimeoutMs = normalizeRequestTimeoutMs(config.requestTimeoutMs);
    this.fetchImpl = bindFetch(config.fetchImpl);
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

    const resolvedRequest = normalizeImageGenerationRequest(request);
    const requestTimeoutMs = normalizeRequestTimeoutMs(request.timeoutMs ?? this.requestTimeoutMs);
    const workflow = applyWorkflowPromptOverrides(
      hydrateWorkflow(parseWorkflow(this.workflowJson), resolvedRequest, this.model),
      resolvedRequest,
    );
    await this.validateCheckpointModel(workflow, requestTimeoutMs, request.signal);

    const queued = await this.queueWorkflow(workflow, requestTimeoutMs, request.signal);
    const promptId = queued.prompt_id;
    if (!promptId) {
      throw new Error("ComfyUI did not return a prompt id.");
    }

    const historyEntry = await this.waitForHistory(promptId, requestTimeoutMs, request.signal);
    const imageUrls = extractImageOutputs(historyEntry).map((image) => this.toViewUrl(image));

    return {
      providerId: this.id,
      model: resolvedRequest.model,
      images: imageUrls.map((url) => ({ url })),
      raw: {
        promptId,
        outputCount: imageUrls.length,
        seed: resolvedRequest.seed,
      },
    };
  }

  private async queueWorkflow(
    workflow: WorkflowValue,
    requestTimeoutMs: number,
    signal?: AbortSignal,
  ): Promise<PromptQueueResponse> {
    const response = await this.fetchComfy(`${this.endpoint}/prompt`, {
      method: "POST",
      headers: this.createHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({
        prompt: workflow,
        client_id: this.clientId,
      }),
    }, requestTimeoutMs, signal);

    if (!response.ok) {
      throw new Error(formatQueueFailure(response.status, await safeResponseText(response)));
    }

    const queued = await readResponseJson<PromptQueueResponse>(response);
    if (hasComfyNodeErrors(queued.node_errors)) {
      throw new Error(
        formatQueueFailure(response.status, sanitizeComfyError(JSON.stringify({ node_errors: queued.node_errors }))),
      );
    }

    return queued;
  }

  private async validateCheckpointModel(
    workflow: WorkflowValue,
    requestTimeoutMs: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const checkpointName = findCheckpointModelName(workflow);
    if (!checkpointName) {
      return;
    }

    const installedModels = await fetchComfyUICheckpointModels({
      endpoint: this.endpoint,
      apiKey: this.apiKey,
      requestTimeoutMs,
      signal,
      fetchImpl: this.fetchImpl,
    });
    if (installedModels.length === 0) {
      throw new Error(
        [
          "ComfyUI has no checkpoint models installed or visible to the API.",
          `The workflow is trying to use "${checkpointName}".`,
          "Install a checkpoint in ComfyUI's models/checkpoints folder, restart or refresh ComfyUI, then select the exact installed filename in Image Provider settings.",
        ].join(" "),
      );
    }

    if (!installedModels.includes(checkpointName)) {
      throw new Error(
        [
          `ComfyUI checkpoint "${checkpointName}" is not installed or visible to the API.`,
          `Available checkpoints: ${installedModels.slice(0, 8).join(", ")}${installedModels.length > 8 ? ", ..." : ""}.`,
          "Select one of those exact filenames in Image Provider settings or install the missing checkpoint.",
        ].join(" "),
      );
    }
  }

  private async waitForHistory(
    promptId: string,
    requestTimeoutMs: number,
    signal?: AbortSignal,
  ): Promise<ComfyHistoryEntry> {
    const deadline = Date.now() + this.pollTimeoutMs;
    while (Date.now() <= deadline) {
      const response = await this.fetchComfy(`${this.endpoint}/history/${encodeURIComponent(promptId)}`, {
        headers: this.createHeaders(),
      }, requestTimeoutMs, signal);
      if (!response.ok) {
        throw new Error(`ComfyUI history failed (${response.status}): ${await safeResponseText(response)}`);
      }

      const history = await readResponseJson<Record<string, ComfyHistoryEntry>>(response);
      const entry = history[promptId];
      const images = entry ? extractImageOutputs(entry) : [];
      if (images.length > 0) {
        return entry;
      }
      if (entry?.status?.completed || entry?.status?.status_str === "error") {
        throw new Error(formatHistoryWithoutImageFailure(entry));
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

  private createHeaders(headers: Record<string, string> = {}): Record<string, string> {
    return createComfyHeaders(this.apiKey, headers);
  }

  private async fetchComfy(
    url: string,
    init?: RequestInit,
    requestTimeoutMs = this.requestTimeoutMs,
    signal?: AbortSignal,
  ): Promise<Response> {
    return fetchComfyEndpoint(this.endpoint, url, init, this.fetchImpl, this.apiKey, requestTimeoutMs, signal);
  }
}

export async function fetchComfyUICheckpointModels(config: ComfyUICheckpointListConfig): Promise<string[]> {
  const endpoint = normalizeLoopbackEndpoint(config.endpoint);
  if (!endpoint) {
    throw new Error("ComfyUI endpoint must be a loopback URL such as http://127.0.0.1:8188.");
  }

  const response = await fetchComfyEndpoint(
    endpoint,
    `${endpoint}/object_info/CheckpointLoaderSimple`,
    {
      headers: createComfyHeaders(config.apiKey),
    },
    config.fetchImpl,
    config.apiKey,
    config.requestTimeoutMs,
    config.signal,
  );
  if (!response.ok) {
    throw new Error(`ComfyUI checkpoint check failed (${response.status}): ${await safeResponseText(response)}`);
  }

  const objectInfo = await readResponseJson<Record<string, ComfyObjectInfo>>(response);
  return extractCheckpointChoices(objectInfo.CheckpointLoaderSimple);
}

export async function fetchComfyUIImageModels(config: ComfyUICheckpointListConfig): Promise<string[]> {
  const endpoint = normalizeLoopbackEndpoint(config.endpoint);
  if (!endpoint) {
    throw new Error("ComfyUI endpoint must be a loopback URL such as http://127.0.0.1:8188.");
  }

  const response = await fetchComfyEndpoint(
    endpoint,
    `${endpoint}/object_info/UNETLoader`,
    {
      headers: createComfyHeaders(config.apiKey),
    },
    config.fetchImpl,
    config.apiKey,
    config.requestTimeoutMs,
    config.signal,
  );
  if (!response.ok) {
    throw new Error(`ComfyUI image model check failed (${response.status}): ${await safeResponseText(response)}`);
  }

  const objectInfo = await readResponseJson<Record<string, ComfyObjectInfo>>(response);
  return extractRequiredChoices(objectInfo.UNETLoader, "unet_name");
}

function bindFetch(fetchImpl: typeof fetch = globalThis.fetch): typeof fetch {
  return fetchImpl.bind(globalThis) as typeof fetch;
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
    const hydrated = Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, hydrateWorkflow(nested, request, configuredModel)]),
    );
    return applyGenerationSettingsOverrides(hydrated, request, configuredModel);
  }

  return value;
}

function applyGenerationSettingsOverrides(
  value: Record<string, WorkflowValue>,
  request: ImageGenerationRequest,
  configuredModel?: string,
): WorkflowValue {
  const classType = value.class_type;
  const inputs = value.inputs;
  if (typeof classType !== "string" || !inputs || typeof inputs !== "object" || Array.isArray(inputs)) {
    return value;
  }

  const nextInputs: Record<string, WorkflowValue> = { ...inputs };
  let changed = false;
  const setInput = (key: string, replacement: WorkflowValue | undefined) => {
    if (replacement === undefined || !(key in nextInputs)) {
      return;
    }
    nextInputs[key] = replacement;
    changed = true;
  };

  if (classType === "CheckpointLoaderSimple") {
    setInput("ckpt_name", configuredModel ?? request.model);
  }

  if (classType === "UNETLoader") {
    setInput("unet_name", configuredModel ?? request.model);
  }

  if (
    classType.includes("EmptyLatentImage") ||
    classType === "EmptySD3LatentImage" ||
    classType === "EmptyFlux2LatentImage"
  ) {
    setInput("width", request.width ?? 1024);
    setInput("height", request.height ?? 1024);
  }

  if (classType === "ModelSamplingFlux") {
    setInput("width", request.width ?? 1024);
    setInput("height", request.height ?? 1024);
  }

  if (classType === "KSampler" || classType === "KSamplerAdvanced") {
    setInput("seed", normalizeSeed(request.seed));
    setInput("steps", request.steps ?? 20);
    setInput("cfg", request.cfg ?? 7);
    setInput("sampler_name", request.samplerName ?? "euler");
    setInput("scheduler", request.scheduler ?? "normal");
  }

  if (classType === "BasicScheduler") {
    setInput("steps", request.steps ?? 20);
    setInput("scheduler", request.scheduler ?? "normal");
  }

  if (classType === "Flux2Scheduler") {
    setInput("steps", request.steps ?? 20);
    setInput("width", request.width ?? 1024);
    setInput("height", request.height ?? 1024);
  }

  if (classType === "KSamplerSelect") {
    setInput("sampler_name", request.samplerName ?? "euler");
  }

  if (classType === "RandomNoise") {
    setInput("noise_seed", normalizeSeed(request.seed));
  }

  if (classType === "CLIPTextEncodeFlux") {
    setInput("guidance", request.cfg ?? 3.5);
  }

  if (classType === "FluxGuidance") {
    setInput("guidance", request.cfg ?? 3.5);
  }

  return changed ? { ...value, inputs: nextInputs } : value;
}

function applyWorkflowPromptOverrides(value: WorkflowValue, request: ImageGenerationRequest): WorkflowValue {
  if (!isWorkflowRecord(value)) {
    return value;
  }

  const positiveNodeIds = collectLinkedInputNodeIds(value, "positive");
  const negativeNodeIds = collectLinkedInputNodeIds(value, "negative");
  if (positiveNodeIds.size === 0 && negativeNodeIds.size === 0) {
    return value;
  }

  const next: Record<string, WorkflowValue> = { ...value };
  let changed = false;
  for (const [nodeId, node] of Object.entries(value)) {
    if (!isWorkflowRecord(node) || !isWorkflowRecord(node.inputs)) {
      continue;
    }

    const replacement = positiveNodeIds.has(nodeId)
      ? request.prompt
      : negativeNodeIds.has(nodeId)
        ? request.negativePrompt ?? ""
        : undefined;
    if (replacement === undefined) {
      continue;
    }

    const nextInputs = replacePromptTextInputs(node.inputs, replacement);
    if (nextInputs !== node.inputs) {
      next[nodeId] = { ...node, inputs: nextInputs };
      changed = true;
    }
  }

  return changed ? next : value;
}

function collectLinkedInputNodeIds(workflow: Record<string, WorkflowValue>, inputName: string): Set<string> {
  const nodeIds = new Set<string>();
  for (const node of Object.values(workflow)) {
    if (!isWorkflowRecord(node) || !isWorkflowRecord(node.inputs)) {
      continue;
    }

    const linkedNodeId = readLinkedNodeId(node.inputs[inputName]);
    if (linkedNodeId) {
      nodeIds.add(linkedNodeId);
    }
  }

  return nodeIds;
}

function readLinkedNodeId(value: WorkflowValue): string | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const nodeId = value[0];
  return typeof nodeId === "string" || typeof nodeId === "number" ? String(nodeId) : null;
}

function replacePromptTextInputs(
  inputs: Record<string, WorkflowValue>,
  replacement: string,
): Record<string, WorkflowValue> {
  const nextInputs: Record<string, WorkflowValue> = { ...inputs };
  let changed = false;
  for (const key of ["text", "text_g", "text_l", "caption", "prompt"]) {
    if (typeof nextInputs[key] === "string" && nextInputs[key] !== replacement) {
      nextInputs[key] = replacement;
      changed = true;
    }
  }

  return changed ? nextInputs : inputs;
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
  return Object.entries(historyEntry.outputs ?? {})
    .flatMap(([nodeId, output]) => (output.images ?? []).map((image) => ({ image, nodeId })))
    .filter(
      (entry): entry is { image: Required<ComfyImageOutput>; nodeId: string } =>
        Boolean(entry.image.filename && entry.image.subfolder !== undefined && entry.image.type),
    )
    .sort(compareComfyImageOutputs)
    .map((entry) => entry.image);
}

function compareComfyImageOutputs(
  a: { image: Required<ComfyImageOutput>; nodeId: string },
  b: { image: Required<ComfyImageOutput>; nodeId: string },
): number {
  const typeDelta = imageOutputTypeRank(a.image.type) - imageOutputTypeRank(b.image.type);
  if (typeDelta !== 0) {
    return typeDelta;
  }

  const aNodeId = Number(a.nodeId);
  const bNodeId = Number(b.nodeId);
  if (Number.isFinite(aNodeId) && Number.isFinite(bNodeId) && aNodeId !== bNodeId) {
    return bNodeId - aNodeId;
  }

  return a.nodeId.localeCompare(b.nodeId);
}

const responseTimeouts = new WeakMap<Response, RequestTimeout>();

function imageOutputTypeRank(type: string): number {
  if (type === "output") {
    return 0;
  }
  if (type === "temp") {
    return 1;
  }
  return 2;
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

function isWorkflowRecord(value: WorkflowValue): value is Record<string, WorkflowValue> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasComfyNodeErrors(nodeErrors: unknown): boolean {
  if (!nodeErrors) {
    return false;
  }
  if (Array.isArray(nodeErrors)) {
    return nodeErrors.length > 0;
  }
  if (typeof nodeErrors === "object") {
    return Object.keys(nodeErrors).length > 0;
  }
  return true;
}

function formatHistoryWithoutImageFailure(entry: ComfyHistoryEntry): string {
  const status = entry.status?.status_str ? ` Status: ${entry.status.status_str}.` : "";
  return `ComfyUI finished without an image output.${status} Check the workflow has a SaveImage node connected to the sampler output.`;
}

async function safeResponseText(response: Response): Promise<string> {
  const timeout = responseTimeouts.get(response);
  let text = "";
  try {
    text = timeout ? await timeout.run(response.text()) : await response.text();
  } catch (error) {
    if (timeout?.timedOut()) {
      throw error;
    }
  } finally {
    cleanupResponseTimeout(response);
  }
  return sanitizeComfyError(text || response.statusText);
}

async function readResponseJson<T>(response: Response): Promise<T> {
  const timeout = responseTimeouts.get(response);
  try {
    return (await (timeout ? timeout.run(response.json()) : response.json())) as T;
  } finally {
    cleanupResponseTimeout(response);
  }
}

function cleanupResponseTimeout(response: Response): void {
  const timeout = responseTimeouts.get(response);
  timeout?.cleanup();
  responseTimeouts.delete(response);
}

function formatQueueFailure(status: number, responseText: string): string {
  const checkpointName = extractInvalidCheckpointName(responseText);
  if (checkpointName) {
    return [
      `ComfyUI checkpoint "${checkpointName}" is not installed or visible to the API.`,
      "Install it in ComfyUI's models/checkpoints folder, restart or refresh ComfyUI, then select that exact filename in Image Provider settings.",
      `ComfyUI queue failed (${status}).`,
    ].join(" ");
  }

  return `ComfyUI queue failed (${status}): ${responseText}`;
}

function sanitizeComfyError(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) {
    return "no details";
  }
  if (
    /authorization|bearer|api[-_ ]?key|token|secret|password/i.test(trimmed) ||
    /(?:sk-[A-Za-z0-9_-]{6,}|[A-Za-z0-9_-]{40,})/.test(trimmed)
  ) {
    return "[redacted]";
  }
  return trimmed.slice(0, 300);
}

function findCheckpointModelName(value: WorkflowValue): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findCheckpointModelName(item);
      if (nested) {
        return nested;
      }
    }

    return null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, WorkflowValue>;
  if (record.class_type === "CheckpointLoaderSimple") {
    const inputs = record.inputs;
    if (inputs && typeof inputs === "object" && !Array.isArray(inputs)) {
      const checkpointName = (inputs as Record<string, WorkflowValue>).ckpt_name;
      if (typeof checkpointName === "string" && checkpointName.trim()) {
        return checkpointName.trim();
      }
    }
  }

  for (const nested of Object.values(record)) {
    const checkpointName = findCheckpointModelName(nested);
    if (checkpointName) {
      return checkpointName;
    }
  }

  return null;
}

function extractCheckpointChoices(objectInfo: ComfyObjectInfo | undefined): string[] {
  return extractRequiredChoices(objectInfo, "ckpt_name");
}

function extractRequiredChoices(objectInfo: ComfyObjectInfo | undefined, inputName: string): string[] {
  const choices = objectInfo?.input?.required?.ckpt_name;
  const requestedChoices = objectInfo?.input?.required?.[inputName] ?? choices;
  if (!Array.isArray(requestedChoices)) {
    return [];
  }

  const first = requestedChoices[0];
  if (!Array.isArray(first)) {
    return [];
  }

  return first.filter((choice): choice is string => typeof choice === "string" && choice.trim().length > 0);
}

function extractInvalidCheckpointName(responseText: string): string | null {
  const fromDetails = /ckpt_name:\s*'([^']+)'/.exec(responseText);
  if (fromDetails?.[1]) {
    return fromDetails[1].trim();
  }

  return null;
}

function createComfyHeaders(apiKey: string | undefined, headers: Record<string, string> = {}): Record<string, string> {
  const trimmedApiKey = apiKey?.trim();
  return trimmedApiKey ? { ...headers, authorization: `Bearer ${trimmedApiKey}` } : headers;
}

async function fetchComfyEndpoint(
  endpoint: string,
  url: string,
  init: RequestInit | undefined,
  fetchImpl: typeof fetch = globalThis.fetch,
  apiKey?: string,
  requestTimeoutMs = defaultRequestTimeoutMs,
  signal?: AbortSignal,
): Promise<Response> {
  const timeoutMs = normalizeRequestTimeoutMs(requestTimeoutMs);
  const timeout = createRequestTimeout(init?.signal ?? signal, timeoutMs, "ComfyUI request");
  try {
    const response = await timeout.run(bindFetch(fetchImpl)(url, { ...init, signal: timeout.signal }));
    responseTimeouts.set(response, timeout);
    return response;
  } catch (error) {
    timeout.cleanup();
    if (timeout.timedOut()) {
      throw error;
    }
    const wrapped = new Error(
      [
        `Could not reach ComfyUI at ${endpoint}.`,
        "Make sure ComfyUI is running and the endpoint matches the Image Provider settings.",
        "If this is the browser/dev app, start ComfyUI with CORS enabled, for example: --enable-cors-header http://localhost:5173",
        apiKey ? "If you added a ComfyUI API key, verify the auth proxy allows browser CORS preflight requests." : "",
        `Original error: ${sanitizeComfyError(getFetchErrorMessage(error))}`,
      ]
        .filter(Boolean)
        .join(" "),
    );
    (wrapped as Error & { cause?: unknown }).cause = error;
    throw wrapped;
  }
}

function getFetchErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
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

function normalizeImageGenerationRequest(request: ImageGenerationRequest): ImageGenerationRequest {
  const width = normalizeImageDimension(request.width);
  const height = normalizeImageDimension(request.height);
  const requestedSteps = request.steps ?? localImageRecommendedSteps;
  const requestedCfg = request.cfg ?? localImageRecommendedCfg;
  const hasPreviewQualitySettings =
    requestedSteps < localImageMinimumUsableSteps || requestedCfg < localImageMinimumUsableCfg;
  const samplerName = request.samplerName?.trim() || localImageRecommendedSampler;
  const scheduler = request.scheduler?.trim() || localImageRecommendedScheduler;

  return {
    ...request,
    width,
    height,
    seed: normalizeSeed(request.seed),
    steps: hasPreviewQualitySettings ? Math.max(requestedSteps, localImageRecommendedSteps) : requestedSteps,
    cfg: hasPreviewQualitySettings ? localImageRecommendedCfg : requestedCfg,
    samplerName:
      hasPreviewQualitySettings && samplerName.toLowerCase() === "euler" ? localImageRecommendedSampler : samplerName,
    scheduler:
      hasPreviewQualitySettings && scheduler.toLowerCase() === "normal" ? localImageRecommendedScheduler : scheduler,
  };
}

function normalizeImageDimension(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return localImageRecommendedImageSize;
  }

  return Math.round(value);
}

function randomSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647);
}

function normalizeSeed(seed: number | undefined): number {
  return seed === undefined || seed <= 0 ? randomSeed() : seed;
}

function createClientId(): string {
  if (globalThis.crypto && "randomUUID" in globalThis.crypto) {
    return globalThis.crypto.randomUUID();
  }

  return `local-cards-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
