import { z } from "zod";

import type { TextGenerationRequest, TextModelAdapter } from "../providers/TextModelAdapter";

export interface ConsolidationMemoryEntry {
  id?: string;
  label: string;
  detail: string;
}

export interface MemoryConsolidationRequest {
  modelAdapter: TextModelAdapter;
  model: string;
  entries: readonly ConsolidationMemoryEntry[];
  now?: () => string;
  randomId?: () => string;
}

export interface MemoryConsolidationResult {
  entries: ConsolidationMemoryEntry[];
  warnings: string[];
  changed: boolean;
}

/** Below this count there is nothing worth consolidating; skip the model call. */
export const MIN_ENTRIES_TO_CONSOLIDATE = 4;
const MAX_CONSOLIDATED_ENTRIES = 120;

const PayloadSchema = z.object({
  memory: z.array(z.record(z.unknown())).optional(),
  memory_updates: z.array(z.record(z.unknown())).optional(),
  entries: z.array(z.record(z.unknown())).optional(),
});

export function buildMemoryConsolidationPrompt(entries: readonly ConsolidationMemoryEntry[]): string {
  const current = entries.map((entry) => `- ${entry.label}: ${entry.detail}`).join("\n");
  return [
    "You are the memory archivist for a local-first RPG runtime. Rewrite the stored memory into a denser, non-redundant set of durable facts.",
    "Rules:",
    "- Merge duplicate or overlapping entries into one.",
    "- Generalize resolved episodes into the stable truth they established (for example, many travel notes about the north road becoming 'The player is based in the north').",
    "- Drop transient trivia that no longer matters.",
    "- Preserve every durable fact about the player character, the world, factions, major locations, important possessions, and standing obligations.",
    "- Never invent facts that are not supported by the current memory.",
    "Output JSON only, no prose, in this exact shape:",
    JSON.stringify({ memory: [{ label: "stable fact label", detail: "stable fact detail" }] }),
    "",
    current ? `Current memory:\n${current}` : "Current memory: none",
  ].join("\n\n");
}

export function parseMemoryConsolidationResponse(
  responseText: string,
  options: { now?: () => string; randomId?: () => string } = {},
): ConsolidationMemoryEntry[] {
  const json = extractJsonObject(responseText);
  if (!json) {
    return [];
  }
  const parsed = PayloadSchema.safeParse(json);
  if (!parsed.success) {
    return [];
  }
  const rawEntries = parsed.data.memory ?? parsed.data.memory_updates ?? parsed.data.entries ?? [];
  const now = options.now?.() ?? new Date().toISOString();
  const randomId = options.randomId ?? (() => Math.random().toString(36).slice(2, 8));

  const seen = new Set<string>();
  const output: ConsolidationMemoryEntry[] = [];
  for (const raw of rawEntries) {
    const detail = cleanText(getString(raw.detail) || getString(raw.text) || getString(raw.content), 700);
    if (!detail) {
      continue;
    }
    const key = normalize(detail);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push({
      id: cleanId(raw.id) || createDatedId("memory", now, randomId()),
      label: cleanText(getString(raw.label) || getString(raw.title) || "Continuity", 80) || "Continuity",
      detail,
    });
    if (output.length >= MAX_CONSOLIDATED_ENTRIES) {
      break;
    }
  }
  return output;
}

export async function runMemoryConsolidation(
  request: MemoryConsolidationRequest,
): Promise<MemoryConsolidationResult> {
  if (request.entries.length < MIN_ENTRIES_TO_CONSOLIDATE) {
    return { entries: [...request.entries], warnings: [], changed: false };
  }

  const generationRequest: TextGenerationRequest = {
    model: request.model,
    prompt: buildMemoryConsolidationPrompt(request.entries),
    temperature: 0.2,
    maxOutputTokens: 2000,
    metadata: { memoryConsolidationPass: true },
  };
  const response = await request.modelAdapter.generateText(generationRequest);
  const consolidated = parseMemoryConsolidationResponse(response.text, {
    now: request.now,
    randomId: request.randomId,
  });

  // Never replace real memory with an empty or larger result: consolidation
  // must only ever shrink or hold, never lose everything to a bad response.
  if (consolidated.length === 0 || consolidated.length >= request.entries.length) {
    return {
      entries: [...request.entries],
      warnings: ["Memory consolidation produced no smaller result; memory left unchanged."],
      changed: false,
    };
  }

  return { entries: consolidated, warnings: [], changed: true };
}

export async function runMemoryConsolidationSafely(
  request: MemoryConsolidationRequest,
): Promise<MemoryConsolidationResult> {
  try {
    return await runMemoryConsolidation(request);
  } catch (error) {
    return {
      entries: [...request.entries],
      warnings: [`Memory consolidation failed: ${formatError(error)}`],
      changed: false,
    };
  }
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  const direct = tryParseRecord(trimmed);
  if (direct) {
    return direct;
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const parsed = tryParseRecord(fenced[1].trim());
    if (parsed) {
      return parsed;
    }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return tryParseRecord(trimmed.slice(start, end + 1));
  }
  return null;
}

function tryParseRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function getString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function cleanText(value: unknown, maxLength: number): string {
  return getString(value).replace(/\s+/g, " ").trim().slice(0, maxLength).trim();
}

function cleanId(value: unknown): string | undefined {
  const cleaned = cleanText(value, 120);
  return /^[A-Za-z0-9_.:-]+$/.test(cleaned) ? cleaned : undefined;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function createDatedId(prefix: string, now: string, suffix: string): string {
  const timestamp = now.replace(/[-:.]/g, "").replace(/\s+/g, "") || String(Date.now());
  const slug = suffix.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 8) || "id";
  return `${prefix}_${timestamp}_${slug}`;
}

function formatError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/\b(sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/g, "[redacted]").slice(0, 200) || "unknown error";
}
