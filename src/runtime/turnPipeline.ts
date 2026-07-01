import type {
  TextGenerationRequest,
  TextGenerationResponse,
  TextModelAdapter,
  TextUsage,
} from "../providers/TextModelAdapter";
import { compilePrompt, type CompiledPrompt, type PromptLayer } from "./promptCompiler";
import type { TokenBudget, TokenEstimator } from "./tokenBudget";
import { estimateTextTokens } from "./tokenBudget";
import {
  createEmptyExtractionResult,
  validateExtractionResult,
  type ExtractionResult,
  type ExtractionValidationIssue,
} from "./extraction";
import { analyzeSocialExpectation } from "./socialExpectation";

export type TurnPipelineRole = "system" | "user" | "assistant" | "tool" | "narrator";

export interface TurnPipelineMessage {
  readonly id?: string;
  readonly role: TurnPipelineRole;
  readonly content: string;
  readonly createdAt?: string;
}

export interface TurnPipelineSessionContext {
  readonly id: string;
  readonly title?: string;
  readonly mode?: string;
  readonly summary?: string;
  readonly systemPrompt?: string;
}

export interface TurnPipelineCardContext {
  readonly id?: string;
  readonly name?: string;
  readonly kind?: string;
  readonly summary?: string;
  readonly systemPrompt?: string;
  readonly characterDefinition?: string;
  readonly userPersona?: string;
  readonly preHistoryInstructions?: string;
  readonly postHistoryInstructions?: string;
  readonly knowledgeBoundaries?: string;
  readonly assistantPrefill?: string;
}

export interface TurnPipelineRule {
  readonly id: string;
  readonly title?: string;
  readonly description: string;
  readonly enabled?: boolean;
  readonly enforcement?: string;
}

export interface TurnPipelineLoreEntry {
  readonly id: string;
  readonly title?: string;
  readonly content: string;
  readonly enabled?: boolean;
  readonly priority?: number;
  readonly sourceIds?: readonly string[];
}

export interface TurnPipelineMemoryEntry {
  readonly id: string;
  readonly label?: string;
  readonly text?: string;
  readonly detail?: string;
  readonly enabled?: boolean;
  readonly importance?: string | number;
  readonly sourceIds?: readonly string[];
}

export interface TurnPipelineRpgState {
  readonly id?: string;
  readonly location?: string;
  readonly sceneSummary?: string;
  readonly player?: unknown;
  readonly health?: unknown;
  readonly inventory?: readonly unknown[];
  readonly activeQuestIds?: readonly string[];
  readonly quests?: readonly unknown[];
  readonly companionCharacterIds?: readonly string[];
  readonly worldFlags?: Record<string, string | number | boolean | null>;
  readonly flags?: Record<string, string | number | boolean | null>;
  readonly statusEffects?: readonly string[];
  readonly knownPlaces?: readonly string[];
  readonly [key: string]: unknown;
}

export interface TurnPromptCompileOptions {
  readonly tokenBudget?: TokenBudget;
  readonly estimator?: TokenEstimator;
  readonly includeLayerLabels?: boolean;
  readonly historyLimit?: number;
}

export interface TurnPipelinePersistenceCallbacks {
  readonly savePromptRun?: (promptRun: TurnPromptRunMetadata) => Awaitable<void>;
  readonly saveAssistantMessage?: (message: TurnPipelineAssistantMessage) => Awaitable<void>;
  readonly saveStateProposals?: (proposals: TurnStateProposals) => Awaitable<void>;
}

export interface RunTurnPipelineRequest extends TurnPromptCompileOptions {
  readonly session: TurnPipelineSessionContext;
  readonly card?: TurnPipelineCardContext;
  readonly messages: readonly TurnPipelineMessage[];
  readonly latestUserMessage?: TurnPipelineMessage | string;
  readonly loreEntries?: readonly TurnPipelineLoreEntry[];
  readonly memoryEntries?: readonly TurnPipelineMemoryEntry[];
  readonly rpgState?: TurnPipelineRpgState | null;
  readonly rules?: readonly TurnPipelineRule[];
  readonly knowledgeBoundaries?: string;
  readonly responseContract?: string;
  readonly assistantPrefill?: string;
  readonly modelAdapter: TextModelAdapter;
  readonly model: string;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly preferStreaming?: boolean;
  readonly onStreamText?: (text: string) => Awaitable<void>;
  readonly promptRunId?: string;
  readonly now?: () => string;
  readonly persistence?: TurnPipelinePersistenceCallbacks;
  readonly metadata?: Record<string, unknown>;
}

