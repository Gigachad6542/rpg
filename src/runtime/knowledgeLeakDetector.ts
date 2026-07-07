import type { StoryEntity } from "./hiddenContinuity";

export interface KnowledgeLeakFinding {
  entityName: string;
  fact: string;
  quote: string;
}

const STOP_WORDS = new Set([
  "a", "an", "and", "as", "at", "in", "into", "of", "on", "or", "the", "to", "with",
  "does", "not", "know", "knows", "knew", "known", "that", "about", "is", "are",
  "was", "were", "his", "her", "their", "they", "them", "this", "for", "from",
]);

const MIN_MATCH_TOKENS = 3;
const MATCH_RATIO = 0.75;

/**
 * Heuristically detects whether a character spoke or acted on a fact their
 * ledger marks as unknown to them. This turns the knowledge-boundary rule from
 * an instruction the model may ignore into a check the app can surface. It is
 * deliberately conservative: it only flags when a strong majority of a fact's
 * meaningful tokens appear near the character's own dialogue or action.
 */
export function detectKnowledgeLeaks(
  assistantText: string,
  entities: readonly StoryEntity[],
): KnowledgeLeakFinding[] {
  const findings: KnowledgeLeakFinding[] = [];
  const segments = splitAttributedSegments(assistantText);
  if (segments.length === 0) {
    return findings;
  }

  for (const entity of entities) {
    if (entity.kind === "player" || entity.doesNotKnow.length === 0) {
      continue;
    }
    const entitySegments = segments.filter((segment) => mentionsEntity(segment, entity.name));
    if (entitySegments.length === 0) {
      continue;
    }
    for (const fact of entity.doesNotKnow) {
      const factTokens = meaningfulTokens(fact, entity.name);
      if (factTokens.length < MIN_MATCH_TOKENS) {
        continue;
      }
      const leaked = entitySegments.find((segment) => segmentExpressesFact(segment, factTokens));
      if (leaked) {
        findings.push({ entityName: entity.name, fact, quote: truncateQuote(leaked) });
      }
    }
  }

  return dedupeFindings(findings);
}

export function describeKnowledgeLeaks(findings: readonly KnowledgeLeakFinding[]): string[] {
  return findings.map(
    (finding) =>
      `Possible knowledge leak: ${finding.entityName} may reference something they should not know (${finding.fact}).`,
  );
}

/**
 * Split the reply into sentence-level segments so a fact leaked in one
 * character's line is not attributed to another character mentioned elsewhere.
 */
function splitAttributedSegments(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function mentionsEntity(segment: string, name: string): boolean {
  const normalizedName = normalize(name);
  if (!normalizedName) {
    return false;
  }
  return normalize(segment).includes(normalizedName);
}

function segmentExpressesFact(segment: string, factTokens: readonly string[]): boolean {
  const segmentTokens = new Set(meaningfulTokens(segment, ""));
  const matched = factTokens.filter((token) => segmentTokens.has(token)).length;
  return matched / factTokens.length >= MATCH_RATIO;
}

function meaningfulTokens(value: string, excludeName: string): string[] {
  const excluded = new Set(normalize(excludeName).split(/\s+/).filter(Boolean));
  return normalize(value)
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token) && !excluded.has(token));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function truncateQuote(value: string): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > 160 ? `${clean.slice(0, 157)}...` : clean;
}

function dedupeFindings(findings: readonly KnowledgeLeakFinding[]): KnowledgeLeakFinding[] {
  const seen = new Set<string>();
  const output: KnowledgeLeakFinding[] = [];
  for (const finding of findings) {
    const key = `${normalize(finding.entityName)}::${normalize(finding.fact)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(finding);
  }
  return output;
}
