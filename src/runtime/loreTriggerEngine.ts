export interface LoreTriggerEntry {
  id: string;
  title: string;
  keys: string[];
  secondaryKeys: string[];
  content: string;
  insertionOrder: number;
  priority: number;
  enabled: boolean;
  constant: boolean;
  probability: number;
  caseSensitive?: boolean;
  wholeWord?: boolean;
}

export interface LoreTriggerBook<Entry extends LoreTriggerEntry = LoreTriggerEntry> {
  id: string;
  enabled: boolean;
  scanDepth: number;
  tokenBudget: number;
  recursiveScanning: boolean;
  entries: Entry[];
}

export interface LoreTriggerMessage {
  content: string;
}

export interface LoreTriggerContext {
  currentLocation?: string;
  activeQuests?: string[];
  inventory?: string[];
  worldFlags?: Record<string, boolean | number | string>;
}

export interface SelectLorebookEntriesInput<Entry extends LoreTriggerEntry = LoreTriggerEntry> {
  lorebooks: LoreTriggerBook<Entry>[];
  messages: LoreTriggerMessage[];
  draft: string;
  context?: LoreTriggerContext;
}

export function selectActiveLorebookEntries<Entry extends LoreTriggerEntry>(
  input: SelectLorebookEntriesInput<Entry>,
): Entry[] {
  const activeEntries: Entry[] = [];

  for (const lorebook of input.lorebooks) {
    if (!lorebook.enabled) {
      continue;
    }

    const baseScanText = buildLorebookScanText(input.messages, input.draft, lorebook.scanDepth, input.context);
    let triggeredEntries = lorebook.entries.filter((entry) => isLorebookEntryActive(entry, baseScanText));

    if (lorebook.recursiveScanning && triggeredEntries.length > 0) {
      const recursiveScanText = `${baseScanText.raw}\n${triggeredEntries.map((entry) => entry.content).join("\n")}`;
      triggeredEntries = uniqueLorebookEntries([
        ...triggeredEntries,
        ...lorebook.entries.filter((entry) => isLorebookEntryActive(entry, normalizeScanText(recursiveScanText))),
      ]);
    }

    activeEntries.push(...applyLorebookBudget(triggeredEntries, lorebook.tokenBudget));
  }

  return uniqueLorebookEntries(activeEntries).sort(compareLorebookEntries);
}

function buildLorebookScanText(
  messages: LoreTriggerMessage[],
  draft: string,
  scanDepth: number,
  context?: LoreTriggerContext,
): NormalizedScanText {
  const historyText = messages
    .slice(-Math.max(1, scanDepth))
    .map((message) => message.content)
    .join("\n");
  const contextText = [
    context?.currentLocation ? `location: ${context.currentLocation}` : "",
    context?.activeQuests?.length ? `active quests: ${context.activeQuests.join(", ")}` : "",
    context?.inventory?.length ? `inventory: ${context.inventory.join(", ")}` : "",
    context?.worldFlags ? `world flags: ${Object.entries(context.worldFlags).map(([key, value]) => `${key}=${value}`).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return normalizeScanText(`${historyText}\n${draft}\n${contextText}`);
}

interface NormalizedScanText {
  raw: string;
  lower: string;
}

function normalizeScanText(raw: string): NormalizedScanText {
  return {
    raw,
    lower: raw.toLowerCase(),
  };
}

function isLorebookEntryActive(entry: LoreTriggerEntry, scanText: NormalizedScanText): boolean {
  if (!entry.enabled || entry.probability <= 0) {
    return false;
  }

  if (entry.constant) {
    return probabilityAllows(entry);
  }

  const hasPrimaryKey = entry.keys.some((key) => termMatches(scanText, key, entry));
  const hasSecondaryKey =
    entry.secondaryKeys.length === 0 || entry.secondaryKeys.some((key) => termMatches(scanText, key, entry));

  return hasPrimaryKey && hasSecondaryKey && probabilityAllows(entry);
}

function termMatches(scanText: NormalizedScanText, rawTerm: string, entry: LoreTriggerEntry): boolean {
  const term = rawTerm.trim();
  if (!term) {
    return false;
  }

  const haystack = entry.caseSensitive ? scanText.raw : scanText.lower;
  const needle = entry.caseSensitive ? term : term.toLowerCase();

  if (!entry.wholeWord) {
    return haystack.includes(needle);
  }

  return new RegExp(`(^|\\W)${escapeRegExp(needle)}($|\\W)`, entry.caseSensitive ? "" : "i").test(scanText.raw);
}

function probabilityAllows(entry: LoreTriggerEntry): boolean {
  if (entry.probability >= 100) {
    return true;
  }

  const stableRoll = hashString(`${entry.id}:${entry.title}`) % 100;
  return stableRoll < entry.probability;
}

function applyLorebookBudget<Entry extends LoreTriggerEntry>(entries: Entry[], tokenBudget: number): Entry[] {
  const sortedEntries = [...entries].sort(compareLorebookEntries);
  const included: Entry[] = [];
  let usedTokens = 0;

  for (const entry of sortedEntries) {
    const entryTokens = estimateRoughTokens(entry.content);
    if (usedTokens + entryTokens > tokenBudget) {
      continue;
    }

    included.push(entry);
    usedTokens += entryTokens;
  }

  return included;
}

function compareLorebookEntries(left: LoreTriggerEntry, right: LoreTriggerEntry): number {
  return right.priority - left.priority || left.insertionOrder - right.insertionOrder || left.title.localeCompare(right.title);
}

function uniqueLorebookEntries<Entry extends LoreTriggerEntry>(entries: Entry[]): Entry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) {
      return false;
    }
    seen.add(entry.id);
    return true;
  });
}

function estimateRoughTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