export interface TurnPromptRunMetadata {
  readonly id: string;
  readonly sessionId: string;
  readonly cardId?: string;
  readonly providerId: string;
  readonly model: string;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly tokenBudget?: TokenBudget;
  readonly compiledPrompt: string;
  readonly tokenEstimate: number;
  readonly tokenLimit?: number;
  readonly includedLayerIds: readonly string[];
  readonly omittedLayerIds: readonly string[];
  readonly truncatedLayerIds: readonly string[];
  readonly includedMemoryIds: readonly string[];
  readonly includedLoreEntryIds: readonly string[];
  readonly includedStateSnapshotId?: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly finishReason: TextGenerationResponse["finishReason"];
  readonly usage: TextUsage;
  readonly extractionValidated: boolean;
  readonly metadata?: Record<string, unknown>;
}

export interface TurnPipelineAssistantMessage {
  readonly role: "assistant";
  readonly content: string;
  readonly promptRunId: string;
  readonly providerId: string;
  readonly model: string;
}

export interface TurnStateProposals {
  readonly extraction: ExtractionResult;
  readonly newCharacters: ExtractionResult["new_characters"];
  readonly updatedCharacters: ExtractionResult["updated_characters"];
  readonly newEvents: ExtractionResult["new_events"];
  readonly characterKnowledgeUpdates: ExtractionResult["character_knowledge_updates"];
  readonly relationshipUpdates: ExtractionResult["relationship_updates"];
  readonly memoryUpdates: ExtractionResult["memory_updates"];
  readonly rpgStateUpdates: ExtractionResult["rpg_state_updates"];
  readonly imagePromptOpportunity: ExtractionResult["image_prompt_opportunity"];
}

export type TurnPipelineWarningCode =
  | "missing_latest_user_message"
  | "invalid_extraction"
  | "continuity_warning"
  | "provider_finish_reason";

export interface TurnPipelineWarning {
  readonly code: TurnPipelineWarningCode;
  readonly message: string;
  readonly issues?: readonly ExtractionValidationIssue[];
}

export interface TurnPipelineResult {
  readonly assistantMessageText: string;
  readonly assistantMessage: TurnPipelineAssistantMessage;
  readonly promptRun: TurnPromptRunMetadata;
  readonly stateProposals: TurnStateProposals;
  readonly warnings: readonly TurnPipelineWarning[];
  readonly includedLayerIds: readonly string[];
  readonly compiledPrompt: CompiledPrompt;
}

export const TURN_PIPELINE_LAYER_IDS = {
  globalRuntimeRules: "global-runtime-rules",
  modeRules: "mode-rules",
  characterDefinition: "card-context",
  userPersona: "user-persona",
  preHistoryInstructions: "pre-history-instructions",
  longTermMemory: "long-term-memory",
  lorebookEntries: "lorebook-entries",
  rpgState: "rpg-state",
  knowledgeBoundaries: "knowledge-boundaries",
  socialExpectation: "social-expectation",
  recentChatHistory: "recent-chat-history",
  latestUserMessage: "latest-user-message",
  postHistoryInstructions: "post-history-instructions",
  finalResponseContract: "final-response-contract",
  assistantPrefill: "assistant-prefill",
} as const;

type Awaitable<T> = T | Promise<T>;

interface ResolvedLatestUserMessage {
  readonly message?: TurnPipelineMessage;
  readonly messageIndex: number;
  readonly content: string;
}

interface ExtractionParseResult {
  readonly candidate?: unknown;
  readonly assistantMessageText?: string;
}

interface ParsedJsonMatch {
  readonly value: Record<string, unknown>;
  readonly fullMatch: string;
}

