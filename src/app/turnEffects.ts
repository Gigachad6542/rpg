import type { ExtractionResult } from "../runtime/extraction";
import type {
  HiddenContinuityResult,
  StoryEntity,
} from "../runtime/hiddenContinuity";
import type { HybridRetrievalVisibility, RetrievalProvenance } from "../runtime/hybridRetrieval";

export interface TurnEffectMemoryEntry {
  id: string;
  label: string;
  detail: string;
  retrievalScope?: RetrievalProvenance;
  visibility?: HybridRetrievalVisibility;
}

export interface TurnEffectRpgState {
  location: string;
  health: string;
  inventory: string[];
  quests: string[];
  flags: Record<string, boolean>;
  knownPlaces: string[];
  mapStyle: string;
}

export interface TurnEffectRuntimeCard {
  id: string;
  name: string;
  kind: string;
  memory: TurnEffectMemoryEntry[];
  rpg?: TurnEffectRpgState;
}

export interface HiddenTurnEffectRuntimeCard extends TurnEffectRuntimeCard {
  summary?: string;
  storyEntities?: StoryEntity[];
}

export interface TurnEffectOptions {
  now?: () => string;
  randomId?: () => string;
  memoryRetrievalScope?: RetrievalProvenance;
  memoryVisibility?: HybridRetrievalVisibility;
}

export interface TurnEffectPolicyContext {
  latestUserAction?: string;
  assistantMessageText?: string;
  toolResultText?: string;
}

export type TurnEffectProvenance = "player-action" | "pre-turn-state" | "tool-result" | "model-narration";

export interface TurnEffectProposal {
  kind: "memory" | "entity" | "knowledge" | "location" | "health" | "inventory" | "quest" | "flag";
  summary: string;
  provenance: TurnEffectProvenance;
  applied: boolean;
  reason?: string;
}

export interface TurnEffectPolicyResult {
  extraction: ExtractionResult;
  warnings: string[];
  proposals: TurnEffectProposal[];
}

export interface HiddenContinuityPolicyResult {
  result: HiddenContinuityResult;
  warnings: string[];
  proposals: TurnEffectProposal[];
}

export const MAX_CARD_MEMORY_ENTRIES = 120;

export function applyValidatedTurnEffectsToCard<Card extends TurnEffectRuntimeCard>(
  card: Card,
  extraction: ExtractionResult,
  options: TurnEffectOptions = {},
): Card {
  const memoryUpdates = extraction.memory_updates
    .map((update, index) => toMemoryEntry(update, index, options))
    .filter((entry): entry is TurnEffectMemoryEntry => entry !== null);
  const nextMemory = appendDedupedMemoryEntries(card.memory, memoryUpdates);

  if (!card.rpg || card.kind !== "rpg") {
    return {
      ...card,
      memory: nextMemory,
    };
  }

  const rpgUpdates = extraction.rpg_state_updates;
  const nextLocation = rpgUpdates.location?.trim() || card.rpg.location;
  const nextInventory = normalizeUniqueList([
    ...card.rpg.inventory.filter((item) => !rpgUpdates.inventory_remove.includes(item)),
    ...rpgUpdates.inventory_add,
  ]);
  const questUpdates = rpgUpdates.quest_updates.map(toQuestLabel).filter((quest): quest is string => quest !== null);

  return {
    ...card,
    memory: nextMemory,
    rpg: {
      ...card.rpg,
      location: nextLocation,
      health: applyHealthDelta(card.rpg.health, rpgUpdates.health_delta),
      inventory: nextInventory,
      quests: normalizeUniqueList([...card.rpg.quests, ...questUpdates]),
      knownPlaces: normalizeUniqueList([...card.rpg.knownPlaces, nextLocation]),
      flags: {
        ...card.rpg.flags,
        ...extractBooleanFlags(rpgUpdates.world_flags),
      },
    },
  };
}

