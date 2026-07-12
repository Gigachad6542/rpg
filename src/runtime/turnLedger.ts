// Turn ledger: per-turn, per-variant state commits.
//
// The runtime's game state (rpg + memory) was mutated cumulatively onto the
// active card: each turn folded its effects in, and regeneration stacked a new
// turn's effects on top of the ones it replaced, while swiping a variant only
// swapped the visible text. That let the visible history and the authoritative
// state disagree (an item "taken" in a discarded variant stayed in inventory).
//
// The ledger records every assistant variant's effect delta keyed by the
// assistant message id, and derives the authoritative state by folding ONLY the
// active variant's effects along the visible message chain, starting from a
// branch-root base state. Regeneration adds a variant and makes it active;
// swiping changes which variant is active; branching copies the relevant
// commits under remapped ids; editing an earlier turn prunes downstream commits.
// Every operation is pure and returns a new ledger.
import type { ExtractionResult } from "./extraction";
import { applyValidatedTurnEffectsToCard, type TurnEffectRuntimeCard } from "../app/turnEffects";

/** One generated variant's recorded effect delta for a single assistant turn. */
export interface TurnVariantCommit<Effects = ExtractionResult> {
  variantIndex: number;
  effects: Effects;
}

/** All recorded variants for one assistant turn (keyed in the ledger by messageId). */
export interface TurnCommit<Effects = ExtractionResult> {
  messageId: string;
  variants: TurnVariantCommit<Effects>[];
}

/** Per-chat ledger mapping an assistant message id to its recorded commit. */
export type TurnLedger<Effects = ExtractionResult> = Record<string, TurnCommit<Effects>>;

/** Structural subset of Message that the fold needs — role + active variant. */
export interface LedgerMessage {
  id: string;
  role: "system" | "user" | "assistant";
  activeVariantIndex?: number;
}

/** How a single turn's effects are folded onto the running card state. */
export type EffectFolder<Card, Effects = ExtractionResult> = (card: Card, effects: Effects) => Card;

export function emptyTurnLedger<Effects = ExtractionResult>(): TurnLedger<Effects> {
  return {};
}

/**
 * Records the effects produced by a specific assistant message + variant.
 * Re-recording the same variant index replaces it (idempotent regeneration of
 * the same slot), so the ledger never accumulates duplicate variant deltas.
 */
export function recordTurnVariant<Effects = ExtractionResult>(
  ledger: TurnLedger<Effects>,
  messageId: string,
  variantIndex: number,
  effects: Effects,
): TurnLedger<Effects> {
  const existing = ledger[messageId];
  const preserved = existing ? existing.variants.filter((variant) => variant.variantIndex !== variantIndex) : [];
  const variants = [...preserved, { variantIndex, effects }].sort((a, b) => a.variantIndex - b.variantIndex);
  return {
    ...ledger,
    [messageId]: { messageId, variants },
  };
}

/**
 * Resolves the effects for the active variant of a commit. When no active index
 * is stored (`undefined`), falls back to the last recorded variant — matching
 * how the UI treats a missing `activeVariantIndex` as the newest generation.
 * When a specific index is requested but no variant matches, returns null so the
 * fold skips the turn (fail closed) instead of applying a different variant's
 * effects and leaking discarded state. Also returns null for a commit with no
 * recorded variants.
 */
export function selectVariantEffects<Effects = ExtractionResult>(
  commit: TurnCommit<Effects>,
  activeVariantIndex: number | undefined,
): Effects | null {
  if (commit.variants.length === 0) {
    return null;
  }
  const fallback = commit.variants[commit.variants.length - 1];
  if (activeVariantIndex === undefined) {
    return fallback.effects;
  }
  const match = commit.variants.find((variant) => variant.variantIndex === activeVariantIndex);
  return match?.effects ?? null;
}

/**
 * Derives the authoritative card state by folding the active variant's effects
 * for each assistant turn along the visible message chain, starting from the
 * branch-root base state. Non-assistant messages and messages without a commit
 * are skipped. Pure: `baseCard` is never mutated.
 */
export function foldTurnLedger<Card extends TurnEffectRuntimeCard>(
  baseCard: Card,
  messages: readonly LedgerMessage[],
  ledger: TurnLedger<ExtractionResult>,
  apply?: EffectFolder<Card, ExtractionResult>,
): Card;
export function foldTurnLedger<Card, Effects>(
  baseCard: Card,
  messages: readonly LedgerMessage[],
  ledger: TurnLedger<Effects>,
  apply: EffectFolder<Card, Effects>,
): Card;
export function foldTurnLedger<Card, Effects>(
  baseCard: Card,
  messages: readonly LedgerMessage[],
  ledger: TurnLedger<Effects>,
  apply?: EffectFolder<Card, Effects>,
): Card {
  const folder =
    apply ??
    (applyValidatedTurnEffectsToCard as unknown as EffectFolder<Card, Effects>);
  let card = baseCard;
  for (const message of messages) {
    if (message.role !== "assistant") {
      continue;
    }
    const commit = ledger[message.id];
    if (!commit) {
      continue;
    }
    const effects = selectVariantEffects(commit, message.activeVariantIndex);
    if (!effects) {
      continue;
    }
    card = folder(card, effects);
  }
  return card;
}

/**
 * Keeps only the commits whose message id survives — used both to fork a chat
 * at an edited turn (drop downstream commits) and to select the subset of
 * commits a branch inherits.
 */
export function pruneTurnLedger<Effects = ExtractionResult>(
  ledger: TurnLedger<Effects>,
  keepMessageIds: Iterable<string>,
): TurnLedger<Effects> {
  const keep = keepMessageIds instanceof Set ? keepMessageIds : new Set(keepMessageIds);
  const pruned: TurnLedger<Effects> = {};
  for (const [messageId, commit] of Object.entries(ledger)) {
    if (keep.has(messageId)) {
      pruned[messageId] = commit;
    }
  }
  return pruned;
}

/**
 * Rewrites commit message ids through a mapping. Branching clones messages with
 * new ids, so the branch's ledger must point the copied commits at the cloned
 * message ids; commits whose id is absent from the map are dropped.
 */
export function remapTurnLedger<Effects = ExtractionResult>(
  ledger: TurnLedger<Effects>,
  idMap: ReadonlyMap<string, string>,
): TurnLedger<Effects> {
  const remapped: TurnLedger<Effects> = {};
  for (const [messageId, commit] of Object.entries(ledger)) {
    const nextId = idMap.get(messageId);
    if (nextId === undefined) {
      continue;
    }
    remapped[nextId] = { ...commit, messageId: nextId };
  }
  return remapped;
}