export async function runTurnPipeline(request: RunTurnPipelineRequest): Promise<TurnPipelineResult> {
  const now = request.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const promptRunId = request.promptRunId ?? createPromptRunId(startedAt);
  const warnings: TurnPipelineWarning[] = [];
  const compiledPrompt = compileTurnPrompt(request);
  const includedLayerIds = compiledPrompt.includedLayers.map((layer) => layer.id);
  const includedLayerIdSet = new Set(includedLayerIds);

  const generationRequest = {
    model: request.model,
    prompt: compiledPrompt.prompt,
    temperature: request.temperature,
    maxOutputTokens: request.maxOutputTokens,
    metadata: {
      promptRunId,
      sessionId: request.session.id,
      cardId: request.card?.id,
      includedLayerIds,
      ...request.metadata,
    },
  };
  const generationResponse =
    request.preferStreaming && request.modelAdapter.streamText
      ? await collectStreamedText(request, generationRequest, compiledPrompt)
      : await request.modelAdapter.generateText(generationRequest);

  if (generationResponse.finishReason !== "stop") {
    warnings.push({
      code: "provider_finish_reason",
      message: `Provider finished with reason: ${generationResponse.finishReason}.`,
    });
  }

  const parsedExtraction = parseExtractionFromResponse(generationResponse);
  const extractionValidation =
    parsedExtraction.candidate === undefined
      ? { success: true as const, data: createEmptyExtractionResult() }
      : validateExtractionResult(parsedExtraction.candidate);

  const extraction = extractionValidation.success ? extractionValidation.data : createEmptyExtractionResult();

  if (!extractionValidation.success) {
    warnings.push({
      code: "invalid_extraction",
      message: "Model extraction payload did not match the runtime extraction schema.",
      issues: extractionValidation.issues,
    });
  }

  for (const continuityWarning of extraction.continuity_warnings) {
    warnings.push({
      code: "continuity_warning",
      message: continuityWarning,
    });
  }

  const assistantMessageText = (parsedExtraction.assistantMessageText ?? generationResponse.text).trim();
  const completedAt = now();
  const promptRun: TurnPromptRunMetadata = {
    id: promptRunId,
    sessionId: request.session.id,
    cardId: request.card?.id,
    providerId: generationResponse.providerId,
    model: generationResponse.model,
    temperature: request.temperature,
    maxOutputTokens: request.maxOutputTokens,
    tokenBudget: request.tokenBudget,
    compiledPrompt: compiledPrompt.prompt,
    tokenEstimate: compiledPrompt.tokenEstimate,
    tokenLimit: compiledPrompt.tokenLimit,
    includedLayerIds,
    omittedLayerIds: compiledPrompt.omittedLayers.map((layer) => layer.id),
    truncatedLayerIds: compiledPrompt.truncatedLayerIds,
    includedMemoryIds: includedLayerIdSet.has(TURN_PIPELINE_LAYER_IDS.longTermMemory)
      ? getPromptIncludedMemoryEntryIds(request.memoryEntries, compiledPrompt.prompt)
      : [],
    includedLoreEntryIds: includedLayerIdSet.has(TURN_PIPELINE_LAYER_IDS.lorebookEntries)
      ? getPromptIncludedLoreEntryIds(request.loreEntries, compiledPrompt.prompt)
      : [],
    includedStateSnapshotId:
      request.rpgState?.id && includedLayerIdSet.has(TURN_PIPELINE_LAYER_IDS.rpgState)
        ? request.rpgState.id
        : undefined,
    startedAt,
    completedAt,
    finishReason: generationResponse.finishReason,
    usage: generationResponse.usage,
    extractionValidated: extractionValidation.success,
    metadata: request.metadata,
  };
  const assistantMessage: TurnPipelineAssistantMessage = {
    role: "assistant",
    content: assistantMessageText,
    promptRunId,
    providerId: generationResponse.providerId,
    model: generationResponse.model,
  };
  const stateProposals = createStateProposals(extraction);

  await request.persistence?.savePromptRun?.(promptRun);
  await request.persistence?.saveAssistantMessage?.(assistantMessage);
  await request.persistence?.saveStateProposals?.(stateProposals);

  return {
    assistantMessageText,
    assistantMessage,
    promptRun,
    stateProposals,
    warnings,
    includedLayerIds,
    compiledPrompt,
  };
}

export function compileTurnPrompt(request: Omit<RunTurnPipelineRequest, "modelAdapter" | "model">): CompiledPrompt {
  const latestUserMessage = resolveLatestUserMessage(request.messages, request.latestUserMessage);
  const layers = buildTurnPromptLayers(request, latestUserMessage);

  return compilePrompt({
    layers,
    tokenBudget: request.tokenBudget,
    estimator: request.estimator,
    includeLayerLabels: request.includeLayerLabels,
  });
}

