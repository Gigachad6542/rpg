import { testRegexInWorker, type LoreRegexTest } from "./loreRegexIsolation";

export const LORE_MATCH_MODES = ["literal", "wildcard", "regex"] as const;
export const LORE_LITERAL_MATCH_BEHAVIORS = ["boundary", "substring"] as const;

/** How an entry's keys are compared against the scanned text. */
export type LoreMatchMode = (typeof LORE_MATCH_MODES)[number];
export type LoreLiteralMatchBehavior = (typeof LORE_LITERAL_MATCH_BEHAVIORS)[number];

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
const BROAD_LITERAL_KEYS = new Set([
  "a", "an", "and", "ask", "at", "do", "get", "go", "he", "her", "him", "i", "in", "it", "look",
  "me", "my", "of", "on", "or", "say", "see", "she", "take", "the", "they", "thing", "to", "use", "we", "you",
]);

export interface LoreTriggerEntry {
  id: string;
  title: string;
  keys: string[];
  aliases?: string[];
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
  /** `substring` is an explicit legacy compatibility escape hatch. */
  literalMatchBehavior?: LoreLiteralMatchBehavior;
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

export interface SafeLoreSelectionOptions {
  regexTest?: LoreRegexTest;
  timeoutMs?: number;
}

export interface SafeLoreSelectionResult<Entry extends LoreTriggerEntry = LoreTriggerEntry> {
  entries: Entry[];
  disabledEntryIds: string[];
}

export interface LoreTermMatch {
  source: "key" | "alias" | "secondary" | "constant";
  term: string;
  matchMode: LoreMatchMode;
  literalMatchBehavior?: LoreLiteralMatchBehavior;
}

export interface LoreTriggerProvenance {
  bookId: string;
  entryId: string;
  scanScopes: readonly LoreScanScope[];
  primary: LoreTermMatch;
  secondary?: LoreTermMatch;
  reason: string;
}

export interface LoreSelectionWithProvenance<Entry extends LoreTriggerEntry = LoreTriggerEntry> {
  entries: Entry[];
  triggers: LoreTriggerProvenance[];
}

export function selectActiveLorebookEntries<Entry extends LoreTriggerEntry>(
  input: SelectLorebookEntriesInput<Entry>,
): Entry[] {
  return selectLorebookEntriesWithProvenance(input).entries;
}

export function selectLorebookEntriesWithProvenance<Entry extends LoreTriggerEntry>(
  input: SelectLorebookEntriesInput<Entry>,
): LoreSelectionWithProvenance<Entry> {
  const activeEntries: Entry[] = [];
  const provenance = new Map<string, LoreTriggerProvenance>();

  for (const lorebook of input.lorebooks) {
    if (!lorebook.enabled) {
      continue;
    }

    const scanText = createScanTextResolver(input, lorebook.scanDepth);
    let triggered = lorebook.entries
      .map((entry) => ({ entry, match: matchLorebookEntry(entry, scanText(entry), lorebook.id) }))
      .filter((result): result is { entry: Entry; match: LoreTriggerProvenance } => result.match !== null);

    if (lorebook.recursiveScanning && triggered.length > 0) {
      const triggeredContent = triggered.map(({ entry }) => entry.content).join("\n");
      const recursive = lorebook.entries
        .map((entry) => ({ entry, match: matchLorebookEntry(entry, scanText(entry, triggeredContent), lorebook.id) }))
        .filter((result): result is { entry: Entry; match: LoreTriggerProvenance } => result.match !== null);
      triggered = uniqueLoreMatches([...triggered, ...recursive]);
    }

    const included = applyLorebookBudget(triggered.map(({ entry }) => entry), lorebook.tokenBudget);
    activeEntries.push(...included);
    for (const entry of included) {
      const match = triggered.find((result) => result.entry.id === entry.id)?.match;
      if (match && !provenance.has(entry.id)) {
        provenance.set(entry.id, match);
      }
    }
  }

  const entries = uniqueLorebookEntries(activeEntries).sort(compareLorebookEntries);
  return {
    entries,
    triggers: entries.flatMap((entry) => provenance.get(entry.id) ?? []),
  };
}

/**
 * Synchronous prompt previews never execute imported regex on the UI thread.
 * Literal and wildcard entries remain available immediately; regex entries are
 * evaluated only by `selectActiveLorebookEntriesSafely` during turn execution.
 */
export function selectActiveLorebookEntriesForPreview<Entry extends LoreTriggerEntry>(
  input: SelectLorebookEntriesInput<Entry>,
): Entry[] {
  return selectLorebookEntriesWithProvenanceForPreview(input).entries;
}

export function selectLorebookEntriesWithProvenanceForPreview<Entry extends LoreTriggerEntry>(
  input: SelectLorebookEntriesInput<Entry>,
): LoreSelectionWithProvenance<Entry> {
  return selectLorebookEntriesWithProvenance({
    ...input,
    lorebooks: input.lorebooks.map((lorebook) => ({
      ...lorebook,
      entries: lorebook.entries.map((entry) =>
        entry.matchMode === "regex" ? ({ ...entry, enabled: false } as Entry) : entry,
      ),
    })),
  });
}

/** Evaluates regex entries off-thread with a per-test deadline and reports offenders. */
export async function selectActiveLorebookEntriesSafely<Entry extends LoreTriggerEntry>(
  input: SelectLorebookEntriesInput<Entry>,
  options: SafeLoreSelectionOptions = {},
): Promise<SafeLoreSelectionResult<Entry>> {
  const activeEntries: Entry[] = [];
  const disabledEntryIds = new Set<string>();
  const regexTest = options.regexTest ?? testRegexInWorker;
  const timeoutMs = Math.max(1, Math.min(1_000, Math.trunc(options.timeoutMs ?? 50)));

  for (const lorebook of input.lorebooks) {
    if (!lorebook.enabled) {
      continue;
    }

    const scanText = createScanTextResolver(input, lorebook.scanDepth);
    let triggeredEntries = await filterLorebookEntriesSafely(
      lorebook.entries,
      (entry) => scanText(entry),
      regexTest,
      timeoutMs,
      disabledEntryIds,
    );
    if (lorebook.recursiveScanning && triggeredEntries.length > 0) {
      const triggeredContent = triggeredEntries.map((entry) => entry.content).join("\n");
      const recursiveEntries = await filterLorebookEntriesSafely(
        lorebook.entries,
        (entry) => scanText(entry, triggeredContent),
        regexTest,
        timeoutMs,
        disabledEntryIds,
      );
      triggeredEntries = uniqueLorebookEntries([...triggeredEntries, ...recursiveEntries]);
    }
    activeEntries.push(...applyLorebookBudget(triggeredEntries, lorebook.tokenBudget));
  }

  return {
    entries: uniqueLorebookEntries(activeEntries).sort(compareLorebookEntries),
    disabledEntryIds: [...disabledEntryIds],
  };
}

async function filterLorebookEntriesSafely<Entry extends LoreTriggerEntry>(
  entries: Entry[],
  scanText: (entry: Entry) => NormalizedScanText,
  regexTest: LoreRegexTest,
  timeoutMs: number,
  disabledEntryIds: Set<string>,
): Promise<Entry[]> {
  const decisions = await Promise.all(
    entries.map(async (entry) => ({
      entry,
      active: await isLorebookEntryActiveSafely(
        entry,
        scanText(entry),
        regexTest,
        timeoutMs,
        disabledEntryIds,
      ),
    })),
  );
  return decisions.filter((decision) => decision.active).map((decision) => decision.entry);
}

async function isLorebookEntryActiveSafely(
  entry: LoreTriggerEntry,
  scanText: NormalizedScanText,
  regexTest: LoreRegexTest,
  timeoutMs: number,
  disabledEntryIds: Set<string>,
): Promise<boolean> {
  if ((entry.matchMode ?? "literal") !== "regex") {
    return isLorebookEntryActive(entry, scanText);
  }
  if (!entry.enabled || entry.probability <= 0) {
    return false;
  }
  if (entry.constant) {
    return probabilityAllows(entry);
  }

  const primary = await regexTermsMatchSafely(
    [...entry.keys, ...(entry.aliases ?? [])],
    entry,
    scanText.raw,
    regexTest,
    timeoutMs,
    disabledEntryIds,
  );
  if (!primary || disabledEntryIds.has(entry.id)) {
    return false;
  }
  const secondary =
    entry.secondaryKeys.length === 0 ||
    (await regexTermsMatchSafely(
      entry.secondaryKeys,
      entry,
      scanText.raw,
      regexTest,
      timeoutMs,
      disabledEntryIds,
    ));
  return secondary && !disabledEntryIds.has(entry.id) && probabilityAllows(entry);
}

async function regexTermsMatchSafely(
  terms: readonly string[],
  entry: LoreTriggerEntry,
  text: string,
  regexTest: LoreRegexTest,
  timeoutMs: number,
  disabledEntryIds: Set<string>,
): Promise<boolean> {
  for (const rawTerm of terms) {
    const term = rawTerm.trim();
    if (!term || term.length > MAX_LORE_PATTERN_LENGTH) {
      continue;
    }
    try {
      const matched = await withDeadline(
        regexTest(term, entry.caseSensitive ? "" : "i", text, timeoutMs),
        timeoutMs,
      );
      if (matched) {
        return true;
      }
    } catch {
      disabledEntryIds.add(entry.id);
      return false;
    }
  }
  return false;
}

function withDeadline<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new Error("Lore regex timed out.")), timeoutMs);
    operation.then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        globalThis.clearTimeout(timer);
        reject(error);
      },
    );
  });
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