export function filterValidatedTurnEffectsForPolicy<Card extends TurnEffectRuntimeCard>(
  card: Card,
  extraction: ExtractionResult,
  context: TurnEffectPolicyContext = {},
): TurnEffectPolicyResult {
  // Only player input and deterministic tool results can authorize a new
  // mutation. Assistant narration is retained in the context solely so a
  // rejected proposal can be labelled `model-narration`; it is never evidence
  // for its own state change.
  const sourceText = `${context.latestUserAction ?? ""}\n${context.toolResultText ?? ""}`;
  const durableEvidence = `${sourceText}\n${buildPreTurnEvidence(card)}`;
  const warnings: string[] = [];
  const characterKnowledgeUpdates = filterCharacterKnowledgeUpdates(
    extraction.character_knowledge_updates,
    durableEvidence,
    warnings,
  );
  const memoryUpdates = extraction.memory_updates.flatMap((update) => {
    const detail = firstString(update, ["detail", "text", "summary", "content"]);
    if (!detail) {
      return [];
    }
    if (looksLikeInstructionAttack(detail)) {
      warnings.push("Blocked unsafe memory proposal from model output.");
      return [];
    }
    if (!isGroundedInSource(detail, durableEvidence)) {
      warnings.push("Blocked ungrounded memory proposal from model output.");
      return [];
    }
    return [sanitizeMemoryUpdateLabels(update, warnings)];
  });

  if (!card.rpg || card.kind !== "rpg") {
    const filteredExtraction = {
      ...extraction,
      memory_updates: memoryUpdates,
      character_knowledge_updates: characterKnowledgeUpdates,
    };
    return {
      extraction: filteredExtraction,
      warnings,
      proposals: buildTurnEffectProposals(card, extraction, filteredExtraction, context),
    };
  }

  const updates = extraction.rpg_state_updates;
  const location = filterLocation(updates.location, sourceText, warnings);
  const healthDelta = filterHealthDelta(updates.health_delta, sourceText, warnings);
  const inventoryAdd = filterInventoryAdditions(updates.inventory_add, sourceText, warnings);
  const inventoryRemove = filterInventoryRemovals(updates.inventory_remove, card.rpg.inventory, sourceText, warnings);
  const questUpdates = filterQuestUpdates(updates.quest_updates, sourceText, warnings);
  const worldFlags = filterWorldFlags(updates.world_flags, sourceText, warnings);

  const filteredExtraction: ExtractionResult = {
    ...extraction,
    memory_updates: memoryUpdates,
    character_knowledge_updates: characterKnowledgeUpdates,
    rpg_state_updates: {
      location,
      health_delta: healthDelta,
      inventory_add: inventoryAdd,
      inventory_remove: inventoryRemove,
      quest_updates: questUpdates,
      world_flags: worldFlags,
    },
  };
  return {
    extraction: filteredExtraction,
    warnings,
    proposals: buildTurnEffectProposals(card, extraction, filteredExtraction, context),
  };
}