async function collectStreamedText(
  request: RunTurnPipelineRequest,
  generationRequest: TextGenerationRequest,
  compiledPrompt: CompiledPrompt,
): Promise<TextGenerationResponse> {
  let text = "";
  let chunkCount = 0;
  for await (const chunk of request.modelAdapter.streamText?.(generationRequest) ?? []) {
    text += chunk.text;
    chunkCount = Math.max(chunkCount, chunk.index + 1);
    if (chunk.text.length > 0) {
      await request.onStreamText?.(text);
    }
  }

  const inputTokens = compiledPrompt.tokenEstimate;
  const outputTokens = estimateTextTokens(text);
  return {
    providerId: request.modelAdapter.id,
    model: request.model,
    text,
    finishReason: "stop",
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    },
    raw: {
      streamed: true,
      chunkCount,
    },
  };
}

export function buildTurnPromptLayers(
  request: Omit<RunTurnPipelineRequest, "modelAdapter" | "model">,
  latestUserMessage = resolveLatestUserMessage(request.messages, request.latestUserMessage),
): PromptLayer[] {
  const historyLimit = request.historyLimit ?? 12;
  const historyMessages = request.messages
    .filter((_, index) => index !== latestUserMessage.messageIndex)
    .slice(-historyLimit);
  const knowledgeBoundaries = [request.card?.knowledgeBoundaries, request.knowledgeBoundaries]
    .filter(isNonEmptyString)
    .join("\n\n");

  return [
    createLayer({
      id: TURN_PIPELINE_LAYER_IDS.globalRuntimeRules,
      kind: "globalRuntimeRules",
      content: formatGlobalRuntimeRules(request.session, request.card),
    }),
    createLayer({
      id: TURN_PIPELINE_LAYER_IDS.modeRules,
      kind: "modeRules",
      content: formatRules(request.rules),
      required: false,
    }),
    createLayer({
      id: TURN_PIPELINE_LAYER_IDS.characterDefinition,
      kind: "characterDefinition",
      content: formatCardContext(request.session, request.card),
    }),
    createLayer({
      id: TURN_PIPELINE_LAYER_IDS.userPersona,
      kind: "userPersona",
      content: request.card?.userPersona ?? "",
      required: false,
      allowTrimming: true,
    }),
    createLayer({
      id: TURN_PIPELINE_LAYER_IDS.preHistoryInstructions,
      kind: "preHistoryInstructions",
      content: request.card?.preHistoryInstructions ?? "",
      required: false,
    }),
    createLayer({
      id: TURN_PIPELINE_LAYER_IDS.longTermMemory,
      kind: "longTermMemory",
      content: formatMemoryEntries(request.memoryEntries),
      required: false,
      allowTrimming: true,
    }),
    createLayer({
      id: TURN_PIPELINE_LAYER_IDS.lorebookEntries,
      kind: "lorebookEntries",
      content: formatLoreEntries(request.loreEntries),
      required: false,
      allowTrimming: true,
    }),
    createLayer({
      id: TURN_PIPELINE_LAYER_IDS.rpgState,
      kind: "rpgState",
      content: formatRpgState(request.rpgState),
      required: false,
      allowTrimming: true,
    }),
    createLayer({
      id: TURN_PIPELINE_LAYER_IDS.knowledgeBoundaries,
      kind: "knowledgeBoundaries",
      content: knowledgeBoundaries,
      required: false,
    }),
    createLayer({
      id: TURN_PIPELINE_LAYER_IDS.socialExpectation,
      kind: "socialExpectation",
      content: formatSocialExpectation(request),
      required: false,
    }),
    createLayer({
      id: TURN_PIPELINE_LAYER_IDS.recentChatHistory,
      kind: "recentChatHistory",
      content: formatMessages(historyMessages),
      required: false,
      allowTrimming: true,
    }),
    createLayer({
      id: TURN_PIPELINE_LAYER_IDS.latestUserMessage,
      kind: "latestUserMessage",
      content: latestUserMessage.content,
    }),
    createLayer({
      id: TURN_PIPELINE_LAYER_IDS.postHistoryInstructions,
      kind: "postHistoryInstructions",
      content: request.card?.postHistoryInstructions ?? "",
      required: false,
    }),
    createLayer({
      id: TURN_PIPELINE_LAYER_IDS.finalResponseContract,
      kind: "finalResponseContract",
      content: request.responseContract ?? defaultResponseContract,
    }),
    createLayer({
      id: TURN_PIPELINE_LAYER_IDS.assistantPrefill,
      kind: "assistantPrefill",
      content: request.assistantPrefill ?? request.card?.assistantPrefill ?? "",
      required: false,
    }),
  ];
}

