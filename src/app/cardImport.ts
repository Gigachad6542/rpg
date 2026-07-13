// Universal character-card import: Tavern Card v1/v2/v3 (PNG + JSON) and Chub.
//
// Pure, side-effect-free parsing/mapping helpers so the whole pipeline is unit
// testable. File and network I/O live in thin async wrappers at the bottom.
import type { CardImportSource, RuntimeCard } from "./runtimeTypes";
import {
  getPayloadString,
  getPayloadStringArray,
  isRecord,
  parseJsonRecordOrThrow,
  readFileAsText,
} from "./appUtils";
import { createDefaultCharacterPlayerRules, createInitialStoryEntities, getCleanString } from "./cardNormalization";
import { mapChubLorebookPayload } from "./lorebookIo";
import { createRuntimeEntityId } from "./chatSessions";
import { buildEmbeddableAvatarDataUrl, type EmbeddableAvatarResult } from "./avatarImage";

export { AVATAR_MAX_EMBED_BYTES } from "./avatarImage";
export const MAX_CARD_IMPORT_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_CARD_IMPORT_JSON_CHARS = 2_000_000;
const MAX_CARD_TEXT_CHARS = 200_000;

function boundedText(value: unknown, maximum = MAX_CARD_TEXT_CHARS): string {
  return getPayloadString(value).slice(0, maximum);
}

function boundedList(value: unknown, maximumItems: number, maximumItemChars: number): string[] {
  return getPayloadStringArray(value).slice(0, maximumItems).map((item) => item.slice(0, maximumItemChars));
}

export interface NormalizedTavernCard {
  spec: "v1" | "chara_card_v2" | "chara_card_v3";
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMessage: string;
  exampleDialogs: string;
  systemPrompt: string;
  postHistoryInstructions: string;
  creatorNotes: string;
  alternateGreetings: string[];
  tags: string[];
  creator: string;
  characterVersion: string;
  characterBook?: Record<string, unknown>;
}

export interface ImportedCard {
  card: RuntimeCard;
  warnings: string[];
}

export interface BuildCardOptions {
  cardId?: string;
  source?: CardImportSource;
  avatarDataUrl?: string;
}

// --- base64 / byte helpers -------------------------------------------------

function base64ToBytes(base64: string): Uint8Array {
  const cleaned = base64.replace(/\s+/g, "");
  if (typeof atob !== "function") {
    throw new Error("Base64 decoding is not available in this environment.");
  }
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa !== "function") {
    throw new Error("Base64 encoding is not available in this environment.");
  }
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function bytesToUtf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== "undefined") {
    return new TextDecoder("utf-8").decode(bytes);
  }
  let result = "";
  for (const byte of bytes) {
    result += String.fromCharCode(byte);
  }
  try {
    return decodeURIComponent(escape(result));
  } catch {
    return result;
  }
}

function decodeBase64Utf8(base64: string): string {
  return bytesToUtf8(base64ToBytes(base64));
}

export function bytesToPngDataUrl(bytes: Uint8Array): string {
  return `data:image/png;base64,${bytesToBase64(bytes)}`;
}

// --- PNG tEXt / iTXt chunk extraction --------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
  );
}

function latin1(bytes: Uint8Array, start: number, end: number): string {
  let result = "";
  for (let index = start; index < end; index += 1) {
    result += String.fromCharCode(bytes[index]);
  }
  return result;
}

function parseTextChunk(data: Uint8Array): { keyword: string; text: string } | null {
  const separator = data.indexOf(0);
  if (separator <= 0) {
    return null;
  }
  return {
    keyword: latin1(data, 0, separator),
    text: latin1(data, separator + 1, data.length),
  };
}

function parseItxtChunk(data: Uint8Array): { keyword: string; text: string } | null {
  const keywordEnd = data.indexOf(0);
  if (keywordEnd <= 0 || keywordEnd + 2 >= data.length) {
    return null;
  }
  const compressionFlag = data[keywordEnd + 1];
  if (compressionFlag !== 0) {
    // Compressed iTXt payloads are not supported; character cards use uncompressed text.
    return null;
  }
  const languageEnd = data.indexOf(0, keywordEnd + 3);
  if (languageEnd < 0) {
    return null;
  }
  const translatedEnd = data.indexOf(0, languageEnd + 1);
  if (translatedEnd < 0) {
    return null;
  }
  return {
    keyword: latin1(data, 0, keywordEnd),
    text: latin1(data, translatedEnd + 1, data.length),
  };
}