export function filterHiddenContinuityForPolicy<Card extends HiddenTurnEffectRuntimeCard>(
  card: Card,
  result: HiddenContinuityResult,
  context: TurnEffectPolicyContext = {},
): HiddenContinuityPolicyResult {
  const warnings: string[] = [];
  const proposals: TurnEffectProposal[] = [];
  const preTurnEvidence = buildPreTurnEvidence(card);

  const memoryUpdates = result.memoryUpdates.flatMap((update) => {
    const provenance = classifyProvenance(update.detail, context, preTurnEvidence, true);
    const unsafe = looksLikeInstructionAttack(update.detail);
    const applied = provenance !== "model-narration" && !unsafe;
    proposals.push({
      kind: "memory",
      summary: `Memory: ${update.detail}`,
      provenance,
      applied,
      ...(!applied ? { reason: unsafe ? "Unsafe instruction-like memory." : "No authoritative evidence." } : {}),
    });
    if (unsafe) {
      warnings.push("Blocked unsafe hidden-continuity memory proposal.");
      return [];
    }
    if (!applied) {
      warnings.push("Blocked ungrounded hidden-continuity memory proposal.");
      return [];
    }
    return [update];
  });

  const entityUpdates = result.entityUpdates.flatMap((update) => {
    const entityProvenance = classifyProvenance(update.name, context, preTurnEvidence, true);
    if (entityProvenance === "model-narration") {
      proposals.push({
        kind: "entity",
        summary: `Entity: ${update.name}`,
        provenance: entityProvenance,
        applied: false,
        reason: "Entity is absent from player input and pre-turn state.",
      });
      warnings.push(`Blocked ungrounded hidden-continuity entity: ${update.name}.`);
      return [];
    }

    const summaryProvenance = update.summary
      ? classifyProvenance(update.summary, context, preTurnEvidence, true)
      : entityProvenance;
    const knownFacts = filterHiddenFacts(update.knownFacts, update.name, context, preTurnEvidence, proposals, warnings);
    const doesNotKnow = filterHiddenFacts(
      update.doesNotKnow,
      update.name,
      context,
      preTurnEvidence,
      proposals,
      warnings,
    );
    proposals.push({
      kind: "entity",
      summary: `Entity: ${update.name}`,
      provenance: entityProvenance,
      applied: true,
    });
    if (update.summary && summaryProvenance === "model-narration") {
      proposals.push({
        kind: "entity",
        summary: `Entity summary: ${update.summary}`,
        provenance: summaryProvenance,
        applied: false,
        reason: "Summary exists only in model output.",
      });
      warnings.push(`Blocked ungrounded hidden-continuity summary for ${update.name}.`);
    }
    return [{
      ...update,
      summary: summaryProvenance === "model-narration" ? "" : update.summary,
      knownFacts,
      doesNotKnow,
    }];
  });

  const knowledgeUpdates = result.knowledgeUpdates.flatMap((update) => {
    const subjectProvenance = classifyProvenance(update.subject, context, preTurnEvidence, true);
    if (subjectProvenance === "model-narration") {
      proposals.push({
        kind: "knowledge",
        summary: `Knowledge subject: ${update.subject}`,
        provenance: subjectProvenance,
        applied: false,
        reason: "Subject is absent from player input and pre-turn state.",
      });
      warnings.push(`Blocked ungrounded hidden-continuity knowledge subject: ${update.subject}.`);
      return [];
    }
    const knows = filterHiddenFacts(update.knows, update.subject, context, preTurnEvidence, proposals, warnings);
    const doesNotKnow = filterHiddenFacts(
      update.doesNotKnow,
      update.subject,
      context,
      preTurnEvidence,
      proposals,
      warnings,
    );
    if (knows.length === 0 && doesNotKnow.length === 0) {
      return [];
    }
    return [{ ...update, knows, doesNotKnow }];
  });

  return {
    result: {
      ...result,
      memoryUpdates,
      entityUpdates,
      knowledgeUpdates,
    },
    warnings,
    proposals,
  };
}

export function describeValidatedTurnEffects(extraction: ExtractionResult): string[] {
  const changes: string[] = [];
  const updates = extraction.rpg_state_updates;

  if (extraction.memory_updates.length > 0) {
    changes.push(`Memory proposals ${extraction.memory_updates.length}`);
  }
  if (extraction.character_knowledge_updates.length > 0) {
    changes.push(`Knowledge updates ${extraction.character_knowledge_updates.length}`);
  }
  if (updates.location) {
    changes.push(`Location -> ${updates.location}`);
  }
  if (updates.health_delta !== 0) {
    changes.push(`Health delta ${updates.health_delta}`);
  }
  if (updates.inventory_add.length > 0) {
    changes.push(`Inventory + ${updates.inventory_add.join(", ")}`);
  }
  if (updates.inventory_remove.length > 0) {
    changes.push(`Inventory - ${updates.inventory_remove.join(", ")}`);
  }
  if (updates.quest_updates.length > 0) {
    changes.push(`Quest proposals ${updates.quest_updates.length}`);
  }
  for (const [flag, value] of Object.entries(updates.world_flags)) {
    changes.push(`Flag ${flag}=${String(value)}`);
  }
  if (extraction.image_prompt_opportunity.should_generate) {
    changes.push("Image prompt opportunity");
  }

  return changes;
}

