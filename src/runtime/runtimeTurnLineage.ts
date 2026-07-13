import {
  applyHiddenContinuityToCard,
  createEmptyHiddenContinuityResult,
  parseHiddenContinuityResponse,
  toHiddenContinuityKnowledgeUpdates,
  type HiddenContinuityResult,
  type StoryEntity,
} from "./hiddenContinuity";
import {
  createEmptyExtractionResult,
  validateExtractionResult,
  type ExtractionResult,
} from "./extraction";
import {
  emptyTurnLedger,
  foldTurnLedger,
  recordTurnVariant,
  remapTurnLedger,
  type LedgerMessage,
  type TurnLedger,
} from "./turnLedger";
import {
  applyValidatedTurnEffectsToCard,
  type TurnEffectMemoryEntry,
  type TurnEffectRpgState,
  type TurnEffectRuntimeCard,
} from "../app/turnEffects";
import { parseRetrievalProvenance, type RetrievalProvenance } from "./hybridRetrieval";

/** Mutable card state that belongs to a chat lineage rather than card metadata. */
export interface RuntimeTurnState {
  memory: TurnEffectMemoryEntry[];
  storyEntities: StoryEntity[];
  rpg?: TurnEffectRpgState;
}

/** Complete state mutation produced by one generated assistant variant. */
export interface RuntimeTurnEffects {
  hiddenContinuity: HiddenContinuityResult;
  extraction: ExtractionResult;
  committedAt: string;
  idSeed: string;
  memoryRetrievalScope?: RetrievalProvenance;
}

/** Persisted immutable root plus variant-aware commits for one chat branch. */
export interface RuntimeTurnLineage {
  baseState: RuntimeTurnState;
  ledger: TurnLedger<RuntimeTurnEffects>;
}

export interface RuntimeTurnCard extends TurnEffectRuntimeCard {
  summary: string;
  storyEntities: StoryEntity[];
}

export interface CreateRuntimeTurnEffectsInput {
  hiddenContinuity: HiddenContinuityResult;
  extraction: ExtractionResult;
  committedAt: string;
  idSeed: string;
  memoryRetrievalScope?: RetrievalProvenance;
}

export function createRuntimeTurnLineage(card: RuntimeTurnCard): RuntimeTurnLineage {
  return {
    baseState: captureRuntimeTurnState(card),
    ledger: emptyTurnLedger<RuntimeTurnEffects>(),
  };
}

/**
 * Materializes identifiers at commit time and records a stable timestamp/seed.
 * Replaying a lineage therefore never creates a new identity merely because a
 * user swiped away from a variant and returned to it later.
 */
export function createRuntimeTurnEffects(input: CreateRuntimeTurnEffectsInput): RuntimeTurnEffects {
  const idSeed = sanitizeIdPart(input.idSeed) || "turn";
  return {
    hiddenContinuity: {
      ...input.hiddenContinuity,
      memoryUpdates: input.hiddenContinuity.memoryUpdates.map((update, index) => ({
        ...update,
        id: update.id || stableMutationId("hidden-memory", idSeed, index),
      })),
      entityUpdates: input.hiddenContinuity.entityUpdates.map((update, index) => ({
        ...update,
        id: update.id || stableMutationId("entity", idSeed, index),
      })),
      knowledgeUpdates: input.hiddenContinuity.knowledgeUpdates.map((update) => ({
        ...update,
        knows: [...update.knows],
        doesNotKnow: [...update.doesNotKnow],
      })),
      warnings: [...input.hiddenContinuity.warnings],
    },
    extraction: {
      ...input.extraction,
      memory_updates: input.extraction.memory_updates.map((update, index) => ({
        ...update,
        id: readNonEmptyString(update.id) || stableMutationId("visible-memory", idSeed, index),
      })),
      new_characters: input.extraction.new_characters.map((value) => ({ ...value })),
      updated_characters: input.extraction.updated_characters.map((value) => ({ ...value })),
      new_events: input.extraction.new_events.map((value) => ({ ...value })),
      character_knowledge_updates: input.extraction.character_knowledge_updates.map((value) => ({ ...value })),
      relationship_updates: input.extraction.relationship_updates.map((value) => ({ ...value })),
      rpg_state_updates: {
        ...input.extraction.rpg_state_updates,
        inventory_add: [...input.extraction.rpg_state_updates.inventory_add],
        inventory_remove: [...input.extraction.rpg_state_updates.inventory_remove],
        quest_updates: input.extraction.rpg_state_updates.quest_updates.map((value) => ({ ...value })),
        world_flags: { ...input.extraction.rpg_state_updates.world_flags },
      },
      image_prompt_opportunity: { ...input.extraction.image_prompt_opportunity },
      continuity_warnings: [...input.extraction.continuity_warnings],
    },
    committedAt: normalizeTimestamp(input.committedAt),
    idSeed,
    ...(input.memoryRetrievalScope ? { memoryRetrievalScope: { ...input.memoryRetrievalScope } } : {}),
  };
}