export function parseLoreLiteralMatchBehavior(value: unknown): LoreLiteralMatchBehavior | undefined {
  return LORE_LITERAL_MATCH_BEHAVIORS.includes(value as LoreLiteralMatchBehavior)
    ? value as LoreLiteralMatchBehavior
    : undefined;
}

export function getLoreKeyWarnings(
  entry: Pick<LoreTriggerEntry, "keys" | "secondaryKeys"> & Partial<LoreTriggerEntry>,
): string[] {
  if ((entry.matchMode ?? "literal") !== "literal") {
    return [];
  }
  if (entry.literalMatchBehavior === "substring") {
    return ["Substring compatibility can activate inside unrelated words; use boundary matching when possible."];
  }
  const broadTerms = [...entry.keys, ...(entry.aliases ?? [])].filter(isBroadLiteralKey);
  if (broadTerms.length > 0 && entry.secondaryKeys.length === 0) {
    return [`Broad key "${truncateForMessage(broadTerms[0])}" requires a secondary key to avoid unrelated activations.`];
  }
  return [];
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
  return matchLorebookEntry(entry, scanText, "unknown") !== null;
}

function matchLorebookEntry(
  entry: LoreTriggerEntry,
  scanText: NormalizedScanText,
  bookId: string,
): LoreTriggerProvenance | null {
  if (!entry.enabled || entry.probability <= 0) {
    return null;
  }

  if (entry.constant) {
    return probabilityAllows(entry)
      ? {
          bookId,
          entryId: entry.id,
          scanScopes: getLoreScanScopes(entry),
          primary: { source: "constant", term: "constant", matchMode: "literal" },
          reason: "Triggered because the entry is constant.",
        }
      : null;
  }

  const primary = findTermMatch(scanText, entry.keys, entry, "key")
    ?? findTermMatch(scanText, entry.aliases ?? [], entry, "alias");
  if (!primary || !probabilityAllows(entry)) {
    return null;
  }

  const secondary = findTermMatch(scanText, entry.secondaryKeys, entry, "secondary");
  const requiresSecondary = entry.secondaryKeys.length > 0 ||
    (entry.literalMatchBehavior !== "substring" && isBroadLiteralKey(primary.term));
  if (requiresSecondary && !secondary) {
    return null;
  }

  const secondaryReason = secondary ? ` and secondary key "${secondary.term}"` : "";
  return {
    bookId,
    entryId: entry.id,
    scanScopes: getLoreScanScopes(entry),
    primary,
    ...(secondary ? { secondary } : {}),
    reason: `Triggered because ${primary.source} "${primary.term}" matched${secondaryReason}.`,
  };
}

