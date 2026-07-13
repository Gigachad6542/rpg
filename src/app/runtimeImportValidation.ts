import { z } from "zod";
import {
  MAX_ROLLING_SUMMARY_CHARACTERS,
  MAX_STORED_ROLLING_SUMMARY_MESSAGES,
} from "../runtime/rollingSummary";

import type { LocalRuntimeSnapshot } from "./localRuntimeStore";
import {
  containsSecretLikeTelemetry,
  isConsistentModelCallRecord,
} from "./modelCallRecordValidation";

export const RUNTIME_IMPORT_LIMITS = {
  bytes: 10 * 1024 * 1024,
  cards: 500,
  chatSessions: 1_000,
  messages: 10_000,
  promptRuns: 5_000,
  generatedMaps: 100,
} as const;

export type ValidatedRuntimeImportSnapshot = LocalRuntimeSnapshot<
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, unknown>
>;

const NonEmptyIdSchema = z.string().trim().min(1);
const StringArraySchema = z.array(z.string());

const MessageSchema = z
  .object({
    id: NonEmptyIdSchema,
    role: z.enum(["system", "user", "assistant"]),
    content: z.string(),
    variants: StringArraySchema.optional(),
    activeVariantIndex: z.number().int().nonnegative().optional(),
    promptRunId: z.string().optional(),
    variantRunIds: StringArraySchema.optional(),
    undoneVariantIndices: z.array(z.number().int().nonnegative()).optional(),
  })
  .passthrough();

const PlayerRuleSchema = z
  .object({
    id: NonEmptyIdSchema,
    title: z.string(),
    description: z.string(),
    enabled: z.boolean(),
    enforcement: z.enum([
      "ignore_rules",
      "validated_state",
      "health_matters",
      "inventory_matters",
      "capability_limits",
      "movement_plausibility",
      "no_free_creation",
      "prompt_only",
    ]),
  })
  .passthrough();

const LorebookEntrySchema = z
  .object({
    id: NonEmptyIdSchema,
    title: z.string().optional(),
    keys: StringArraySchema.optional(),
    aliases: StringArraySchema.optional(),
    secondaryKeys: StringArraySchema.optional(),
    content: z.string(),
    insertionOrder: z.number().optional(),
    priority: z.number().optional(),
    enabled: z.boolean().optional(),
    constant: z.boolean().optional(),
    probability: z.number().optional(),
    caseSensitive: z.boolean().optional(),
    wholeWord: z.boolean().optional(),
    matchMode: z.string().optional(),
    literalMatchBehavior: z.enum(["boundary", "substring"]).optional(),
    scanScopes: StringArraySchema.optional(),
  })
  .passthrough();

const LorebookSchema = z
  .object({
    id: NonEmptyIdSchema,
    name: z.string(),
    enabled: z.boolean().optional(),
    scanDepth: z.number().optional(),
    tokenBudget: z.number().optional(),
    recursiveScanning: z.boolean().optional(),
    entries: z.array(LorebookEntrySchema),
  })
  .passthrough();

const RetrievalProvenanceSchema = z.discriminatedUnion("level", [
  z.object({ level: z.literal("card-global") }).strict(),
  z.object({ level: z.literal("chat"), chatId: NonEmptyIdSchema.max(256) }).strict(),
  z.object({
    level: z.literal("branch"),
    chatId: NonEmptyIdSchema.max(256),
    branchId: NonEmptyIdSchema.max(256),
  }).strict(),
]);

const MemoryEntrySchema = z
  .object({
    id: NonEmptyIdSchema,
    label: z.string(),
    detail: z.string(),
    retrievalScope: RetrievalProvenanceSchema.optional(),
    visibility: z.enum(["narrator", "player-visible", "character-private"]).optional(),
  })
  .passthrough();

const StoryEntitySchema = z
  .object({
    id: NonEmptyIdSchema,
    name: z.string(),
    kind: z.enum(["player", "character", "faction", "group"]),
    summary: z.string(),
    knownFacts: StringArraySchema,
    doesNotKnow: StringArraySchema,
    notes: StringArraySchema,
    updatedAt: z.string().optional(),
  })
  .passthrough();

const RpgStateSchema = z
  .object({
    location: z.string(),
    health: z.string(),
    inventory: StringArraySchema,
    quests: StringArraySchema,
    flags: z.record(z.boolean()),
    knownPlaces: StringArraySchema,
    mapStyle: z.string(),
  })
  .passthrough();

