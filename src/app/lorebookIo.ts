// Chub lorebook import/export helpers extracted from App.tsx.
import {
  parseLoreLiteralMatchBehavior,
  parseLoreMatchMode,
  parseLoreScanScopes,
} from "../runtime/loreTriggerEngine";
import type { Lorebook, LorebookEntry, RuntimeCard } from "./runtimeTypes";
import {
  downloadJson,
  getPayloadBoolean,
  getPayloadNumber,
  getPayloadString,
  getPayloadStringArray,
  isRecord,
  parseJsonRecordOrThrow,
  slugify,
} from "./appUtils";

export function exportLorebookAsChubJson(lorebook: Lorebook, card: RuntimeCard) {
  const payload = buildChubLorebookPayload(lorebook, card);
  const filename = `${slugify(lorebook.name || card.name)}-chub-lorebook.json`;
  downloadJson(filename, payload);
}

export function buildChubLorebookPayload(lorebook: Lorebook, card: RuntimeCard) {
  return {
    name: lorebook.name,
    description: `Exported from Local-First RPG for ${card.name}.`,
    scan_depth: lorebook.scanDepth,
    token_budget: lorebook.tokenBudget,
    recursive_scanning: lorebook.recursiveScanning,
    extensions: {
      source: "local-first-rpg",
      card_id: card.id,
      card_name: card.name,
      chub_compatible: true,
    },
    entries: lorebook.entries.map((entry) => ({
      name: entry.title,
      comment: entry.title,
      content: entry.content,
      keys: entry.keys,
      aliases: entry.aliases ?? [],
      secondary_keys: entry.secondaryKeys,
      enabled: entry.enabled,
      constant: entry.constant,
      selective: entry.secondaryKeys.length > 0,
      selectiveLogic: 0,
      insertion_order: entry.insertionOrder,
      priority: entry.priority,
      probability: entry.probability,
      case_sensitive: entry.caseSensitive,
      whole_word: entry.wholeWord,
      match_mode: entry.matchMode ?? "literal",
      literal_match_behavior: entry.literalMatchBehavior ?? "boundary",
      ...(entry.scanScopes && entry.scanScopes.length > 0 ? { scan_scopes: entry.scanScopes } : {}),
      extensions: {
        source_entry_id: entry.id,
      },
    })),
  };
}

export function parseChubLorebookPayload(rawJson: string): Lorebook {
  return parseCompatibleLorebookPayload(rawJson);
}

export const MAX_LOREBOOK_IMPORT_JSON_CHARS = 2_000_000;
export const MAX_LOREBOOK_IMPORT_ENTRIES = 2_000;
const MAX_LOREBOOK_ENTRY_CONTENT_CHARS = 100_000;
const MAX_LOREBOOK_KEYS_PER_ENTRY = 64;

function boundedLoreList(value: unknown): string[] {
  return getPayloadStringArray(value)
    .slice(0, MAX_LOREBOOK_KEYS_PER_ENTRY)
    .map((item) => item.slice(0, 500));
}

export function parseCompatibleLorebookPayload(rawJson: string): Lorebook {
  if (rawJson.length > MAX_LOREBOOK_IMPORT_JSON_CHARS) {
    throw new Error("Lorebook JSON is too large (maximum 2,000,000 characters).");
  }
  const root = parseJsonRecordOrThrow(rawJson, "Lorebook JSON is invalid.");
  const data = isRecord(root.data) ? root.data : undefined;
  const payload =
    data && isRecord(data.character_book)
      ? data.character_book
      : isRecord(root.character_book)
        ? root.character_book
        : root;
  return mapChubLorebookPayload(payload);
}

/**
 * Maps an already-parsed Chub / Tavern `character_book` record into a runtime Lorebook.
 * Shared by standalone lorebook import and embedded character-card import.
 */
export function mapChubLorebookPayload(
  payload: Record<string, unknown>,
  options: { id?: string; name?: string } = {},
): Lorebook {
  const entries = Array.isArray(payload.entries)
    ? payload.entries
    : isRecord(payload.entries)
      ? Object.values(payload.entries)
      : [];
  if (entries.length > MAX_LOREBOOK_IMPORT_ENTRIES) {
    throw new Error(`Too many lorebook entries (maximum ${MAX_LOREBOOK_IMPORT_ENTRIES}).`);
  }
  const name =
    options.name ||
    getPayloadString(payload.name).slice(0, 200) ||
    getPayloadString(payload.title).slice(0, 200) ||
    "Imported Lorebook";
  const idBase = options.id ?? `lore_import_${Date.now()}`;

  return {
    id: idBase,
    name,
    enabled: getPayloadBoolean(payload.enabled, true),
    scanDepth: getPayloadNumber(payload.scan_depth ?? payload.scanDepth, 4, 1, 30),
    tokenBudget: getPayloadNumber(payload.token_budget ?? payload.tokenBudget, 800, 100, 12_000),
    recursiveScanning: getPayloadBoolean(payload.recursive_scanning ?? payload.recursiveScanning, false),
    entries: entries
      .filter(isRecord)
      .map((entry, index): LorebookEntry => ({
        id: `${idBase}_entry_${index}`,
        title: (getPayloadString(entry.name) || getPayloadString(entry.title) || getPayloadString(entry.comment) || "Imported entry").slice(0, 300),
        keys: boundedLoreList(entry.keys ?? entry.key),
        aliases: boundedLoreList(entry.aliases ?? (isRecord(entry.extensions) ? entry.extensions.aliases : undefined)),
        secondaryKeys: boundedLoreList(entry.secondary_keys ?? entry.secondaryKeys ?? entry.keysecondary),
        content: getPayloadString(entry.content).slice(0, MAX_LOREBOOK_ENTRY_CONTENT_CHARS),
        insertionOrder: getPayloadNumber(entry.insertion_order ?? entry.insertionOrder ?? entry.order, 100, 0, 10_000),
        priority: getPayloadNumber(entry.priority, 0, -100, 100),
        enabled: "disable" in entry ? !getPayloadBoolean(entry.disable, false) : getPayloadBoolean(entry.enabled, true),
        constant: getPayloadBoolean(entry.constant, false),
        probability: getPayloadNumber(entry.probability, 100, 0, 100),
        caseSensitive: getPayloadBoolean(entry.case_sensitive ?? entry.caseSensitive, false),
        wholeWord: getPayloadBoolean(entry.whole_word ?? entry.wholeWord ?? entry.matchWholeWords, false),
        matchMode: parseLoreMatchMode(entry.match_mode ?? entry.matchMode),
        literalMatchBehavior:
          parseLoreLiteralMatchBehavior(entry.literal_match_behavior ?? entry.literalMatchBehavior) ??
          (("whole_word" in entry && entry.whole_word === false) ||
          ("wholeWord" in entry && entry.wholeWord === false) ||
          ("matchWholeWords" in entry && entry.matchWholeWords === false)
            ? "substring"
            : "boundary"),
        scanScopes: parseLoreScanScopes(entry.scan_scopes ?? entry.scanScopes),
      }))
      .filter((entry) => entry.content.trim().length > 0),
  };
}
