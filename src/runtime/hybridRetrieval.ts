export const HYBRID_RETRIEVAL_SOURCES = [
  "memory",
  "lore",
  "rolling-summary",
  "event",
  "dialogue-example",
] as const;

export type HybridRetrievalSource = (typeof HYBRID_RETRIEVAL_SOURCES)[number];

export const HYBRID_RETRIEVAL_VISIBILITIES = [
  "narrator",
  "player-visible",
  "character-private",
] as const;

export type HybridRetrievalVisibility = (typeof HYBRID_RETRIEVAL_VISIBILITIES)[number];

export type HybridRetrievalScopeLevel = "card-global" | "chat" | "branch";

export interface RetrievalProvenance {
  readonly level: HybridRetrievalScopeLevel;
  readonly chatId?: string;
  readonly branchId?: string;
}

export function parseRetrievalProvenance(value: unknown): RetrievalProvenance | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.level === "card-global") {
    return { level: "card-global" };
  }
  if (candidate.level === "chat" && typeof candidate.chatId === "string" && candidate.chatId.trim()) {
    return { level: "chat", chatId: candidate.chatId };
  }
  if (
    candidate.level === "branch" &&
    typeof candidate.chatId === "string" &&
    candidate.chatId.trim() &&
    typeof candidate.branchId === "string" &&
    candidate.branchId.trim()
  ) {
    return { level: "branch", chatId: candidate.chatId, branchId: candidate.branchId };
  }
  return undefined;
}

export interface HybridRetrievalDocument {
  readonly id: string;
  readonly text: string;
  readonly cardId: string;
  readonly chatId?: string;
  readonly branchId?: string;
  /** Legacy documents with both IDs are interpreted as branch-scoped. */
  readonly scopeLevel?: HybridRetrievalScopeLevel;
  readonly source: HybridRetrievalSource;
  readonly visibility: HybridRetrievalVisibility;
  readonly priority?: number;
}

export interface HybridRetrievalScope {
  readonly cardId: string;
  readonly chatId: string;
  readonly branchId: string;
  readonly allowedSources: readonly HybridRetrievalSource[];
  readonly allowedVisibilities: readonly HybridRetrievalVisibility[];
}

export interface HybridRetrievalRequest {
  readonly query: string;
  readonly documents: readonly HybridRetrievalDocument[];
  readonly scope: HybridRetrievalScope;
  readonly limit: number;
  readonly minimumScore?: number;
  readonly sourceLimits?: Partial<Record<HybridRetrievalSource, number>>;
  readonly maxCharacters?: number;
}

export interface HybridRetrievalResult {
  readonly document: HybridRetrievalDocument;
  readonly lexicalScore: number;
  readonly semanticScore: number;
  readonly score: number;
}

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "by", "for", "from",
  "has", "have", "he", "her", "hers", "him", "his", "i", "in", "into", "is",
  "it", "its", "me", "my", "of", "on", "or", "our", "ours", "she", "that",
  "the", "their", "theirs", "them", "they", "this", "to", "was", "we", "were",
  "with", "you", "your", "yours",
]);

/**
 * A deliberately small, local concept lexicon. It improves recall for common
 * RPG language without an embedding download, network request, or third model
 * call. Unknown words still participate through deterministic feature hashing.
 */
const SEMANTIC_CANONICAL_FORMS: Readonly<Record<string, string>> = {
  doctor: "medicine-practitioner",
  healer: "medicine-practitioner",
  medic: "medicine-practitioner",
  physician: "medicine-practitioner",
  heal: "medical-treatment",
  heals: "medical-treatment",
  healed: "medical-treatment",
  healing: "medical-treatment",
  tend: "medical-treatment",
  tends: "medical-treatment",
  tended: "medical-treatment",
  treat: "medical-treatment",
  treats: "medical-treatment",
  treated: "medical-treatment",
  injury: "bodily-injury",
  injuries: "bodily-injury",
  wound: "bodily-injury",
  wounds: "bodily-injury",
  wounded: "bodily-injury",
  door: "entrance",
  doorway: "entrance",
  gate: "entrance",
  gateway: "entrance",
  entrance: "entrance",
  exit: "entrance",
  sword: "bladed-weapon",
  blade: "bladed-weapon",
  dagger: "bladed-weapon",
  knife: "bladed-weapon",
  coin: "currency",
  coins: "currency",
  gold: "currency",
  money: "currency",
};

const SEMANTIC_VECTOR_DIMENSIONS = 256;
const LEXICAL_WEIGHT = 0.5;
const SEMANTIC_WEIGHT = 0.35;
const PRIORITY_WEIGHT = 0.15;

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function meaningfulTokens(value: string): string[] {
  const normalized = normalize(value);
  if (!normalized) {
    return [];
  }
  return normalized
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function uniqueTokens(value: string): Set<string> {
  return new Set(meaningfulTokens(value));
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function semanticFeatures(value: string): string[] {
  return meaningfulTokens(value).map((token) => SEMANTIC_CANONICAL_FORMS[token] ?? token);
}

/**
 * Produces a normalized, fixed-size vector using local deterministic feature
 * hashing. This function is synchronous and has no provider/model dependency.
 */
export function buildLocalSemanticVector(value: string): number[] {
  const vector = new Array<number>(SEMANTIC_VECTOR_DIMENSIONS).fill(0);
  for (const feature of semanticFeatures(value)) {
    vector[fnv1a(feature) % SEMANTIC_VECTOR_DIMENSIONS] += 1;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, component) => sum + component * component, 0));
  if (magnitude === 0) {
    return vector;
  }
  return vector.map((component) => component / magnitude);
}