function createLayer(layer: PromptLayer): PromptLayer {
  return {
    ...layer,
    content: layer.content.trim(),
  };
}

function formatGlobalRuntimeRules(
  session: TurnPipelineSessionContext,
  card?: TurnPipelineCardContext,
): string {
  return [
    "The local app is the continuity authority. Treat model output as assistant prose plus state-change proposals.",
    "Do not claim permanent memory, lore, RPG state, inventory, relationship, or character changes are saved until the app validates them.",
    session.systemPrompt,
    card?.systemPrompt,
  ]
    .filter(isNonEmptyString)
    .join("\n");
}

function formatCardContext(
  session: TurnPipelineSessionContext,
  card?: TurnPipelineCardContext,
): string {
  const lines = [
    `Session: ${session.title ?? session.id}`,
    session.mode ? `Mode: ${session.mode}` : "",
    session.summary ? `Session summary: ${session.summary}` : "",
    card?.id ? `Card ID: ${card.id}` : "",
    card?.name ? `Card: ${card.name}` : "",
    card?.kind ? `Card kind: ${card.kind}` : "",
    card?.summary ? `Card summary: ${card.summary}` : "",
    card?.characterDefinition ? `Character definition:\n${card.characterDefinition}` : "",
  ];

  return lines.filter(isNonEmptyString).join("\n");
}

function formatRules(rules?: readonly TurnPipelineRule[]): string {
  const enabledRules = rules?.filter((rule) => rule.enabled !== false) ?? [];

  return enabledRules
    .map((rule, index) => {
      const enforcement = rule.enforcement ? ` [${rule.enforcement}]` : "";
      return `${index + 1}. ${rule.title ?? rule.id}${enforcement}: ${rule.description}`;
    })
    .join("\n");
}

function formatMemoryEntries(entries?: readonly TurnPipelineMemoryEntry[]): string {
  return getEnabledMemoryEntries(entries).map(formatMemoryEntry).join("\n");
}

function formatLoreEntries(entries?: readonly TurnPipelineLoreEntry[]): string {
  return getEnabledLoreEntries(entries)
    .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0))
    .map(formatLoreEntry)
    .join("\n\n");
}

function formatMemoryEntry(entry: TurnPipelineMemoryEntry): string {
  const label = entry.label ? `${entry.label}: ` : "";
  const importance = entry.importance === undefined ? "" : ` [importance: ${String(entry.importance)}]`;
  return `- ${label}${entry.text ?? entry.detail ?? ""}${importance}`;
}

function formatLoreEntry(entry: TurnPipelineLoreEntry): string {
  const title = entry.title ?? entry.id;
  const priority = entry.priority === undefined ? "" : ` | priority ${entry.priority}`;
  return `[${title}${priority}]\n${entry.content}`;
}

function getPromptIncludedMemoryEntryIds(
  entries: readonly TurnPipelineMemoryEntry[] | undefined,
  prompt: string,
): string[] {
  return getEnabledMemoryEntries(entries)
    .filter((entry) => prompt.includes(formatMemoryEntry(entry)))
    .map((entry) => entry.id);
}

function getPromptIncludedLoreEntryIds(
  entries: readonly TurnPipelineLoreEntry[] | undefined,
  prompt: string,
): string[] {
  return getEnabledLoreEntries(entries)
    .filter((entry) => prompt.includes(formatLoreEntry(entry)))
    .map((entry) => entry.id);
}

function formatSocialExpectation(request: Omit<RunTurnPipelineRequest, "modelAdapter" | "model">): string {
  const analysis = analyzeSocialExpectation({
    actorName: request.card?.name,
    socialRole: request.card?.kind === "rpg" ? "narrator" : "character",
    situation: request.session.summary,
    publicContext: true,
    userAppearsComposed: true,
  });

  return [
    `Tone: ${analysis.tone}`,
    `Public behavior: ${analysis.likelyPublicBehavior.join("; ")}`,
    `Likely actions: ${analysis.likelyActions.join("; ")}`,
    `Forbidden actions: ${analysis.unlikelyOrForbiddenActions.join("; ")}`,
    `Knowledge boundary: ${analysis.knowledgeBoundary}`,
  ].join("\n");
}