function toMemoryEntry(
  update: Record<string, unknown>,
  index: number,
  options: TurnEffectOptions,
): TurnEffectMemoryEntry | null {
  const detail = firstString(update, ["detail", "text", "summary", "content"]);
  if (!detail) {
    return null;
  }

  const label = firstString(update, ["label", "title", "category"]) ?? "Model-proposed memory";
  return {
    id: firstString(update, ["id"]) ?? createMemoryId(index, options),
    label,
    detail,
    ...(options.memoryRetrievalScope ? { retrievalScope: { ...options.memoryRetrievalScope } } : {}),
    ...(options.memoryVisibility ? { visibility: options.memoryVisibility } : {}),
  };
}

function toQuestLabel(update: Record<string, unknown>): string | null {
  return firstString(update, ["title", "summary", "name", "id"]);
}

function filterLocation(location: string | null, sourceText: string, warnings: string[]): string | null {
  if (!location) {
    return null;
  }
  if (isGroundedInSource(location, sourceText) && /\b(go|move|travel|walk|head|enter|toward|through)\b/i.test(sourceText)) {
    return location;
  }
  warnings.push(`Blocked ungrounded location proposal: ${location}.`);
  return null;
}

function filterHealthDelta(delta: number, sourceText: string, warnings: string[]): number {
  if (delta === 0) {
    return 0;
  }
  if (delta < 0) {
    if (Math.abs(delta) > 5) {
      warnings.push(`Blocked oversized health delta: ${String(delta)}.`);
      return 0;
    }
    if (/\b(hurt|injur|damage|wound|bleed|burn|poison|lose|lost|cost|hit|health)\w*\b/i.test(sourceText)) {
      return delta;
    }
    warnings.push(`Blocked health delta without authoritative injury evidence: ${String(delta)}.`);
    return 0;
  }
  if (/\b(heal|rest|bandage|potion|recover|restore|treat)\b/i.test(sourceText)) {
    if (delta > 5) {
      warnings.push(`Blocked oversized health delta: ${String(delta)}.`);
      return 0;
    }
    return delta;
  }
  warnings.push(`Blocked positive health delta without a grounded recovery action: ${String(delta)}.`);
  return 0;
}

function filterInventoryAdditions(values: readonly string[], sourceText: string, warnings: string[]): string[] {
  return values.filter((item) => {
    if (isGroundedInSource(item, sourceText) && /\b(take|pick up|collect|grab|loot|receive|find|recover)\b/i.test(sourceText)) {
      return true;
    }
    warnings.push(`Blocked ungrounded inventory addition: ${item}.`);
    return false;
  });
}

function filterInventoryRemovals(
  values: readonly string[],
  currentInventory: readonly string[],
  sourceText: string,
  warnings: string[],
): string[] {
  const removals: string[] = [];
  for (const item of values) {
    const owned = currentInventory.find((current) => current.trim().toLowerCase() === item.trim().toLowerCase());
    if (owned && isGroundedInSource(item, sourceText)) {
      removals.push(owned);
      continue;
    }
    warnings.push(`Blocked ungrounded inventory removal: ${item}.`);
  }
  return removals;
}

function filterQuestUpdates(updates: readonly Record<string, unknown>[], sourceText: string, warnings: string[]): Record<string, unknown>[] {
  return updates.filter((update) => {
    const label = toQuestLabel(update);
    if (label && isGroundedInSource(label, sourceText)) {
      return true;
    }
    warnings.push("Blocked ungrounded quest proposal from model output.");
    return false;
  });
}

function filterWorldFlags(
  flags: Record<string, string | number | boolean | null>,
  sourceText: string,
  warnings: string[],
): Record<string, string | number | boolean | null> {
  const filtered: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(flags)) {
    if (typeof value === "boolean" && isFlagGroundedInSource(key, sourceText)) {
      filtered[key] = value;
      continue;
    }
    warnings.push(`Blocked ungrounded flag proposal: ${key}.`);
  }
  return filtered;
}

function appendDedupedMemoryEntries(
  existing: readonly TurnEffectMemoryEntry[],
  updates: readonly TurnEffectMemoryEntry[],
): TurnEffectMemoryEntry[] {
  const seenDetails = new Set(existing.map((entry) => normalizeText(entry.detail)));
  const appended = [...existing];
  for (const update of updates) {
    const key = normalizeText(update.detail);
    if (!key || seenDetails.has(key)) {
      continue;
    }
    seenDetails.add(key);
    appended.push(update);
  }
  return appended.slice(-MAX_CARD_MEMORY_ENTRIES);
}