function findTermMatch(
  scanText: NormalizedScanText,
  terms: readonly string[],
  entry: LoreTriggerEntry,
  source: LoreTermMatch["source"],
): LoreTermMatch | undefined {
  const term = terms.find((candidate) => termMatches(scanText, candidate, entry))?.trim();
  return term
    ? {
        source,
        term,
        matchMode: entry.matchMode ?? "literal",
        ...((entry.matchMode ?? "literal") === "literal"
          ? { literalMatchBehavior: entry.literalMatchBehavior ?? "boundary" }
          : {}),
      }
    : undefined;
}

function termMatches(scanText: NormalizedScanText, rawTerm: string, entry: LoreTriggerEntry): boolean {
  const term = rawTerm.trim();
  if (!term) {
    return false;
  }

  const matchMode = entry.matchMode ?? "literal";
  const caseSensitive = entry.caseSensitive === true;

  if (matchMode === "literal" && !entry.wholeWord && entry.literalMatchBehavior === "substring") {
    return (caseSensitive ? scanText.raw : scanText.lower).includes(caseSensitive ? term : term.toLowerCase());
  }

  const pattern = compileTermPattern(
    term,
    matchMode,
    caseSensitive,
    entry.wholeWord === true || matchMode === "literal",
  );
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
      source = `(^|[^\\p{L}\\p{N}_])${source}(?=$|[^\\p{L}\\p{N}_])`;
    }
  }

  const unicodeBoundary = wholeWord && matchMode !== "regex";
  return getCachedRegExp(source, `${caseSensitive ? "" : "i"}${unicodeBoundary ? "u" : ""}`);
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

function uniqueLoreMatches<Entry extends LoreTriggerEntry>(
  matches: Array<{ entry: Entry; match: LoreTriggerProvenance }>,
): Array<{ entry: Entry; match: LoreTriggerProvenance }> {
  const seen = new Set<string>();
  return matches.filter(({ entry }) => {
    if (seen.has(entry.id)) {
      return false;
    }
    seen.add(entry.id);
    return true;
  });
}

function isBroadLiteralKey(value: string): boolean {
  const normalized = value.toLowerCase().trim();
  return BROAD_LITERAL_KEYS.has(normalized) || /^[\p{L}\p{N}_]{1,2}$/u.test(normalized);
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
