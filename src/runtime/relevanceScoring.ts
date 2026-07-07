const STOP_WORDS = new Set([
  "a", "an", "and", "as", "at", "in", "into", "of", "on", "or", "the", "to", "with",
  "is", "are", "was", "were", "be", "been", "for", "from", "that", "this", "it",
  "his", "her", "their", "they", "them", "you", "your", "she", "he", "we", "our",
]);

/**
 * Joins scene-defining fragments (recent messages, the pending action, current
 * location/quests) into a single haystack the scorer matches candidates against.
 */
export function buildSceneText(parts: ReadonlyArray<string | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(" ");
}

function meaningfulTokens(value: string): string[] {
  return normalize(value)
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Number of distinct meaningful tokens a candidate shares with the scene. */
export function relevanceScore(candidateText: string, sceneTokens: ReadonlySet<string>): number {
  if (sceneTokens.size === 0) {
    return 0;
  }
  let matched = 0;
  const counted = new Set<string>();
  for (const token of meaningfulTokens(candidateText)) {
    if (counted.has(token)) {
      continue;
    }
    counted.add(token);
    if (sceneTokens.has(token)) {
      matched += 1;
    }
  }
  return matched;
}

/**
 * Orders items scene-relevant first, then newest first for equal scores, so
 * that when the prompt compiler trims a layer from the end the entries most
 * useful to the current scene survive. Reading order is not meaningful for the
 * bulleted fact lists this is used on. Input is assumed oldest-to-newest.
 */
export function orderByRelevance<T>(
  items: readonly T[],
  getText: (item: T) => string,
  sceneText: string,
): T[] {
  const sceneTokens = new Set(meaningfulTokens(sceneText));
  return items
    .map((item, index) => ({ item, index, score: relevanceScore(getText(item), sceneTokens) }))
    .sort((left, right) => right.score - left.score || right.index - left.index)
    .map((entry) => entry.item);
}

/**
 * Returns the subset of names that appear in the current scene. Biased toward
 * inclusion: a false positive only adds detail, while a false negative would
 * drop a present character's knowledge boundary and risk a leak.
 */
export function selectPresentNames(names: readonly string[], sceneText: string): Set<string> {
  const haystack = ` ${normalize(sceneText)} `;
  const present = new Set<string>();
  if (haystack.trim().length === 0) {
    return present;
  }
  for (const name of names) {
    const normalizedName = normalize(name);
    if (!normalizedName) {
      continue;
    }
    if (haystack.includes(` ${normalizedName} `)) {
      present.add(name);
      continue;
    }
    const distinctiveToken = meaningfulTokens(name).find(
      (token) => token.length > 4 && haystack.includes(` ${token} `),
    );
    if (distinctiveToken) {
      present.add(name);
    }
  }
  return present;
}