function filterCharacterKnowledgeUpdates(
  updates: readonly Record<string, unknown>[],
  sourceText: string,
  warnings: string[],
): Record<string, unknown>[] {
  return updates.flatMap((update) => {
    const subject = firstString(update, ["subject", "name", "character", "character_name", "entity"]);
    if (!subject) {
      return [];
    }
    if (!isGroundedInSource(subject, sourceText)) {
      warnings.push(`Blocked ungrounded knowledge update for ${subject}.`);
      return [];
    }
    const knows = filterGroundedKnowledgeFacts(
      readStringList(update, ["knows", "known_facts", "knownFacts", "learned", "now_knows", "nowKnows"]),
      subject,
      sourceText,
      warnings,
    );
    const doesNotKnow = filterGroundedKnowledgeFacts(
      readStringList(update, ["does_not_know", "doesNotKnow", "no_longer_knows", "noLongerKnows", "forgets"]),
      subject,
      sourceText,
      warnings,
    );
    if (knows.length === 0 && doesNotKnow.length === 0) {
      return [];
    }
    return [{ subject, knows, does_not_know: doesNotKnow }];
  });
}

function filterGroundedKnowledgeFacts(
  facts: readonly string[],
  subject: string,
  sourceText: string,
  warnings: string[],
): string[] {
  return facts.filter((fact) => {
    if (isGroundedInSource(fact, sourceText)) {
      return true;
    }
    warnings.push(`Blocked ungrounded knowledge fact for ${subject}: ${fact}.`);
    return false;
  });
}

