// Parsing for assistant replies and their trailing status blocks.
//
// Model replies may end with a fenced or bare status block (Location:, Health:,
// Inventory:, ...). These pure helpers split that block from the narrative body,
// parse the status items, derive a location proposal, and strip a trailing
// "what do you do?" call-to-action. Extracted from App.tsx so the runtime view,
// the message renderer, and the map-prompt planner can share one implementation.

export interface AssistantMessageDisplay {
  paragraphs: string[];
  statusItems: Array<{ label: string; value: string }>;
}

export function parseAssistantMessageDisplay(content: string): AssistantMessageDisplay {
  const { body, statusBlock } = splitTrailingStatusBlock(content);
  const statusItems = parseStatusItems(statusBlock);
  const paragraphs = body
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);

  return {
    paragraphs: paragraphs.length > 0 ? paragraphs : [content.trim()].filter(Boolean),
    statusItems,
  };
}

export function splitTrailingStatusBlock(content: string): { body: string; statusBlock: string } {
  const trimmed = content.trim();
  const fenced = trimmed.match(/(?:\n|^)```(?:status|text)?\s*\n([\s\S]*?)\n```\s*$/i);
  if (fenced?.[1] && looksLikeStatusBlock(fenced[1])) {
    return {
      body: trimmed.slice(0, fenced.index).trim(),
      statusBlock: fenced[1],
    };
  }

  const lines = trimmed.split(/\r?\n/);
  const statusLines: string[] = [];
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line) {
      break;
    }
    if (!isStatusLine(line)) {
      break;
    }
    statusLines.unshift(line);
  }

  if (statusLines.length >= 2) {
    return {
      body: lines.slice(0, lines.length - statusLines.length).join("\n").trim(),
      statusBlock: statusLines.join("\n"),
    };
  }

  return { body: trimmed, statusBlock: "" };
}

export function deriveStatusBlockLocationProposal(
  assistantMessageText: string,
  existingLocationProposal: string | null,
  card: { kind: string; rpg?: { location: string } },
): string | null {
  if (card.kind !== "rpg" || !card.rpg) {
    return null;
  }
  if (existingLocationProposal?.trim()) {
    return null;
  }
  const { statusBlock } = splitTrailingStatusBlock(assistantMessageText);
  if (!statusBlock) {
    return null;
  }
  const locationItem = parseStatusItems(statusBlock).find((item) => /^location$/i.test(item.label));
  const value = locationItem?.value.trim() ?? "";
  if (!value || /^(not specified|unspecified|unknown|none|n\/a|-|unchanged|same)$/i.test(value)) {
    return null;
  }
  if (value.toLowerCase() === card.rpg.location.trim().toLowerCase()) {
    return null;
  }
  return value;
}

export function stripTrailingCallToAction(content: string): string {
  const { body, statusBlock } = splitTrailingStatusBlock(content);
  const paragraphs = body.trim().split(/\n{2,}/);
  if (paragraphs.length < 2 || !isPlayerCallToAction(paragraphs[paragraphs.length - 1] ?? "")) {
    return content;
  }
  const strippedBody = paragraphs.slice(0, -1).join("\n\n").trim();
  if (!strippedBody) {
    return content;
  }
  return statusBlock ? `${strippedBody}\n\n${statusBlock}` : strippedBody;
}

export function isPlayerCallToAction(paragraph: string): boolean {
  const cleaned = paragraph.replace(/^[*_\s]+|[*_\s]+$/g, "");
  if (!cleaned || cleaned.length > 160 || !cleaned.endsWith("?")) {
    return false;
  }
  if (/["“”]/.test(cleaned)) {
    return false;
  }
  return /^(what|where|how|will|do|does|are|is|would|which|who|shall)\b/i.test(cleaned) && /\byou(r)?\b/i.test(cleaned);
}

export function looksLikeStatusBlock(value: string): boolean {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .some(isStatusLine);
}

export function parseStatusItems(block: string): Array<{ label: string; value: string }> {
  return block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(isStatusLine)
    .map((line) => {
      const separatorIndex = line.indexOf(":");
      return {
        label: line.slice(0, separatorIndex).trim(),
        value: line.slice(separatorIndex + 1).trim(),
      };
    })
    .filter((item) => item.label && item.value);
}

export function isStatusLine(line: string): boolean {
  return /^(?:current\s+)?(?:date|time|location|weather|health|inventory|quest|status)\s*:/i.test(line);
}
