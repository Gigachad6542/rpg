export const LORE_MATCH_MODES = ["literal", "wildcard", "regex"] as const;

/** How an entry's keys are compared against the scanned text. */
export type LoreMatchMode = (typeof LORE_MATCH_MODES)[number];

export const LORE_SCAN_SCOPES = ["history", "draft", "card", "persona", "memory", "rpg"] as const;

/** Which text sources an entry's keys are scanned against. */
export type LoreScanScope = (typeof LORE_SCAN_SCOPES)[number];

/**
 * The scopes an entry scans when it does not name its own. This is the set the
 * engine scanned before scopes existed, so untouched entries keep their behavior.
 */
export const DEFAULT_LORE_SCAN_SCOPES: readonly LoreScanScope[] = ["history", "draft", "rpg"];

/**
 * Keys in `wildcard` and `regex` mode are compiled into a RegExp. Lorebooks
 * arrive from untrusted places (imported Tavern PNGs, Chub URLs) and matching
 * runs on every keystroke, so a catastrophic pattern would freeze the UI. These
 * caps plus `isCatastrophicPattern` keep a hostile pattern from backtracking
 * forever; a rejected pattern simply never matches.
 */
const MAX_LORE_PATTERN_LENGTH = 200;
const MAX_LORE_SCAN_LENGTH = 20_000;
const MAX_COMPILED_PATTERN_CACHE = 500;

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
  matchMode?: LoreMatchMode;
  scanScopes?: LoreScanScope[];
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

/** Text for the non-chat scan scopes. Omitted sources simply never match. */
export interface LoreTriggerSources {
  cardDefinition?: string;
  personaDescription?: string;
  memoryEntries?: string[];
}

export interface SelectLorebookEntriesInput<Entry extends LoreTriggerEntry = LoreTriggerEntry> {
  lorebooks: LoreTriggerBook<Entry>[];
  messages: LoreTriggerMessage[];
  draft: string;
  context?: LoreTriggerContext;
  sources?: LoreTriggerSources;
}

export function selectActiveLorebookEntries<Entry extends LoreTriggerEntry>(
  input: SelectLorebookEntriesInput<Entry>,
): Entry[] {
  const activeEntries: Entry[] = [];

  for (const lorebook of input.lorebooks) {
    if (!lorebook.enabled) {
      continue;
    }

    const scanText = createScanTextResolver(input, lorebook.scanDepth);
    let triggeredEntries = lorebook.entries.filter((entry) => isLorebookEntryActive(entry, scanText(entry)));

    if (lorebook.recursiveScanning && triggeredEntries.length > 0) {
      const triggeredContent = triggeredEntries.map((entry) => entry.content).join("\n");
      triggeredEntries = uniqueLorebookEntries([
        ...triggeredEntries,
        ...lorebook.entries.filter((entry) => isLorebookEntryActive(entry, scanText(entry, triggeredContent))),
      ]);
    }

    activeEntries.push(...applyLorebookBudget(triggeredEntries, lorebook.tokenBudget));
  }

  return uniqueLorebookEntries(activeEntries).sort(compareLorebookEntries);
}

/** Reports why a key cannot be compiled, so the editor can reject it before saving. */
export function validateLoreKeys(keys: readonly string[], matchMode: LoreMatchMode): string | null {
  for (const key of keys) {
    const error = validateLoreKey(key, matchMode);
    if (error) {
      return error;
    }
  }
  return null;
}

export function validateLoreKey(rawKey: string, matchMode: LoreMatchMode): string | null {
  const key = rawKey.trim();
  if (!key || matchMode === "literal") {
    return null;
  }
  if (key.length > MAX_LORE_PATTERN_LENGTH) {
    return `Key "${truncateForMessage(key)}" is longer than ${MAX_LORE_PATTERN_LENGTH} characters.`;
  }
  if (matchMode === "wildcard") {
    return null;
  }
  if (isCatastrophicPattern(key)) {
    return `Regex "${truncateForMessage(key)}" nests a quantifier and can hang the app.`;
  }
  try {
    new RegExp(key);
  } catch (error) {
    return `Regex "${truncateForMessage(key)}" is invalid: ${error instanceof Error ? error.message : "unknown error"}`;
  }
  return null;
}

export function parseLoreMatchMode(value: unknown): LoreMatchMode {
  return LORE_MATCH_MODES.includes(value as LoreMatchMode) ? (value as LoreMatchMode) : "literal";
}

/** Returns `undefined` when nothing usable is stored, meaning "use the default scopes". */
export function parseLoreScanScopes(value: unknown): LoreScanScope[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const scopes = LORE_SCAN_SCOPES.filter((scope) => value.includes(scope));
  return scopes.length > 0 ? [...scopes] : undefined;
}

export function getLoreScanScopes(entry: LoreTriggerEntry): readonly LoreScanScope[] {
  return entry.scanScopes && entry.scanScopes.length > 0 ? entry.scanScopes : DEFAULT_LORE_SCAN_SCOPES;
}