function readStringList(value: Record<string, unknown>, keys: readonly string[]): string[] {
  for (const key of keys) {
    const candidate = value[key];
    if (Array.isArray(candidate)) {
      return candidate
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function firstString(value: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

function sanitizeMemoryUpdateLabels(update: Record<string, unknown>, warnings: string[]): Record<string, unknown> {
  const label = firstString(update, ["label", "title", "category"]);
  if (!label || !looksLikeInstructionAttack(label)) {
    return update;
  }

  const safeUpdate = { ...update };
  delete safeUpdate.label;
  delete safeUpdate.title;
  delete safeUpdate.category;
  warnings.push("Replaced unsafe memory label from model output.");
  return safeUpdate;
}

function createMemoryId(index: number, options: TurnEffectOptions): string {
  const timestamp = (options.now?.() ?? new Date().toISOString()).replace(/[^0-9A-Za-z]/g, "");
  const suffix =
    options.randomId?.() ??
    (globalThis.crypto && "randomUUID" in globalThis.crypto
      ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 8)
      : Math.random().toString(36).slice(2, 10));
  return `memory_${timestamp}_${index > 0 ? `${index}_` : ""}${suffix}`;
}

function extractBooleanFlags(flags: Record<string, string | number | boolean | null>): Record<string, boolean> {
  const booleanFlags: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(flags)) {
    if (typeof value === "boolean") {
      booleanFlags[key] = value;
    }
  }
  return booleanFlags;
}

function applyHealthDelta(health: string, delta: number): string {
  if (delta === 0) {
    return health;
  }

  const match = health.match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) {
    return health;
  }

  const current = Number(match[1]);
  const max = Number(match[2]);
  const nextCurrent = Math.min(Math.max(current + delta, 0), max);
  return `${nextCurrent}/${max}`;
}

function buildTurnEffectProposals<Card extends TurnEffectRuntimeCard>(
  card: Card,
  proposed: ExtractionResult,
  filtered: ExtractionResult,
  context: TurnEffectPolicyContext,
): TurnEffectProposal[] {
  const proposals: TurnEffectProposal[] = [];
  const preTurnEvidence = buildPreTurnEvidence(card);

  for (const update of proposed.memory_updates) {
    const detail = firstString(update, ["detail", "text", "summary", "content"]);
    if (!detail) {
      continue;
    }
    proposals.push({
      kind: "memory",
      summary: `Memory: ${detail}`,
      provenance: classifyProvenance(detail, context, preTurnEvidence, true),
      applied: filtered.memory_updates.some((candidate) =>
        normalizeText(firstString(candidate, ["detail", "text", "summary", "content"]) ?? "") === normalizeText(detail)),
    });
  }
  for (const update of proposed.character_knowledge_updates) {
    const subject = firstString(update, ["subject", "name", "character", "character_name", "entity"]);
    if (!subject) {
      continue;
    }
    const facts = [
      ...readStringList(update, ["knows", "known_facts", "knownFacts", "learned", "now_knows", "nowKnows"]),
      ...readStringList(update, ["does_not_know", "doesNotKnow", "no_longer_knows", "noLongerKnows", "forgets"]),
    ];
    for (const fact of facts) {
      const applied = filtered.character_knowledge_updates.some((candidate) =>
        normalizeText(firstString(candidate, ["subject", "name", "character", "character_name", "entity"]) ?? "") ===
          normalizeText(subject) &&
        [...readStringList(candidate, ["knows", "known_facts", "knownFacts"]),
          ...readStringList(candidate, ["does_not_know", "doesNotKnow"])].some(
            (candidateFact) => normalizeText(candidateFact) === normalizeText(fact),
          ),
      );
      proposals.push({
        kind: "knowledge",
        summary: `${subject}: ${fact}`,
        provenance: classifyProvenance(fact, context, preTurnEvidence, true),
        applied,
      });
    }
  }

  const proposedRpg = proposed.rpg_state_updates;
  const filteredRpg = filtered.rpg_state_updates;
  if (proposedRpg.location) {
    proposals.push({
      kind: "location",
      summary: `Location -> ${proposedRpg.location}`,
      provenance: classifyProvenance(proposedRpg.location, context, preTurnEvidence, false),
      applied: normalizeText(filteredRpg.location ?? "") === normalizeText(proposedRpg.location),
    });
  }
  if (proposedRpg.health_delta !== 0) {
    proposals.push({
      kind: "health",
      summary: `Health ${proposedRpg.health_delta > 0 ? "+" : ""}${proposedRpg.health_delta}`,
      provenance: classifyHealthProvenance(proposedRpg.health_delta, context),
      applied: filteredRpg.health_delta === proposedRpg.health_delta,
    });
  }
  for (const item of proposedRpg.inventory_add) {
    proposals.push({
      kind: "inventory",
      summary: `Inventory + ${item}`,
      provenance: classifyProvenance(item, context, preTurnEvidence, false),
      applied: includesNormalized(filteredRpg.inventory_add, item),
    });
  }
  for (const item of proposedRpg.inventory_remove) {
    proposals.push({
      kind: "inventory",
      summary: `Inventory - ${item}`,
      provenance: classifyProvenance(item, context, preTurnEvidence, false),
      applied: includesNormalized(filteredRpg.inventory_remove, item),
    });
  }
  for (const update of proposedRpg.quest_updates) {
    const label = toQuestLabel(update);
    if (!label) {
      continue;
    }
    proposals.push({
      kind: "quest",
      summary: `Quest: ${label}`,
      provenance: classifyProvenance(label, context, preTurnEvidence, false),
      applied: filteredRpg.quest_updates.some((candidate) => normalizeText(toQuestLabel(candidate) ?? "") === normalizeText(label)),
    });
  }
  for (const [key, value] of Object.entries(proposedRpg.world_flags)) {
    proposals.push({
      kind: "flag",
      summary: `Flag ${key}=${String(value)}`,
      provenance: classifyProvenance(key.replace(/[_-]+/g, " "), context, preTurnEvidence, false),
      applied:
        Object.prototype.hasOwnProperty.call(filteredRpg.world_flags, key) &&
        filteredRpg.world_flags[key] === value,
    });
  }

  return proposals;
}

function filterHiddenFacts(
  facts: readonly string[],
  subject: string,
  context: TurnEffectPolicyContext,
  preTurnEvidence: string,
  proposals: TurnEffectProposal[],
  warnings: string[],
): string[] {
  return facts.filter((fact) => {
    const provenance = classifyProvenance(fact, context, preTurnEvidence, true);
    const applied = provenance !== "model-narration";
    proposals.push({
      kind: "knowledge",
      summary: `${subject}: ${fact}`,
      provenance,
      applied,
      ...(!applied ? { reason: "Fact exists only in model output." } : {}),
    });
    if (!applied) {
      warnings.push(`Blocked ungrounded hidden-continuity fact for ${subject}: ${fact}.`);
    }
    return applied;
  });
}

function classifyProvenance(
  value: string,
  context: TurnEffectPolicyContext,
  preTurnEvidence: string,
  allowPreTurn: boolean,
): TurnEffectProvenance {
  if (isGroundedInSource(value, context.latestUserAction ?? "")) {
    return "player-action";
  }
  if (isGroundedInSource(value, context.toolResultText ?? "")) {
    return "tool-result";
  }
  if (allowPreTurn && isGroundedInSource(value, preTurnEvidence)) {
    return "pre-turn-state";
  }
  return "model-narration";
}

function classifyHealthProvenance(delta: number, context: TurnEffectPolicyContext): TurnEffectProvenance {
  const pattern = delta < 0
    ? /\b(hurt|injur|damage|wound|bleed|burn|poison|lose|lost|cost|hit|health)\w*\b/i
    : /\b(heal|rest|bandage|potion|recover|restore|treat)\w*\b/i;
  if (pattern.test(context.latestUserAction ?? "")) {
    return "player-action";
  }
  if (pattern.test(context.toolResultText ?? "")) {
    return "tool-result";
  }
  return "model-narration";
}

function buildPreTurnEvidence(card: HiddenTurnEffectRuntimeCard): string {
  const storyEntities = (card.storyEntities ?? []).flatMap((entity) => [
    entity.name,
    entity.summary,
    ...entity.knownFacts,
    ...entity.doesNotKnow,
    ...entity.notes,
  ]);
  const rpg = card.rpg
    ? [
        card.rpg.location,
        card.rpg.health,
        ...card.rpg.inventory,
        ...card.rpg.quests,
        ...Object.keys(card.rpg.flags),
        ...card.rpg.knownPlaces,
      ]
    : [];
  return [
    card.name,
    card.summary ?? "",
    ...card.memory.flatMap((entry) => [entry.label, entry.detail]),
    ...storyEntities,
    ...rpg,
  ].filter(Boolean).join("\n");
}

function includesNormalized(values: readonly string[], expected: string): boolean {
  const normalizedExpected = normalizeText(expected);
  return values.some((value) => normalizeText(value) === normalizedExpected);
}

function normalizeUniqueList(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function looksLikeInstructionAttack(value: string): boolean {
  return /\b(ignore|bypass|override|forget|disable)\b.*\b(rule|rules|system|prompt|instruction|instructions|guardrail|policy)\b/i.test(
    value,
  );
}

function isGroundedInSource(value: string, sourceText: string): boolean {
  const normalizedValue = normalizeText(value);
  const normalizedSource = normalizeText(sourceText);
  if (!normalizedValue || !normalizedSource) {
    return false;
  }
  const valueTokens = meaningfulTokens(value);
  if (valueTokens.length === 0) {
    return false;
  }
  if (normalizedSource.includes(normalizedValue)) {
    return true;
  }

  const sourceTokens = new Set(meaningfulTokens(sourceText));
  const matched = valueTokens.filter((token) => sourceTokens.has(token)).length;
  return matched / valueTokens.length >= 0.75;
}

function isFlagGroundedInSource(key: string, sourceText: string): boolean {
  const keyTokens = meaningfulTokens(key.replace(/[_-]+/g, " "));
  if (keyTokens.length === 0) {
    return false;
  }
  const sourceTokens = new Set(meaningfulTokens(sourceText));
  return keyTokens.every((token) => sourceTokens.has(token));
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function meaningfulTokens(value: string): string[] {
  const stopWords = new Set(["a", "an", "and", "as", "at", "in", "into", "of", "on", "or", "the", "to", "with"]);
  return normalizeText(value)
    .split(/\s+/)
    .filter((token) => token.length > 1 && !stopWords.has(token));
}