/** Extracts every tEXt/iTXt keyword→value pair from PNG bytes. */
export function extractPngTextChunks(bytes: Uint8Array): Record<string, string> {
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) {
      throw new Error("File is not a valid PNG image.");
    }
  }

  const chunks: Record<string, string> = {};
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = readUint32BE(bytes, offset);
    const type = latin1(bytes, offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > bytes.length) {
      break;
    }
    if (type === "tEXt") {
      const entry = parseTextChunk(bytes.subarray(dataStart, dataEnd));
      if (entry && !(entry.keyword in chunks)) {
        chunks[entry.keyword] = entry.text;
      }
    } else if (type === "iTXt") {
      const entry = parseItxtChunk(bytes.subarray(dataStart, dataEnd));
      if (entry && !(entry.keyword in chunks)) {
        chunks[entry.keyword] = entry.text;
      }
    }
    if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4; // skip the 4-byte CRC
  }
  return chunks;
}

/** Returns the decoded character-card JSON string embedded in a PNG, or null. */
export function extractTavernJsonFromPng(bytes: Uint8Array): string | null {
  const chunks = extractPngTextChunks(bytes);
  const raw = chunks.ccv3 ?? chunks.chara ?? null; // prefer V3 over V2
  if (!raw) {
    return null;
  }
  const decoded = decodeBase64Utf8(raw);
  if (decoded.trim().startsWith("{")) {
    return decoded;
  }
  // Some exporters store raw (non-base64) JSON directly in the chunk.
  return raw.trim().startsWith("{") ? raw : decoded;
}

// --- Tavern card JSON normalization ----------------------------------------

/** Parses Tavern Character Card JSON (v1 flat, or v2/v3 with a `data` object). */
export function parseTavernCardJson(jsonText: string): NormalizedTavernCard {
  if (jsonText.length > MAX_CARD_IMPORT_JSON_CHARS) {
    throw new Error("Character card JSON is too large (maximum 2,000,000 characters).");
  }
  const root = parseJsonRecordOrThrow(jsonText, "Character card JSON is invalid.");
  const spec = getPayloadString(root.spec);
  const data = isRecord(root.data) ? root.data : root;

  const name = boundedText(data.name, 200) || boundedText(root.name, 200);
  const description = boundedText(data.description) || boundedText(root.description);
  const firstMessage = boundedText(data.first_mes) || boundedText(root.first_mes);
  if (!name && !description && !firstMessage) {
    throw new Error("This file does not look like a character card (no name, description, or greeting).");
  }

  const characterBook = isRecord(data.character_book)
    ? data.character_book
    : isRecord(root.character_book)
      ? root.character_book
      : undefined;

  return {
    spec: spec === "chara_card_v3" ? "chara_card_v3" : spec === "chara_card_v2" ? "chara_card_v2" : "v1",
    name,
    description,
    personality: boundedText(data.personality) || boundedText(root.personality),
    scenario: boundedText(data.scenario) || boundedText(root.scenario),
    firstMessage,
    exampleDialogs: boundedText(data.mes_example) || boundedText(root.mes_example),
    systemPrompt: boundedText(data.system_prompt),
    postHistoryInstructions: boundedText(data.post_history_instructions),
    creatorNotes: boundedText(data.creator_notes, 20_000) || boundedText(root.creator_notes, 20_000),
    alternateGreetings: boundedList(data.alternate_greetings, 32, 50_000),
    tags: boundedList(data.tags, 32, 48),
    creator: boundedText(data.creator, 200),
    characterVersion: boundedText(data.character_version, 100),
    characterBook,
  };
}

function mergeDescriptionAndPersonality(description: string, personality: string): string {
  if (!personality) {
    return description;
  }
  if (!description) {
    return `Personality: ${personality}`;
  }
  return `${description}\n\nPersonality: ${personality}`;
}

function deriveImportedSummary(card: NormalizedTavernCard): string {
  const source = card.creatorNotes || card.description || card.scenario;
  return getCleanString(source, 140) || "Imported character card.";
}

