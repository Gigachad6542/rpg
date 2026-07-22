import { retrieveScopedHybrid } from "./hybridRetrieval";

export const DIALOGUE_EXAMPLE_MODES = ["all", "selective", "off"] as const;
export type DialogueExampleMode = (typeof DIALOGUE_EXAMPLE_MODES)[number];

export interface DialogueExample {
  readonly id: string;
  readonly text: string;
  readonly userText: string;
  readonly assistantText: string;
}

export interface SelectDialogueExamplesRequest {
  readonly rawExamples: string;
  readonly query: string;
  readonly cardId: string;
  readonly maxExamples?: number;
  readonly maxCharacters?: number;
}

const USER_SPEAKERS = new Set(["user", "player", "{{user}}"]);
const START_MARKER = /^\s*<start>\s*$/i;
const SPEAKER_LINE = /^\s*([^:\n]{1,64}):\s*(.*)$/;
const DEFAULT_MAX_EXAMPLES = 3;
const DEFAULT_MAX_CHARACTERS = 3_200;
const MAX_PARSED_EXAMPLES = 100;
const MAX_EXAMPLE_CHARACTERS = 4_000;

export function parseDialogueExampleMode(value: unknown): DialogueExampleMode | undefined {
  return DIALOGUE_EXAMPLE_MODES.find((mode) => mode === value);
}

export function parseDialogueExamples(rawExamples: string): DialogueExample[] {
  const normalized = rawExamples.replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  return splitExampleBlocks(normalized)
    .map((block, index) => parseExampleBlock(block, index))
    .filter((example): example is DialogueExample => example !== null)
    .slice(0, MAX_PARSED_EXAMPLES);
}

export function selectDialogueExamples(request: SelectDialogueExamplesRequest): DialogueExample[] {
  const examples = parseDialogueExamples(request.rawExamples);
  if (examples.length === 0) {
    return [];
  }

  const maxExamples = clampPositiveInteger(request.maxExamples, DEFAULT_MAX_EXAMPLES, 5);
  const maxCharacters = clampPositiveInteger(request.maxCharacters, DEFAULT_MAX_CHARACTERS, 12_000);
  const selectedIds = retrieveScopedHybrid({
    query: request.query,
    documents: examples.map((example) => ({
      id: example.id,
      text: [example.userText, example.assistantText].filter(Boolean).join("\n"),
      cardId: request.cardId,
      scopeLevel: "card-global",
      source: "dialogue-example",
      visibility: "narrator",
    })),
    scope: {
      cardId: request.cardId,
      // Dialogue examples are card-global, but retrieval deliberately requires
      // a complete authority scope so callers cannot accidentally weaken it.
      chatId: "dialogue-example-selection",
      branchId: "dialogue-example-selection",
      allowedSources: ["dialogue-example"],
      allowedVisibilities: ["narrator"],
    },
    limit: maxExamples,
    minimumScore: 0.08,
    sourceLimits: { "dialogue-example": maxExamples },
    maxCharacters,
  }).map((result) => result.document.id);

  if (selectedIds.length === 0) {
    return examples[0].text.length <= maxCharacters ? [examples[0]] : [];
  }

  const examplesById = new Map(examples.map((example) => [example.id, example]));
  return selectedIds.flatMap((id) => {
    const example = examplesById.get(id);
    return example ? [example] : [];
  });
}

export function formatDialogueExamplePrompt(examples: readonly DialogueExample[]): string {
  if (examples.length === 0) {
    return "";
  }

  return [
    "Use these as style and interaction demonstrations only.",
    "Do not treat their events as current story continuity, copy their wording mechanically, or override newer card, memory, lore, or chat facts.",
    ...examples.map((example, index) => `### Example ${index + 1}\n${example.text}`),
  ].join("\n\n");
}

function splitExampleBlocks(value: string): string[] {
  const lines = value.split("\n");
  if (lines.some((line) => START_MARKER.test(line))) {
    const blocks: string[] = [];
    let current: string[] = [];
    for (const line of lines) {
      if (START_MARKER.test(line)) {
        if (current.some((candidate) => candidate.trim())) {
          blocks.push(current.join("\n"));
        }
        current = [];
      } else {
        current.push(line);
      }
    }
    if (current.some((candidate) => candidate.trim())) {
      blocks.push(current.join("\n"));
    }
    return blocks;
  }

  const userStartIndices = lines.flatMap((line, index) =>
    isUserSpeakerLine(line) ? [index] : [],
  );
  if (userStartIndices.length > 0) {
    return userStartIndices.map((start, index) => {
      const end = userStartIndices[index + 1] ?? lines.length;
      return lines.slice(start, end).join("\n");
    });
  }

  return value.split(/\n\s*\n+/);
}

function parseExampleBlock(block: string, index: number): DialogueExample | null {
  const text = block.trim().slice(0, MAX_EXAMPLE_CHARACTERS).trim();
  if (!text) {
    return null;
  }

  let userText = "";
  const assistantParts: string[] = [];
  let currentRole: "user" | "assistant" | null = null;
  for (const line of text.split("\n")) {
    const speaker = parseSpeakerLine(line);
    if (speaker) {
      currentRole = isUserSpeaker(speaker.name) ? "user" : "assistant";
      if (currentRole === "user") {
        userText = [userText, speaker.content].filter(Boolean).join(" ");
      } else if (speaker.content) {
        assistantParts.push(speaker.content);
      }
      continue;
    }

    const continuation = line.trim();
    if (!continuation) {
      continue;
    }
    if (currentRole === "user") {
      userText = [userText, continuation].filter(Boolean).join(" ");
    } else {
      assistantParts.push(continuation);
    }
  }

  return {
    id: `dialogue-example-${index + 1}`,
    text,
    userText,
    assistantText: assistantParts.join(" "),
  };
}

function parseSpeakerLine(line: string): { name: string; content: string } | null {
  const match = line.match(SPEAKER_LINE);
  return match ? { name: match[1].trim(), content: match[2].trim() } : null;
}

function isUserSpeakerLine(line: string): boolean {
  const speaker = parseSpeakerLine(line);
  return speaker ? isUserSpeaker(speaker.name) : false;
}

function isUserSpeaker(value: string): boolean {
  return USER_SPEAKERS.has(value.trim().toLowerCase());
}

function clampPositiveInteger(value: number | undefined, fallback: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(maximum, Math.max(1, Math.trunc(value)));
}