function formatRpgState(state?: TurnPipelineRpgState | null): string {
  if (!state) {
    return "";
  }

  const lines = [
    state.id ? `State snapshot ID: ${state.id}` : "",
    state.location ? `Location: ${state.location}` : "",
    state.sceneSummary ? `Scene summary: ${state.sceneSummary}` : "",
    state.health !== undefined ? `Health: ${stringifyValue(state.health)}` : "",
    state.player !== undefined ? `Player: ${stringifyValue(state.player)}` : "",
    state.inventory ? `Inventory: ${formatList(state.inventory)}` : "",
    state.activeQuestIds ? `Active quest IDs: ${formatList(state.activeQuestIds)}` : "",
    state.quests ? `Quests: ${formatList(state.quests)}` : "",
    state.companionCharacterIds ? `Companions: ${formatList(state.companionCharacterIds)}` : "",
    state.knownPlaces ? `Known places: ${formatList(state.knownPlaces)}` : "",
    state.statusEffects ? `Status effects: ${formatList(state.statusEffects)}` : "",
    state.worldFlags ? `World flags: ${stringifyValue(state.worldFlags)}` : "",
    state.flags ? `Flags: ${stringifyValue(state.flags)}` : "",
  ].filter(isNonEmptyString);

  return lines.length > 0 ? lines.join("\n") : stringifyValue(state);
}

function formatMessages(messages: readonly TurnPipelineMessage[]): string {
  return messages.map((message) => `${message.role}: ${message.content}`).join("\n");
}

function formatList(values: readonly unknown[]): string {
  if (values.length === 0) {
    return "none";
  }

  return values.map((value) => stringifyValue(value)).join(", ");
}

function getEnabledMemoryEntries(entries?: readonly TurnPipelineMemoryEntry[]): TurnPipelineMemoryEntry[] {
  return (entries ?? []).filter((entry) => entry.enabled !== false && isNonEmptyString(entry.text ?? entry.detail));
}

function getEnabledLoreEntries(entries?: readonly TurnPipelineLoreEntry[]): TurnPipelineLoreEntry[] {
  return (entries ?? []).filter((entry) => entry.enabled !== false && isNonEmptyString(entry.content));
}

function resolveLatestUserMessage(
  messages: readonly TurnPipelineMessage[],
  explicit?: TurnPipelineMessage | string,
): ResolvedLatestUserMessage {
  if (typeof explicit === "string") {
    return {
      messageIndex: -1,
      content: explicit,
    };
  }

  if (explicit) {
    return {
      message: explicit,
      messageIndex: -1,
      content: explicit.content,
    };
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      return {
        message: messages[index],
        messageIndex: index,
        content: messages[index].content,
      };
    }
  }

  return {
    messageIndex: -1,
    content: "",
  };
}

function parseExtractionFromResponse(response: TextGenerationResponse): ExtractionParseResult {
  const rawExtraction = getNestedExtractionCandidate(response.raw);

  if (rawExtraction) {
    return {
      candidate: rawExtraction.extraction,
      assistantMessageText: rawExtraction.assistantMessageText ?? response.text,
    };
  }

  const wholeTextJson = parseJsonObject(response.text);
  if (wholeTextJson) {
    return unwrapModelPayload(wholeTextJson, response.text);
  }

  const fencedJson = parseFirstFencedJson(response.text);
  if (fencedJson) {
    const unwrapped = unwrapModelPayload(fencedJson.value, response.text);

    return {
      candidate: unwrapped.candidate,
      assistantMessageText:
        unwrapped.assistantMessageText === response.text
          ? stripText(response.text.replace(fencedJson.fullMatch, ""))
          : unwrapped.assistantMessageText,
    };
  }

  const embeddedJson = parseEmbeddedJsonObject(response.text);
  if (embeddedJson) {
    const unwrapped = unwrapModelPayload(embeddedJson.value, response.text);

    return {
      candidate: unwrapped.candidate,
      assistantMessageText:
        unwrapped.assistantMessageText === response.text
          ? stripText(response.text.replace(embeddedJson.fullMatch, ""))
          : unwrapped.assistantMessageText,
    };
  }

  return {};
}