/** Maps a normalized Tavern card into a runtime card, reporting what was imported. */
export function buildRuntimeCardFromTavern(
  normalized: NormalizedTavernCard,
  options: BuildCardOptions = {},
): ImportedCard {
  const cardId = options.cardId ?? createRuntimeEntityId("card");
  const source = options.source ?? "tavern-json";
  const warnings: string[] = [];
  const name = normalized.name || "Imported Character";

  const description = mergeDescriptionAndPersonality(normalized.description, normalized.personality);
  if (normalized.personality) {
    warnings.push("Personality field merged into the description.");
  }

  const lorebooks = normalized.characterBook
    ? [
        mapChubLorebookPayload(normalized.characterBook, {
          id: `lore_${cardId}_book`,
          name: getPayloadString(normalized.characterBook.name) || `${name} lorebook`,
        }),
      ]
    : [];
  if (lorebooks[0]) {
    const count = lorebooks[0].entries.length;
    warnings.push(`Imported embedded lorebook (${count} ${count === 1 ? "entry" : "entries"}).`);
  }
  if (normalized.alternateGreetings.length > 0) {
    warnings.push(`Imported ${normalized.alternateGreetings.length} alternate greeting(s).`);
  }

  const card: RuntimeCard = {
    id: cardId,
    name,
    kind: "character",
    summary: deriveImportedSummary(normalized),
    characterName: name,
    characterDescription: description,
    scenario: normalized.scenario,
    greeting: normalized.firstMessage,
    exampleDialogs: normalized.exampleDialogs,
    systemPrompt: normalized.systemPrompt || "Follow this card's local rules and continuity.",
    preHistoryInstructions: "",
    postHistoryInstructions: normalized.postHistoryInstructions,
    playerRules: createDefaultCharacterPlayerRules(),
    lorebooks,
    memory: [],
    storyEntities: createInitialStoryEntities(cardId, { cardKind: "character", cardCharacterName: name }),
    mapEnabled: false,
    alternateGreetings: normalized.alternateGreetings,
    creatorNotes: normalized.creatorNotes || undefined,
    tags: normalized.tags,
    creator: normalized.creator || undefined,
    characterVersion: normalized.characterVersion || undefined,
    avatarDataUrl: options.avatarDataUrl,
    importSource: source,
  };

  return { card, warnings };
}

// --- top-level import entry points -----------------------------------------

export function importCardFromPngBytes(bytes: Uint8Array, options: BuildCardOptions = {}): ImportedCard {
  if (bytes.byteLength > MAX_CARD_IMPORT_FILE_BYTES) {
    throw new Error("Character card file is too large (maximum 8 MiB).");
  }
  const jsonText = extractTavernJsonFromPng(bytes);
  if (!jsonText) {
    throw new Error("No character data found in this PNG. Export it as a Character Card (V2/V3) PNG first.");
  }
  const normalized = parseTavernCardJson(jsonText);
  return buildRuntimeCardFromTavern(normalized, { ...options, source: options.source ?? "tavern-png" });
}

export function importCardFromJsonText(text: string, options: BuildCardOptions = {}): ImportedCard {
  const normalized = parseTavernCardJson(text);
  return buildRuntimeCardFromTavern(normalized, { ...options, source: options.source ?? "tavern-json" });
}

async function readFileAsBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === "function") {
    return new Uint8Array(await file.arrayBuffer());
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(new Uint8Array(reader.result as ArrayBuffer)));
    reader.addEventListener("error", () => reject(new Error("Could not read the card file.")));
    reader.readAsArrayBuffer(file);
  });
}

async function resolveEmbeddedAvatar(
  bytes: Uint8Array,
  options: BuildCardOptions,
): Promise<EmbeddableAvatarResult | null> {
  if (options.avatarDataUrl) {
    return { dataUrl: options.avatarDataUrl, downscaled: false };
  }
  // Uint8Array.from re-copies onto a plain ArrayBuffer, which BlobPart requires.
  return buildEmbeddableAvatarDataUrl(new Blob([Uint8Array.from(bytes)], { type: "image/png" }));
}

function pushAvatarWarnings(result: ImportedCard, embedded: EmbeddableAvatarResult | null, options: BuildCardOptions): void {
  if (options.avatarDataUrl) {
    return;
  }
  if (!embedded) {
    result.warnings.push("Avatar image was too large to embed and was skipped.");
  } else if (embedded.downscaled) {
    result.warnings.push("Avatar image was downscaled to fit local storage limits.");
  }
}