type ScanTextResolver = (entry: LoreTriggerEntry, extraText?: string) => NormalizedScanText;

/**
 * Builds each scope's text once per lorebook, then assembles (and memoizes) the
 * slice an entry actually scans. Entries sharing a scope set share the work.
 */
function createScanTextResolver(input: SelectLorebookEntriesInput, scanDepth: number): ScanTextResolver {
  const scopeTexts: Record<LoreScanScope, string> = {
    history: input.messages
      .slice(-Math.max(1, scanDepth))
      .map((message) => message.content)
      .join("\n"),
    draft: input.draft,
    card: input.sources?.cardDefinition ?? "",
    persona: input.sources?.personaDescription ?? "",
    memory: (input.sources?.memoryEntries ?? []).join("\n"),
    rpg: formatContextText(input.context),
  };
  const cache = new Map<string, NormalizedScanText>();

  return (entry, extraText = "") => {
    const scopes = getLoreScanScopes(entry);
    const cacheKey = `${scopes.join(",")}|${extraText ? "recursive" : "base"}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const raw = [...scopes.map((scope) => scopeTexts[scope]), extraText].filter(Boolean).join("\n");
    const normalized = normalizeScanText(raw);
    cache.set(cacheKey, normalized);
    return normalized;
  };
}

function formatContextText(context?: LoreTriggerContext): string {
  return [
    context?.currentLocation ? `location: ${context.currentLocation}` : "",
    context?.activeQuests?.length ? `active quests: ${context.activeQuests.join(", ")}` : "",
    context?.inventory?.length ? `inventory: ${context.inventory.join(", ")}` : "",
    context?.worldFlags
      ? `world flags: ${Object.entries(context.worldFlags).map(([key, value]) => `${key}=${value}`).join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

interface NormalizedScanText {
  raw: string;
  lower: string;
}

function normalizeScanText(raw: string): NormalizedScanText {
  const bounded = raw.length > MAX_LORE_SCAN_LENGTH ? raw.slice(-MAX_LORE_SCAN_LENGTH) : raw;
  return {
    raw: bounded,
    lower: bounded.toLowerCase(),
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

  const matchMode = entry.matchMode ?? "literal";
  const caseSensitive = entry.caseSensitive === true;

  if (matchMode === "literal" && !entry.wholeWord) {
    return (caseSensitive ? scanText.raw : scanText.lower).includes(caseSensitive ? term : term.toLowerCase());
  }

  const pattern = compileTermPattern(term, matchMode, caseSensitive, entry.wholeWord === true);
  return pattern ? pattern.test(scanText.raw) : false;
}

function compileTermPattern(
  term: string,
  matchMode: LoreMatchMode,
  caseSensitive: boolean,
  wholeWord: boolean,
): RegExp | null {
  if (term.length > MAX_LORE_PATTERN_LENGTH) {
    return null;
  }

  let source: string;
  if (matchMode === "regex") {
    if (isCatastrophicPattern(term)) {
      return null;
    }
    source = term;
  } else {
    source = matchMode === "wildcard" ? wildcardToRegexSource(term) : escapeRegExp(term);
    if (wholeWord) {
      source = `(^|\\W)${source}($|\\W)`;
    }
  }

  return getCachedRegExp(source, caseSensitive ? "" : "i");
}

function wildcardToRegexSource(term: string): string {
  return term
    .split(/(\*|\?)/)
    .map((part) => (part === "*" ? "[\\s\\S]*?" : part === "?" ? "[\\s\\S]" : escapeRegExp(part)))
    .join("");
}

const compiledPatternCache = new Map<string, RegExp | null>();

function getCachedRegExp(source: string, flags: string): RegExp | null {
  const cacheKey = `${flags} ${source}`;
  const cached = compiledPatternCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  let compiled: RegExp | null;
  try {
    compiled = new RegExp(source, flags);
  } catch {
    compiled = null;
  }

  if (compiledPatternCache.size >= MAX_COMPILED_PATTERN_CACHE) {
    compiledPatternCache.clear();
  }
  compiledPatternCache.set(cacheKey, compiled);
  return compiled;
}

/**
 * Rejects the classic exponential-backtracking shapes: a quantifier applied to a
 * group that itself contains a quantifier or an alternation, e.g. `(a+)+`,
 * `(?:a*)*`, `(a|a)*`. This is a heuristic, not a proof of safety, which is why
 * the scanned text is length-capped as well.
 */
function isCatastrophicPattern(pattern: string): boolean {
  const quantifiedGroup = /\((?:\?[:=!<]*)?[^()]*[*+][^()]*\)\s*[*+{]/;
  const quantifiedAlternation = /\((?:\?[:=!<]*)?[^()]*\|[^()]*\)\s*[*+{]/;
  return quantifiedGroup.test(pattern) || quantifiedAlternation.test(pattern);
}

function truncateForMessage(value: string): string {
  return value.length > 40 ? `${value.slice(0, 40)}...` : value;
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
