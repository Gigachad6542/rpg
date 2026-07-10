// Chub lorebook import/export helpers extracted from App.tsx.
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
    description: `Exported from Local Cards for ${card.name}.`,
    scan_depth: lorebook.scanDepth,
    token_budget: lorebook.tokenBudget,
    recursive_scanning: lorebook.recursiveScanning,
    extensions: {
      source: "local-cards",
      card_id: card.id,
      card_name: card.name,
      chub_compatible: true,
    },
    entries: lorebook.entries.map((entry) => ({
      name: entry.title,
      comment: entry.title,
      content: entry.content,
      keys: entry.keys,
      secondary_keys: entry.secondaryKeys,
      enabled: entry.enabled,
      constant: entry.constant,
      selective: entry.secondaryKeys.length > 0,
      selectiveLogic: 0,
      insertion_order: entry.insertionOrder,
      priority: entry.priority,
      probability: entry.probability,
      extensions: {
        source_entry_id: entry.id,
      },
    })),
  };
}

export function parseChubLorebookPayload(rawJson: string): Lorebook {
  const payload = parseJsonRecordOrThrow(rawJson, "Chub lorebook JSON is invalid.");
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
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  const name =
    options.name ||
    getPayloadString(payload.name) ||
    getPayloadString(payload.title) ||
    "Imported Chub Lorebook";
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
        title: getPayloadString(entry.name) || getPayloadString(entry.title) || getPayloadString(entry.comment) || "Imported entry",
        keys: getPayloadStringArray(entry.keys),
        secondaryKeys: getPayloadStringArray(entry.secondary_keys ?? entry.secondaryKeys),
        content: getPayloadString(entry.content),
        insertionOrder: getPayloadNumber(entry.insertion_order ?? entry.insertionOrder, 100, 0, 10_000),
        priority: getPayloadNumber(entry.priority, 0, -100, 100),
        enabled: getPayloadBoolean(entry.enabled, true),
        constant: getPayloadBoolean(entry.constant, false),
        probability: getPayloadNumber(entry.probability, 100, 0, 100),
        caseSensitive: getPayloadBoolean(entry.case_sensitive ?? entry.caseSensitive, false),
        wholeWord: getPayloadBoolean(entry.whole_word ?? entry.wholeWord, false),
      }))
      .filter((entry) => entry.content.trim().length > 0),
  };
}
