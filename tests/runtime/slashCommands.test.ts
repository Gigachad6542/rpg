import { describe, expect, it } from "vitest";
import {
  SLASH_COMMANDS,
  matchSlashCommands,
  parseSlashCommand,
} from "../../src/runtime/slashCommands";

describe("SLASH_COMMANDS", () => {
  it("registers the expected commands", () => {
    const names = SLASH_COMMANDS.map((command) => command.name);
    expect(names).toEqual(["roll", "lore", "mem", "img", "branch"]);
  });
});

describe("parseSlashCommand", () => {
  it("parses a command with arguments", () => {
    expect(parseSlashCommand("/roll 2d6+3")).toEqual({
      command: expect.objectContaining({ name: "roll" }),
      args: "2d6+3",
    });
  });

  it("parses a command with no arguments", () => {
    const parsed = parseSlashCommand("/roll");
    expect(parsed?.command.name).toBe("roll");
    expect(parsed?.args).toBe("");
  });

  it("keeps multi-word arguments intact and trims surrounding whitespace", () => {
    const parsed = parseSlashCommand("  /img  a storm over the harbor  ");
    expect(parsed?.command.name).toBe("img");
    expect(parsed?.args).toBe("a storm over the harbor");
  });

  it("is case-insensitive on the command token", () => {
    expect(parseSlashCommand("/ROLL d20")?.command.name).toBe("roll");
  });

  it("returns null for plain text and unknown commands", () => {
    expect(parseSlashCommand("hello there")).toBeNull();
    expect(parseSlashCommand("/unknown thing")).toBeNull();
    expect(parseSlashCommand("")).toBeNull();
  });
});

describe("matchSlashCommands", () => {
  it("lists every command for a bare slash", () => {
    expect(matchSlashCommands("/").map((command) => command.name)).toEqual([
      "roll",
      "lore",
      "mem",
      "img",
      "branch",
    ]);
  });

  it("filters by prefix", () => {
    expect(matchSlashCommands("/r").map((command) => command.name)).toEqual(["roll"]);
  });

  it("stops suggesting once arguments begin", () => {
    expect(matchSlashCommands("/roll ")).toEqual([]);
  });

  it("returns nothing when the text is not a slash command", () => {
    expect(matchSlashCommands("roll")).toEqual([]);
    expect(matchSlashCommands("")).toEqual([]);
  });
});