const RuntimeCardSchema = z
  .object({
    id: NonEmptyIdSchema,
    name: z.string(),
    kind: z.enum(["character", "rpg"]),
    summary: z.string(),
    characterName: z.string().optional(),
    characterDescription: z.string().optional(),
    scenario: z.string().optional(),
    greeting: z.string().optional(),
    exampleDialogs: z.string().optional(),
    systemPrompt: z.string().optional(),
    preHistoryInstructions: z.string().optional(),
    postHistoryInstructions: z.string().optional(),
    playerRules: z.array(PlayerRuleSchema).optional(),
    lorebooks: z.array(LorebookSchema).optional(),
    memory: z.array(MemoryEntrySchema).optional(),
    storyEntities: z.array(StoryEntitySchema).optional(),
    mapEnabled: z.boolean().optional(),
    rpg: RpgStateSchema.optional(),
    alternateGreetings: StringArraySchema.optional(),
    creatorNotes: z.string().optional(),
    tags: StringArraySchema.optional(),
    creator: z.string().optional(),
    characterVersion: z.string().optional(),
    avatarDataUrl: z.string().optional(),
    importSource: z.enum(["manual", "tavern-png", "tavern-json", "chub"]).optional(),
    favorite: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .passthrough();

const ChatSessionSchema = z
  .object({
    id: NonEmptyIdSchema,
    cardId: NonEmptyIdSchema,
    title: z.string().optional(),
    branchOfId: z.string().optional(),
    branchedFromMessageId: z.string().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    archived: z.boolean().optional(),
    messages: z.array(MessageSchema).optional(),
    turnLineage: z.record(z.unknown()).optional(),
    authoritativeEvents: z.array(z.record(z.unknown())).max(10_000).optional(),
    rollingSummary: z.object({
      scope: z.object({
        cardId: NonEmptyIdSchema.max(256),
        chatId: NonEmptyIdSchema.max(256),
        branchId: NonEmptyIdSchema.max(256),
      }).strict(),
      text: z.string().min(1).max(MAX_ROLLING_SUMMARY_CHARACTERS),
      coveredMessageIds: z.array(NonEmptyIdSchema.max(256)).min(1).max(MAX_STORED_ROLLING_SUMMARY_MESSAGES),
      coveredMessageFingerprints: z.array(z.string().regex(/^[0-9a-f]{8}$/)).min(1).max(MAX_STORED_ROLLING_SUMMARY_MESSAGES),
      coveredMessageCount: z.number().int().positive().max(1_000_000).optional(),
      coverageFingerprint: z.string().regex(/^[0-9a-f]{16}$/).optional(),
      throughMessageId: NonEmptyIdSchema.max(256),
      updatedAt: z.string(),
    }).strict().optional(),
  })
  .passthrough();

const TokenUsageSchema = z
  .object({
    inputTokens: z.number().nonnegative(),
    outputTokens: z.number().nonnegative(),
    totalTokens: z.number().nonnegative(),
  })
  .passthrough();

const PricingSnapshotSchema = z.object({
  model: z.string().min(1).max(300),
  currency: z.literal("USD"),
  inputUsdPerMillionTokens: z.number().finite().nonnegative(),
  outputUsdPerMillionTokens: z.number().finite().nonnegative(),
  source: z.string().min(1).max(200),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict();

const ModelCallCostSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("known"),
    currency: z.literal("USD"),
    amountUsd: z.number().finite().nonnegative(),
    pricing: PricingSnapshotSchema,
  }).strict(),
  z.object({
    status: z.literal("estimated"),
    currency: z.literal("USD"),
    amountUsd: z.number().finite().nonnegative(),
    pricing: PricingSnapshotSchema,
  }).strict(),
  z.object({
    status: z.literal("unknown"),
    currency: z.literal("USD"),
  }).strict(),
]);

const ModelCallFailureSchema = z.object({
  category: z.enum(["aborted", "authentication", "rate-limit", "network", "validation", "provider", "unknown"]),
  message: z.string().min(1).max(240).refine((message) => !containsSecretLikeTelemetry(message)),
}).strict();

