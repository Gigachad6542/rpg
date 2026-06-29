import type { ExtractionResult } from "../runtime/extraction";

export interface TurnEffectMemoryEntry {
  id: string;
  label: string;
  detail: string;
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

export interface TurnEffectOptions {
  now?: () => string;
  randomId?: () => string;
}

export function applyValidatedTurnEffectsToCard<Card extends TurnEffectRuntimeCard>(
  card: Card,
  extraction: ExtractionResult,
  options: TurnEffectOptions = {},
): Card {
  const memoryUpdates = extraction.memory_updates
    .map((update, index) => toMemoryEntry(update, index, options))
    .filter((entry): entry is TurnEffectMemoryEntry => entry !== null);
  const nextMemory = [...card.memory, ...memoryUpdates].slice(-10);

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

export function describeValidatedTurnEffects(extraction: ExtractionResult): string[] {
  const changes: string[] = [];
  const updates = extraction.rpg_state_updates;

  if (extraction.memory_updates.length > 0) {
    changes.push(`Memory proposals ${extraction.memory_updates.length}`);
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
  };
}

function toQuestLabel(update: Record<string, unknown>): string | null {
  return firstString(update, ["title", "summary", "name", "id"]);
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

function normalizeUniqueList(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
