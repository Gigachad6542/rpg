// Pure slash-command registry for the composer.
//
// This module only *describes* the available commands and parses composer
// input into a recognised command plus its raw argument string. It performs no
// side effects and knows nothing about the app state — execution (rolling dice,
// opening the lore panel, generating an image, branching, etc.) is wired up by
// the caller in App.tsx. Keeping it pure makes the parsing and autocomplete
// behaviour trivially testable.

export interface SlashCommand {
  /** Command token without the leading slash, e.g. "roll". */
  name: string;
  /** One-line description shown in the autocomplete popup. */
  summary: string;
  /** Example invocation, e.g. "/roll 2d6+3". */
  usage: string;
  /** Placeholder hint describing the expected argument. */
  argHint: string;
}

export interface ParsedSlashCommand {
  command: SlashCommand;
  /** Everything after the command token, trimmed. Empty string when omitted. */
  args: string;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    name: "roll",
    summary: "Roll dice and post the result",
    usage: "/roll 2d6+3",
    argHint: "NdM+K (defaults to 1d20)",
  },
  {
    name: "img",
    summary: "Generate an image from a prompt",
    usage: "/img a storm over the harbor",
    argHint: "scene description",
  },
  {
    name: "branch",
    summary: "Branch the conversation from here",
    usage: "/branch",
    argHint: "no arguments needed",
  },
];

const COMMAND_INDEX: ReadonlyMap<string, SlashCommand> = new Map(
  SLASH_COMMANDS.map((command) => [command.name, command]),
);

/**
 * Parses composer input into a recognised command and its argument string.
 * Returns null when the input is not a slash command or the command token is
 * not one we know about. Leading/trailing whitespace is ignored.
 */
export function parseSlashCommand(input: string): ParsedSlashCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const withoutSlash = trimmed.slice(1);
  const separatorIndex = withoutSlash.search(/\s/);
  const name = (separatorIndex === -1 ? withoutSlash : withoutSlash.slice(0, separatorIndex)).toLowerCase();
  const args = separatorIndex === -1 ? "" : withoutSlash.slice(separatorIndex + 1).trim();

  const command = COMMAND_INDEX.get(name);
  if (!command) {
    return null;
  }

  return { command, args };
}

/**
 * Returns the commands to show in the autocomplete popup for the current
 * composer text. The popup is only relevant while the user is still typing the
 * command token: once a space (start of arguments) is present, or the text does
 * not begin with a slash, no suggestions are shown.
 */
export function matchSlashCommands(input: string): SlashCommand[] {
  if (!input.startsWith("/")) {
    return [];
  }

  const afterSlash = input.slice(1);
  if (/\s/.test(afterSlash)) {
    return [];
  }

  const prefix = afterSlash.toLowerCase();
  return SLASH_COMMANDS.filter((command) => command.name.startsWith(prefix));
}