function getNestedExtractionCandidate(
  value: unknown,
): { extraction: unknown; assistantMessageText?: string } | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const assistantMessageText = getStringProperty(value, [
    "assistant_message",
    "assistantMessage",
    "response",
    "text",
  ]);
  const extraction = value.extraction ?? value.extractionJson ?? value.extraction_json;

  if (extraction !== undefined) {
    return {
      extraction,
      assistantMessageText,
    };
  }

  if (looksLikeExtractionPayload(value)) {
    return {
      extraction: value,
      assistantMessageText,
    };
  }

  return undefined;
}

function unwrapModelPayload(payload: Record<string, unknown>, fallbackText: string): ExtractionParseResult {
  const nestedExtraction = getNestedExtractionCandidate(payload);

  if (nestedExtraction) {
    return {
      candidate: nestedExtraction.extraction,
      assistantMessageText: nestedExtraction.assistantMessageText ?? fallbackText,
    };
  }

  return {
    candidate: looksLikeExtractionPayload(payload) ? payload : undefined,
    assistantMessageText: fallbackText,
  };
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return undefined;
  }

  return parseRecordJson(trimmed);
}

function parseFirstFencedJson(
  value: string,
): { value: Record<string, unknown>; fullMatch: string } | undefined {
  const match = /```(?:json)?\s*([\s\S]*?)```/i.exec(value);
  if (!match) {
    return undefined;
  }

  const parsed = parseRecordJson(match[1].trim());
  if (!parsed) {
    return undefined;
  }

  return {
    value: parsed,
    fullMatch: match[0],
  };
}

function parseEmbeddedJsonObject(value: string): ParsedJsonMatch | undefined {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");

  if (start < 0 || end <= start) {
    return undefined;
  }

  const fullMatch = value.slice(start, end + 1);
  const parsed = parseRecordJson(fullMatch);
  if (!parsed) {
    return undefined;
  }

  return {
    value: parsed,
    fullMatch,
  };
}

function parseRecordJson(value: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function looksLikeExtractionPayload(value: Record<string, unknown>): boolean {
  return [
    "new_characters",
    "updated_characters",
    "new_events",
    "character_knowledge_updates",
    "relationship_updates",
    "memory_updates",
    "rpg_state_updates",
    "image_prompt_opportunity",
    "continuity_warnings",
    "newCharacters",
    "updatedCharacters",
    "newEvents",
    "characterKnowledgeUpdates",
    "relationshipUpdates",
    "memoryUpdates",
    "rpgStateUpdates",
    "imagePromptOpportunity",
    "continuityWarnings",
  ].some((key) => key in value);
}

function getStringProperty(value: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const property = value[key];
    if (typeof property === "string" && property.trim().length > 0) {
      return property.trim();
    }
  }

  return undefined;
}

function createStateProposals(extraction: ExtractionResult): TurnStateProposals {
  return {
    extraction,
    newCharacters: extraction.new_characters,
    updatedCharacters: extraction.updated_characters,
    newEvents: extraction.new_events,
    characterKnowledgeUpdates: extraction.character_knowledge_updates,
    relationshipUpdates: extraction.relationship_updates,
    memoryUpdates: extraction.memory_updates,
    rpgStateUpdates: extraction.rpg_state_updates,
    imagePromptOpportunity: extraction.image_prompt_opportunity,
  };
}

function createPromptRunId(timestamp: string): string {
  return `prompt_${timestamp.replace(/[^0-9A-Za-z]/g, "")}`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripText(value: string): string {
  return value.trim();
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }

  const seen = new WeakSet<object>();

  try {
    return (
      JSON.stringify(
        value,
        (_, nestedValue: unknown) => {
          if (typeof nestedValue === "object" && nestedValue !== null) {
            if (seen.has(nestedValue)) {
              return "[Circular]";
            }
            seen.add(nestedValue);
          }

          return nestedValue;
        },
        2,
      ) ?? String(value)
    );
  } catch {
    return String(value);
  }
}

const defaultResponseContract = [
  "Write the assistant reply for the active card.",
  "Presentation rules: use *single asterisks* only for quiet narration/asides, **double asterisks** only for strong emphasis, and normal quotation marks for spoken dialogue.",
  "Do not show raw Markdown fences in the main prose. If useful, put Date, Time, Location, Weather, Health, Inventory, Quest, or Status as a short `status` fenced block at the very end.",
  "Treat permanent changes as proposals. The app validates extraction before saving memory, lore, characters, relationships, events, inventory, location, health, quests, or world flags.",
  "When state should change, include a JSON object with an `extraction` field or a fenced JSON block matching the runtime extraction schema keys.",
].join("\n");