function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  let score = 0;
  for (let index = 0; index < left.length; index += 1) {
    score += left[index] * (right[index] ?? 0);
  }
  return Math.max(0, Math.min(1, score));
}

function lexicalSimilarity(query: ReadonlySet<string>, documentText: string): number {
  if (query.size === 0) {
    return 0;
  }
  const documentTokens = uniqueTokens(documentText);
  let intersection = 0;
  for (const token of query) {
    if (documentTokens.has(token)) {
      intersection += 1;
    }
  }
  return intersection / query.size;
}

function assertCompleteScope(scope: HybridRetrievalScope): void {
  if (
    !scope ||
    typeof scope.cardId !== "string" ||
    !scope.cardId.trim() ||
    typeof scope.chatId !== "string" ||
    !scope.chatId.trim() ||
    typeof scope.branchId !== "string" ||
    !scope.branchId.trim() ||
    !Array.isArray(scope.allowedSources) ||
    scope.allowedSources.length === 0 ||
    !Array.isArray(scope.allowedVisibilities) ||
    scope.allowedVisibilities.length === 0
  ) {
    throw new Error(
      "Hybrid retrieval requires complete card, chat, branch, source, and visibility scope boundaries.",
    );
  }
}

function isInScope(document: HybridRetrievalDocument, scope: HybridRetrievalScope): boolean {
  if (
    document.cardId !== scope.cardId ||
    !scope.allowedSources.includes(document.source) ||
    !scope.allowedVisibilities.includes(document.visibility)
  ) {
    return false;
  }
  const level = document.scopeLevel ?? (document.branchId ? "branch" : document.chatId ? "chat" : "card-global");
  if (level === "card-global") {
    return true;
  }
  if (level === "chat") {
    return document.chatId === scope.chatId;
  }
  return document.chatId === scope.chatId && document.branchId === scope.branchId;
}

function normalizePriority(priority: number | undefined): number {
  if (typeof priority !== "number" || !Number.isFinite(priority)) {
    return 0;
  }
  return Math.max(0, Math.min(1, priority / 100));
}

/**
 * Filters by authority scope before scoring, then fuses exact lexical overlap
 * with a bounded local semantic score. Scope is never softened for recall.
 */
export function retrieveScopedHybrid(request: HybridRetrievalRequest): HybridRetrievalResult[] {
  assertCompleteScope(request.scope);
  const trimmedQuery = request.query.trim();
  if (!trimmedQuery || !Number.isFinite(request.limit) || request.limit <= 0) {
    return [];
  }

  const queryTokens = uniqueTokens(trimmedQuery);
  const queryVector = buildLocalSemanticVector(trimmedQuery);
  const ranked = request.documents
    .filter((document) => isInScope(document, request.scope))
    .map((document, index) => {
      const lexicalScore = lexicalSimilarity(queryTokens, document.text);
      const semanticScore = cosineSimilarity(queryVector, buildLocalSemanticVector(document.text));
      const priorityScore = normalizePriority(document.priority);
      return {
        index,
        result: {
          document,
          lexicalScore,
          semanticScore,
          score:
            lexicalScore * LEXICAL_WEIGHT +
            semanticScore * SEMANTIC_WEIGHT +
            priorityScore * PRIORITY_WEIGHT,
        },
      };
    })
    .sort(
      (left, right) =>
        right.result.score - left.result.score ||
        right.result.lexicalScore - left.result.lexicalScore ||
        right.result.semanticScore - left.result.semanticScore ||
        left.index - right.index,
    )
    .map(({ result }) => result);

  const minimumScore = typeof request.minimumScore === "number" && Number.isFinite(request.minimumScore)
    ? Math.max(0, request.minimumScore)
    : 0;
  const maximumCharacters = typeof request.maxCharacters === "number" && Number.isFinite(request.maxCharacters)
    ? Math.max(0, Math.trunc(request.maxCharacters))
    : Number.POSITIVE_INFINITY;
  const sourceCounts = new Map<HybridRetrievalSource, number>();
  const selected: HybridRetrievalResult[] = [];
  let selectedCharacters = 0;
  for (const result of ranked) {
    if (result.score < minimumScore || selected.length >= Math.trunc(request.limit)) {
      continue;
    }
    const sourceLimit = request.sourceLimits?.[result.document.source];
    const normalizedSourceLimit = typeof sourceLimit === "number" && Number.isFinite(sourceLimit)
      ? Math.max(0, Math.trunc(sourceLimit))
      : Number.POSITIVE_INFINITY;
    const sourceCount = sourceCounts.get(result.document.source) ?? 0;
    if (sourceCount >= normalizedSourceLimit || selectedCharacters + result.document.text.length > maximumCharacters) {
      continue;
    }
    selected.push(result);
    selectedCharacters += result.document.text.length;
    sourceCounts.set(result.document.source, sourceCount + 1);
  }
  return selected;
}