export async function importCardFromFile(file: File, options: BuildCardOptions = {}): Promise<ImportedCard> {
  if (file.size > MAX_CARD_IMPORT_FILE_BYTES) {
    throw new Error("Character card file is too large (maximum 8 MiB).");
  }
  const isPng = /\.png$/i.test(file.name) || file.type === "image/png";
  if (isPng) {
    const bytes = await readFileAsBytes(file);
    const embedded = await resolveEmbeddedAvatar(bytes, options);
    const result = importCardFromPngBytes(bytes, { ...options, source: "tavern-png", avatarDataUrl: embedded?.dataUrl });
    pushAvatarWarnings(result, embedded, options);
    return result;
  }
  const text = await readFileAsText(file);
  return importCardFromJsonText(text, { ...options, source: "tavern-json" });
}

// --- Chub URL helper -------------------------------------------------------

export interface ChubReference {
  fullPath: string;
  downloadUrl: string;
}

/** Extracts an `author/name` fullPath from a Chub URL or bare path. */
export function parseChubReference(input: string): ChubReference | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  let fullPath = "";
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (url.protocol !== "https:" || (url.hostname !== "chub.ai" && url.hostname !== "www.chub.ai")) {
        return null;
      }
      const parts = url.pathname.split("/").filter(Boolean);
      const anchor = parts.findIndex((part) => part === "characters" || part === "lorebooks");
      const relevant = anchor >= 0 ? parts.slice(anchor + 1) : parts;
      if (relevant.length >= 2) {
        fullPath = `${relevant[0]}/${relevant[1]}`;
      }
    } catch {
      return null;
    }
  } else if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) {
    fullPath = trimmed;
  }

  if (!fullPath) {
    return null;
  }
  return { fullPath, downloadUrl: "https://api.chub.ai/api/characters/download" };
}

type ChubInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export interface FetchChubOptions extends BuildCardOptions {
  fetch?: typeof fetch;
  /** Test seam / desktop bridge for the Tauri `download_chub_character` command. */
  invoke?: ChubInvoke;
}

/**
 * Downloads a Chub character as a Tavern PNG and imports it. On the desktop app
 * the download is routed through the Rust `download_chub_character` command: the
 * webview CSP blocks `connect-src` to api.chub.ai, but a Rust reqwest call is not
 * subject to the webview CSP. In the browser preview it falls back to a direct
 * fetch (which may be blocked by CORS).
 */
export async function fetchChubCharacterCard(input: string, options: FetchChubOptions = {}): Promise<ImportedCard> {
  const reference = parseChubReference(input);
  if (!reference) {
    throw new Error("Enter a Chub character URL (https://chub.ai/characters/author/name) or an author/name path.");
  }

  const bytes = await downloadChubCardBytes(reference, options);
  const embedded = await resolveEmbeddedAvatar(bytes, options);
  const result = importCardFromPngBytes(bytes, {
    cardId: options.cardId,
    source: "chub",
    avatarDataUrl: embedded?.dataUrl,
  });
  pushAvatarWarnings(result, embedded, options);
  return result;
}

async function downloadChubCardBytes(reference: ChubReference, options: FetchChubOptions): Promise<Uint8Array> {
  const invoke = options.invoke ?? desktopChubInvoke();
  if (invoke) {
    const response = await invoke<{ base64Data: string }>("download_chub_character", {
      request: { fullPath: reference.fullPath },
    });
    return base64ToBytes(response.base64Data);
  }

  const fetchImpl = options.fetch ?? (typeof fetch !== "undefined" ? fetch : undefined);
  if (!fetchImpl) {
    throw new Error("Network fetch is not available in this environment.");
  }
  const response = await fetchImpl(reference.downloadUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fullPath: reference.fullPath, format: "tavern", version: "main" }),
  });
  if (!response.ok) {
    throw new Error(`Chub download failed (${response.status}). The card may be private or the path is wrong.`);
  }
  const declaredLength = Number(response.headers?.get?.("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CARD_IMPORT_FILE_BYTES) {
    throw new Error("Chub character exceeds the local size limit.");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_CARD_IMPORT_FILE_BYTES) {
    throw new Error("Chub character exceeds the local size limit.");
  }
  return bytes;
}

function desktopChubInvoke(): ChubInvoke | undefined {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return undefined;
  }
  return async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(command, args);
  };
}
