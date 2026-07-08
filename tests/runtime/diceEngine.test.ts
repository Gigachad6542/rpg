import { describe, expect, it } from "vitest";
import {
  formatDiceResult,
  parseDiceNotation,
  rollDice,
  rollFromNotation,
} from "../../src/runtime/diceEngine";

describe("parseDiceNotation", () => {
  it("parses a bare die like d20", () => {
    expect(parseDiceNotation("d20")).toEqual({ count: 1, sides: 20, modifier: 0 });
  });

  it("parses count, sides, and a positive modifier", () => {
    expect(parseDiceNotation("2d6+3")).toEqual({ count: 2, sides: 6, modifier: 3 });
  });

  it("parses a negative modifier and tolerates whitespace", () => {
    expect(parseDiceNotation(" 1d20 - 1 ")).toEqual({ count: 1, sides: 20, modifier: -1 });
  });

  it("rejects malformed notation and out-of-range dice", () => {
    expect(parseDiceNotation("banana")).toBeNull();
    expect(parseDiceNotation("0d6")).toBeNull();
    expect(parseDiceNotation("101d6")).toBeNull();
    expect(parseDiceNotation("2d1")).toBeNull();
    expect(parseDiceNotation("2d1001")).toBeNull();
  });
});

describe("rollDice", () => {
  it("uses the injected RNG deterministically and applies the modifier", () => {
    const sequence = [0, 0.99];
    const random = () => sequence.shift() ?? 0;
    const result = rollDice({ count: 2, sides: 6, modifier: 3 }, random);
    expect(result.rolls).toEqual([1, 6]);
    expect(result.total).toBe(10);
    expect(result.notation).toBe("2d6+3");
  });

  it("keeps every die within [1, sides]", () => {
    const result = rollDice({ count: 50, sides: 20, modifier: 0 }, Math.random);
    expect(result.rolls).toHaveLength(50);
    expect(result.rolls.every((value) => value >= 1 && value <= 20)).toBe(true);
  });
});

describe("rollFromNotation", () => {
  it("defaults to a single d20 when the argument is empty", () => {
    const result = rollFromNotation("   ", () => 0.5);
    expect(result?.notation).toBe("1d20");
    expect(result?.rolls).toEqual([11]);
  });

  it("returns null for invalid notation", () => {
    expect(rollFromNotation("nope")).toBeNull();
  });
});

describe("formatDiceResult", () => {
  it("renders rolls, modifier, and total", () => {
    const result = rollDice({ count: 2, sides: 6, modifier: 3 }, () => 0.5);
    expect(formatDiceResult(result)).toBe("🎲 2d6+3 → [4, 4] +3 = 11");
  });

  it("omits the modifier segment when there is no modifier", () => {
    const result = rollDice({ count: 1, sides: 20, modifier: 0 }, () => 0);
    expect(formatDiceResult(result)).toBe("🎲 1d20 → [1] = 1");
  });
});