const ModelCallSchema = z
  .object({
    phase: z.enum(["hidden-continuity", "visible-response"]),
    provider: z.string(),
    model: z.string(),
    usage: TokenUsageSchema,
    inputBudgetTokens: z.number().nonnegative().optional(),
    effectiveContextWindowTokens: z.number().positive().max(4_096_000).optional(),
    budgetSource: z.enum(["model-metadata", "conservative-fallback"]).optional(),
    durationMs: z.number().nonnegative(),
    status: z.enum(["success", "error"]),
    usageSource: z.enum(["provider", "estimated", "unavailable"]).optional(),
    cost: ModelCallCostSchema.optional(),
    failure: ModelCallFailureSchema.optional(),
    stateProposalCount: z.number().int().nonnegative().max(10_000).optional(),
  })
  .passthrough()
  .refine(isConsistentModelCallRecord, { message: "Model-call telemetry is internally inconsistent." });

const PromptRunSchema = z
  .object({
    id: NonEmptyIdSchema,
    cardId: z.string().optional(),
    chatId: z.string().optional(),
    compiledPrompt: z.string().optional(),
    response: z.string().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    tokenEstimate: z.number().optional(),
    includedLayerIds: StringArraySchema.optional(),
    includedLoreEntryIds: StringArraySchema.optional(),
    warnings: StringArraySchema.optional(),
    stateChanges: StringArraySchema.optional(),
    usage: TokenUsageSchema.optional(),
    modelCalls: z.array(ModelCallSchema).max(2).optional(),
    blockedReason: z.string().optional(),
  })
  .passthrough();

const GeneratedMapSchema = z
  .object({
    id: NonEmptyIdSchema,
    imageKind: z.enum(["map", "photo", "character"]).optional(),
    cardId: z.string().optional(),
    chatId: z.string().optional(),
    subjectId: z.string().optional(),
    subjectName: z.string().optional(),
    prompt: z.string().optional(),
    negativePrompt: z.string().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    status: z.enum(["prompt-only", "generated", "error"]).optional(),
    imageUrl: z.string().optional(),
    error: z.string().optional(),
    userInput: z.string().optional(),
    createdAt: z.string().optional(),
  })
  .passthrough();

const RuntimeImportSnapshotSchema = z
  .object({
    version: z.literal(2),
    theme: z.enum(["light", "dark"]).optional(),
    activeCardId: z.string(),
    cards: z.array(RuntimeCardSchema),
    messages: z.array(MessageSchema),
    chatSessions: z.array(ChatSessionSchema).optional(),
    activeChatIds: z.record(z.string()).optional(),
    promptRuns: z.array(PromptRunSchema),
    providerKeyStatus: z.string().optional(),
    providerSettings: z.record(z.unknown()).optional(),
    imageProviderSettings: z.record(z.unknown()).optional(),
    runtimeSettings: z.record(z.unknown()).optional(),
    personas: z.array(z.record(z.unknown())).optional(),
    activePersonaId: z.string().optional(),
    generatedMaps: z.array(GeneratedMapSchema).optional(),
    savedAt: z.string().optional(),
  })
  .passthrough();

export function assertRuntimeImportByteLimit(rawJson: string): void {
  if (new TextEncoder().encode(rawJson).byteLength > RUNTIME_IMPORT_LIMITS.bytes) {
    throw new Error("Runtime export exceeds the 10 MB import limit.");
  }
}

export function validateRuntimeImportSnapshot(value: unknown): ValidatedRuntimeImportSnapshot {
  assertTopLevelCollectionLimits(value);
  const result = RuntimeImportSnapshotSchema.safeParse(value);
  if (!result.success) {
    throw new Error("Runtime export JSON is invalid.");
  }

  const snapshot = result.data as unknown as ValidatedRuntimeImportSnapshot;
  assertUniqueIds(snapshot.cards, "card");
  assertUniqueIds(snapshot.chatSessions ?? [], "chat session");
  assertUniqueIds(snapshot.messages, "message");
  assertUniqueIds(snapshot.promptRuns, "prompt run");
  assertUniqueIds((snapshot.generatedMaps ?? []) as Array<Record<string, unknown>>, "generated map");
  assertNestedIdsAndMessageLimit(snapshot);

  return normalizeLegacyOptionalCollections(snapshot);
}

function assertTopLevelCollectionLimits(value: unknown): void {
  if (!isRecord(value)) {
    return;
  }
  assertArrayLimit(value.cards, RUNTIME_IMPORT_LIMITS.cards, "cards");
  assertArrayLimit(value.chatSessions, RUNTIME_IMPORT_LIMITS.chatSessions, "chat sessions");
  assertArrayLimit(value.messages, RUNTIME_IMPORT_LIMITS.messages, "messages");
  assertArrayLimit(value.promptRuns, RUNTIME_IMPORT_LIMITS.promptRuns, "prompt runs");
  assertArrayLimit(value.generatedMaps, RUNTIME_IMPORT_LIMITS.generatedMaps, "generated maps");
}

