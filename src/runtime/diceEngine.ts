// Pure dice-rolling engine for the optional tabletop dice feature.
// Parses standard NdM(+/-K) notation, rolls with an injectable RNG so the
// behaviour is deterministic under test, and formats a human-readable result
// that is safe to post into chat and feed back to the model.

export interface DiceRollRequest {
  count: number;
  sides: number;
  modifier: number;
}

export interface DiceRollResult {
  notation: string;
  count: number;
  sides: number;
  modifier: number;
  rolls: number[];
  total: number;
}

export type RandomSource = () => number;

const MAX_DICE_COUNT = 100;
const MAX_DICE_SIDES = 1000;
const MAX_MODIFIER = 100_000;
const DEFAULT_SIDES = 20;

const NOTATION_PATTERN = /^\s*(\d*)\s*d\s*(\d+)\s*(?:([+-])\s*(\d+))?\s*$/i;

/**
 * Parses dice notation such as `d20`, `2d6`, or `1d20+3`. Returns null when the
 * notation is malformed or the requested dice exceed the safety limits.
 */
export function parseDiceNotation(input: string): DiceRollRequest | null {
  const match = NOTATION_PATTERN.exec(input);
  if (!match) {
    return null;
  }

  const count = match[1] ? Number.parseInt(match[1], 10) : 1;
  const sides = Number.parseInt(match[2], 10);
  const modifierMagnitude = match[4] ? Number.parseInt(match[4], 10) : 0;
  const modifier = match[3] === "-" ? -modifierMagnitude : modifierMagnitude;

  if (!Number.isInteger(count) || count < 1 || count > MAX_DICE_COUNT) {
    return null;
  }
  if (!Number.isInteger(sides) || sides < 2 || sides > MAX_DICE_SIDES) {
    return null;
  }
  if (!Number.isInteger(modifier) || Math.abs(modifier) > MAX_MODIFIER) {
    return null;
  }

  return { count, sides, modifier };
}

/**
 * Rolls the requested dice. `random` must return a float in [0, 1); it defaults
 * to Math.random but is injected in tests for deterministic results.
 */
export function rollDice(request: DiceRollRequest, random: RandomSource = Math.random): DiceRollResult {
  const rolls: number[] = [];
  for (let index = 0; index < request.count; index += 1) {
    const value = Math.floor(random() * request.sides) + 1;
    rolls.push(Math.min(Math.max(value, 1), request.sides));
  }
  const rollSum = rolls.reduce((sum, value) => sum + value, 0);
  return {
    notation: formatNotation(request),
    count: request.count,
    sides: request.sides,
    modifier: request.modifier,
    rolls,
    total: rollSum + request.modifier,
  };
}

/**
 * Parses and rolls in one step. Returns null when the notation is invalid.
 * An empty or whitespace-only argument rolls a single d20.
 */
export function rollFromNotation(input: string, random: RandomSource = Math.random): DiceRollResult | null {
  const trimmed = input.trim();
  const request = trimmed
    ? parseDiceNotation(trimmed)
    : { count: 1, sides: DEFAULT_SIDES, modifier: 0 };
  if (!request) {
    return null;
  }
  return rollDice(request, random);
}

/** Formats a result for display, e.g. `🎲 2d6+3 → [4, 5] +3 = 12`. */
export function formatDiceResult(result: DiceRollResult): string {
  const rollsText = `[${result.rolls.join(", ")}]`;
  const modifierText =
    result.modifier === 0 ? "" : ` ${result.modifier > 0 ? "+" : "−"}${Math.abs(result.modifier)}`;
  return `🎲 ${result.notation} → ${rollsText}${modifierText} = ${result.total}`;
}

function formatNotation(request: DiceRollRequest): string {
  const base = `${request.count}d${request.sides}`;
  if (request.modifier === 0) {
    return base;
  }
  return `${base}${request.modifier > 0 ? "+" : "-"}${Math.abs(request.modifier)}`;
}