export function recordRuntimeTurnVariant(
  lineage: RuntimeTurnLineage,
  messageId: string,
  variantIndex: number,
  effects: RuntimeTurnEffects,
): RuntimeTurnLineage {
  return {
    baseState: cloneRuntimeTurnState(lineage.baseState),
    ledger: recordTurnVariant(lineage.ledger, messageId, variantIndex, effects),
  };
}

export function deriveRuntimeTurnCard<Card extends RuntimeTurnCard>(
  card: Card,
  messages: readonly LedgerMessage[],
  lineage: RuntimeTurnLineage,
): Card {
  const baseCard = restoreRuntimeTurnState(card, lineage.baseState);
  return foldTurnLedger(baseCard, messages, lineage.ledger, applyRuntimeTurnEffectsToCard);
}

/** Derives the state that existed before a generated assistant turn. */
export function deriveRuntimePreTurnCard<Card extends RuntimeTurnCard>(
  card: Card,
  messages: readonly LedgerMessage[],
  lineage: RuntimeTurnLineage,
  assistantMessageId: string,
): Card {
  const targetIndex = messages.findIndex((message) => message.id === assistantMessageId);
  const prefix = targetIndex >= 0 ? messages.slice(0, targetIndex) : messages;
  return deriveRuntimeTurnCard(card, prefix, lineage);
}

export function branchRuntimeTurnLineage(
  lineage: RuntimeTurnLineage,
  sourceMessages: readonly LedgerMessage[],
  branchMessages: readonly LedgerMessage[],
  memoryRetrievalScope?: RetrievalProvenance,
): RuntimeTurnLineage {
  const idMap = new Map<string, string>();
  const pairCount = Math.min(sourceMessages.length, branchMessages.length);
  for (let index = 0; index < pairCount; index += 1) {
    idMap.set(sourceMessages[index].id, branchMessages[index].id);
  }
  const ledger = remapTurnLedger(lineage.ledger, idMap);
  if (memoryRetrievalScope) {
    for (const commit of Object.values(ledger)) {
      commit.variants = commit.variants.map((variant) => ({
        ...variant,
        effects: { ...variant.effects, memoryRetrievalScope: { ...memoryRetrievalScope } },
      }));
    }
  }
  return {
    baseState: cloneRuntimeTurnState(lineage.baseState),
    ledger,
  };
}

export function parseRuntimeTurnLineage(
  value: unknown,
  fallbackCard: RuntimeTurnCard,
  defaultMemoryRetrievalScope?: RetrievalProvenance,
): RuntimeTurnLineage {
  if (!isRecord(value)) {
    return createRuntimeTurnLineage(fallbackCard);
  }

  const baseState = parseRuntimeTurnState(value.baseState, fallbackCard);
  const ledger: TurnLedger<RuntimeTurnEffects> = {};
  if (!isRecord(value.ledger)) {
    return { baseState, ledger };
  }

  for (const [messageId, rawCommit] of Object.entries(value.ledger)) {
    if (!messageId || !isRecord(rawCommit) || !Array.isArray(rawCommit.variants)) {
      continue;
    }
    for (const rawVariant of rawCommit.variants) {
      if (!isRecord(rawVariant)) {
        continue;
      }
      const variantIndex = rawVariant.variantIndex;
      if (typeof variantIndex !== "number" || !Number.isInteger(variantIndex) || variantIndex < 0) {
        continue;
      }
      const effects = parseRuntimeTurnEffects(
        rawVariant.effects,
        messageId,
        variantIndex,
        defaultMemoryRetrievalScope,
      );
      if (!effects) {
        continue;
      }
      const next = recordTurnVariant(ledger, messageId, variantIndex, effects);
      Object.assign(ledger, next);
    }
  }

  return { baseState, ledger };
}