function assertArrayLimit(value: unknown, max: number, label: string): void {
  if (Array.isArray(value) && value.length > max) {
    throw new Error(`Runtime export exceeds the ${label} persistence limit.`);
  }
}

function assertNestedIdsAndMessageLimit(snapshot: ValidatedRuntimeImportSnapshot): void {
  const uniqueMessageIds = new Set(snapshot.messages.map((message) => message.id as string));
  for (const session of snapshot.chatSessions ?? []) {
    const messages = (session.messages ?? []) as Array<Record<string, unknown>>;
    assertUniqueIds(messages, `message in chat ${String(session.id)}`);
    for (const message of messages) {
      uniqueMessageIds.add(message.id as string);
    }
  }
  if (uniqueMessageIds.size > RUNTIME_IMPORT_LIMITS.messages) {
    throw new Error("Runtime export exceeds the messages persistence limit.");
  }

  for (const card of snapshot.cards) {
    assertUniqueIds((card.playerRules ?? []) as Array<Record<string, unknown>>, `player rule in card ${String(card.id)}`);
    assertUniqueIds((card.memory ?? []) as Array<Record<string, unknown>>, `memory entry in card ${String(card.id)}`);
    assertUniqueIds((card.storyEntities ?? []) as Array<Record<string, unknown>>, `story entity in card ${String(card.id)}`);
    const lorebooks = (card.lorebooks ?? []) as Array<Record<string, unknown>>;
    assertUniqueIds(lorebooks, `lorebook in card ${String(card.id)}`);
    for (const lorebook of lorebooks) {
      assertUniqueIds(
        (lorebook.entries ?? []) as Array<Record<string, unknown>>,
        `lorebook entry in ${String(lorebook.id)}`,
      );
    }
  }
}

function assertUniqueIds(values: Array<Record<string, unknown>>, label: string): void {
  const ids = new Set<string>();
  for (const value of values) {
    const id = value.id as string;
    if (ids.has(id)) {
      throw new Error(`Runtime export contains a duplicate ${label} id.`);
    }
    ids.add(id);
  }
}

function normalizeLegacyOptionalCollections(snapshot: ValidatedRuntimeImportSnapshot): ValidatedRuntimeImportSnapshot {
  return {
    ...snapshot,
    cards: snapshot.cards.map((card) => ({
      ...card,
      playerRules: card.playerRules ?? [],
      lorebooks: normalizeLegacyLorebooks(card.lorebooks),
      memory: card.memory ?? [],
      storyEntities: card.storyEntities ?? [],
    })),
    chatSessions: snapshot.chatSessions?.map((session) => ({
      ...session,
      messages: session.messages ?? [],
    })),
  };
}

function normalizeLegacyLorebooks(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return (value as Array<Record<string, unknown>>).map((lorebook) => ({
    ...lorebook,
    enabled: typeof lorebook.enabled === "boolean" ? lorebook.enabled : true,
    scanDepth: typeof lorebook.scanDepth === "number" ? lorebook.scanDepth : 4,
    tokenBudget: typeof lorebook.tokenBudget === "number" ? lorebook.tokenBudget : 800,
    recursiveScanning: lorebook.recursiveScanning === true,
    entries: ((lorebook.entries ?? []) as Array<Record<string, unknown>>).map((entry, index) => ({
      ...entry,
      title: typeof entry.title === "string" ? entry.title : "",
      keys: Array.isArray(entry.keys) ? entry.keys : [],
      aliases: Array.isArray(entry.aliases) ? entry.aliases : [],
      secondaryKeys: Array.isArray(entry.secondaryKeys) ? entry.secondaryKeys : [],
      insertionOrder: typeof entry.insertionOrder === "number" ? entry.insertionOrder : (index + 1) * 100,
      priority: typeof entry.priority === "number" ? entry.priority : 0,
      enabled: typeof entry.enabled === "boolean" ? entry.enabled : true,
      constant: entry.constant === true,
      probability: typeof entry.probability === "number" ? entry.probability : 100,
      caseSensitive: entry.caseSensitive === true,
      wholeWord: entry.wholeWord === true,
    })),
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