export function captureRuntimeTurnState(card: RuntimeTurnCard): RuntimeTurnState {
  return {
    memory: card.memory.map(cloneMemoryEntry),
    storyEntities: card.storyEntities.map(cloneStoryEntity),
    ...(card.rpg ? { rpg: cloneRpgState(card.rpg) } : {}),
  };
}

export function restoreRuntimeTurnState<Card extends RuntimeTurnCard>(
  card: Card,
  state: RuntimeTurnState,
): Card {
  return {
    ...card,
    memory: state.memory.map(cloneMemoryEntry),
    storyEntities: state.storyEntities.map(cloneStoryEntity),
    ...(state.rpg ? { rpg: cloneRpgState(state.rpg) } : { rpg: undefined }),
  };
}

function applyRuntimeTurnEffectsToCard<Card extends RuntimeTurnCard>(
  card: Card,
  effects: RuntimeTurnEffects,
): Card {
  const randomId = createDeterministicIdFactory(effects.idSeed);
  const options = {
    now: () => effects.committedAt,
    randomId,
    memoryRetrievalScope: effects.memoryRetrievalScope,
    memoryVisibility: "narrator" as const,
  };
  const withHidden = applyHiddenContinuityToCard(card, effects.hiddenContinuity, options);
  const visibleKnowledge = {
    ...createEmptyHiddenContinuityResult(),
    knowledgeUpdates: toHiddenContinuityKnowledgeUpdates(effects.extraction.character_knowledge_updates),
  };
  const withVisibleKnowledge = applyHiddenContinuityToCard(withHidden, visibleKnowledge, options);
  return applyValidatedTurnEffectsToCard(withVisibleKnowledge, effects.extraction, options) as Card;
}

function parseRuntimeTurnEffects(
  value: unknown,
  messageId: string,
  variantIndex: number,
  defaultMemoryRetrievalScope?: RetrievalProvenance,
): RuntimeTurnEffects | null {
  if (!isRecord(value)) {
    return null;
  }
  const extraction = validateExtractionResult(value.extraction ?? createEmptyExtractionResult());
  if (!extraction.success) {
    return null;
  }
  const hiddenContinuity = parseHiddenContinuityResponse(
    JSON.stringify(isRecord(value.hiddenContinuity) ? value.hiddenContinuity : {}),
  );
  return createRuntimeTurnEffects({
    hiddenContinuity,
    extraction: extraction.data,
    committedAt: typeof value.committedAt === "string" ? value.committedAt : "1970-01-01T00:00:00.000Z",
    idSeed: typeof value.idSeed === "string" ? value.idSeed : `${messageId}-v${variantIndex}`,
    memoryRetrievalScope: parseRetrievalProvenance(value.memoryRetrievalScope) ?? defaultMemoryRetrievalScope,
  });
}

function parseRuntimeTurnState(value: unknown, fallbackCard: RuntimeTurnCard): RuntimeTurnState {
  const fallback = captureRuntimeTurnState(fallbackCard);
  if (!isRecord(value)) {
    return fallback;
  }

  const memory = Array.isArray(value.memory)
    ? value.memory.flatMap((entry): TurnEffectMemoryEntry[] => {
        if (!isRecord(entry)) {
          return [];
        }
        const id = readNonEmptyString(entry.id);
        const label = readNonEmptyString(entry.label);
        const detail = readNonEmptyString(entry.detail);
        const retrievalScope = parseRetrievalProvenance(entry.retrievalScope);
        const visibility = entry.visibility === "narrator" || entry.visibility === "player-visible" || entry.visibility === "character-private"
          ? entry.visibility
          : undefined;
        return id && label && detail
          ? [{
              id,
              label,
              detail,
              ...(retrievalScope ? { retrievalScope } : {}),
              ...(visibility ? { visibility } : {}),
            }]
          : [];
      })
    : fallback.memory;
  const storyEntities = Array.isArray(value.storyEntities)
    ? value.storyEntities.flatMap((entity): StoryEntity[] => {
        if (!isRecord(entity)) {
          return [];
        }
        const id = readNonEmptyString(entity.id);
        const name = readNonEmptyString(entity.name);
        const kind = parseEntityKind(entity.kind);
        if (!id || !name || !kind) {
          return [];
        }
        return [{
          id,
          name,
          kind,
          summary: typeof entity.summary === "string" ? entity.summary : "",
          knownFacts: readStringArray(entity.knownFacts),
          doesNotKnow: readStringArray(entity.doesNotKnow),
          notes: readStringArray(entity.notes),
          ...(typeof entity.updatedAt === "string" ? { updatedAt: entity.updatedAt } : {}),
        }];
      })
    : fallback.storyEntities;
  const rpg = parseRpgState(value.rpg, fallback.rpg);

  return {
    memory,
    storyEntities,
    ...(rpg ? { rpg } : {}),
  };
}

function parseRpgState(value: unknown, fallback: TurnEffectRpgState | undefined): TurnEffectRpgState | undefined {
  if (!isRecord(value)) {
    return fallback ? cloneRpgState(fallback) : undefined;
  }
  return {
    location: typeof value.location === "string" ? value.location : fallback?.location ?? "",
    health: typeof value.health === "string" ? value.health : fallback?.health ?? "",
    inventory: Array.isArray(value.inventory) ? readStringArray(value.inventory) : [...(fallback?.inventory ?? [])],
    quests: Array.isArray(value.quests) ? readStringArray(value.quests) : [...(fallback?.quests ?? [])],
    flags: isRecord(value.flags)
      ? Object.fromEntries(Object.entries(value.flags).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"))
      : { ...(fallback?.flags ?? {}) },
    knownPlaces: Array.isArray(value.knownPlaces)
      ? readStringArray(value.knownPlaces)
      : [...(fallback?.knownPlaces ?? [])],
    mapStyle: typeof value.mapStyle === "string" ? value.mapStyle : fallback?.mapStyle ?? "",
  };
}

function cloneRuntimeTurnState(state: RuntimeTurnState): RuntimeTurnState {
  return {
    memory: state.memory.map(cloneMemoryEntry),
    storyEntities: state.storyEntities.map(cloneStoryEntity),
    ...(state.rpg ? { rpg: cloneRpgState(state.rpg) } : {}),
  };
}

function cloneStoryEntity(entity: StoryEntity): StoryEntity {
  return {
    ...entity,
    knownFacts: [...entity.knownFacts],
    doesNotKnow: [...entity.doesNotKnow],
    notes: [...entity.notes],
  };
}

function cloneMemoryEntry(entry: TurnEffectMemoryEntry): TurnEffectMemoryEntry {
  return {
    ...entry,
    ...(entry.retrievalScope ? { retrievalScope: { ...entry.retrievalScope } } : {}),
  };
}

function cloneRpgState(rpg: TurnEffectRpgState): TurnEffectRpgState {
  return {
    ...rpg,
    inventory: [...rpg.inventory],
    quests: [...rpg.quests],
    flags: { ...rpg.flags },
    knownPlaces: [...rpg.knownPlaces],
  };
}

function createDeterministicIdFactory(seed: string): () => string {
  let index = 0;
  return () => `${sanitizeIdPart(seed) || "turn"}_${index++}`;
}

function stableMutationId(prefix: string, seed: string, index: number): string {
  return `${prefix}_${sanitizeIdPart(seed)}_${index}`;
}

function sanitizeIdPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 96);
}

function normalizeTimestamp(value: string): string {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "1970-01-01T00:00:00.000Z";
}

function parseEntityKind(value: unknown): StoryEntity["kind"] | null {
  return value === "player" || value === "character" || value === "faction" || value === "group" ? value : null;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
