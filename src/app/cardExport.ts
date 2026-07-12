import type { RuntimeCard } from "./runtimeTypes";
import { buildChubLorebookPayload } from "./lorebookIo";
import { slugify } from "./appUtils";

const FALLBACK_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

export function buildTavernCardV2Payload(card: RuntimeCard): Record<string, unknown> {
  const characterBook = buildCombinedCharacterBook(card);
  return {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: card.characterName || card.name,
      description: card.characterDescription || card.summary,
      personality: "",
      scenario: card.scenario,
      first_mes: card.greeting,
      mes_example: card.exampleDialogs,
      creator_notes: card.creatorNotes ?? card.summary,
      system_prompt: card.systemPrompt,
      post_history_instructions: card.postHistoryInstructions,
      alternate_greetings: card.alternateGreetings ?? [],
      tags: card.tags ?? [],
      creator: card.creator ?? "",
      character_version: card.characterVersion ?? "",
      ...(characterBook ? { character_book: characterBook } : {}),
      extensions: {
        local_cards: {
          source_card_id: card.id,
          card_kind: card.kind,
          pre_history_instructions: card.preHistoryInstructions,
          player_rules: card.playerRules,
          rpg: card.rpg,
        },
      },
    },
  };
}

export function buildTavernCardJson(card: RuntimeCard): string {
  return JSON.stringify(buildTavernCardV2Payload(card), null, 2);
}

export function buildTavernCardPng(card: RuntimeCard): Uint8Array {
  const sourcePng = readPngAvatar(card.avatarDataUrl) ?? base64ToBytes(FALLBACK_PNG_BASE64);
  const jsonBytes = new TextEncoder().encode(buildTavernCardJson(card));
  const encodedJson = bytesToBase64(jsonBytes);
  const textData = new TextEncoder().encode(`chara\0${encodedJson}`);
  const textChunk = createPngChunk("tEXt", textData);
  const iendOffset = findPngIendOffset(sourcePng);
  const output = new Uint8Array(sourcePng.length + textChunk.length);
  output.set(sourcePng.subarray(0, iendOffset), 0);
  output.set(textChunk, iendOffset);
  output.set(sourcePng.subarray(iendOffset), iendOffset + textChunk.length);
  return output;
}

export function exportRuntimeCard(card: RuntimeCard, format: "json" | "png"): void {
  const data = format === "json" ? buildTavernCardJson(card) : buildTavernCardPng(card);
  const blobPart = typeof data === "string" ? data : data.slice().buffer as ArrayBuffer;
  const blob = new Blob([blobPart], { type: format === "json" ? "application/json" : "image/png" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${slugify(card.name || "character-card")}.card.${format}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function buildCombinedCharacterBook(card: RuntimeCard): Record<string, unknown> | undefined {
  const lorebooks = card.lorebooks.filter((lorebook) => lorebook.enabled);
  if (lorebooks.length === 0) return undefined;
  const first = buildChubLorebookPayload(lorebooks[0], card);
  return {
    ...first,
    name: lorebooks.length === 1 ? lorebooks[0].name : `${card.name} lorebooks`,
    entries: lorebooks.flatMap((lorebook) => buildChubLorebookPayload(lorebook, card).entries),
  };
}

function readPngAvatar(dataUrl: string | undefined): Uint8Array | null {
  if (!dataUrl?.startsWith("data:image/png;base64,")) return null;
  try {
    return base64ToBytes(dataUrl.slice(dataUrl.indexOf(",") + 1));
  } catch {
    return null;
  }
}

function findPngIendOffset(bytes: Uint8Array): number {
  if (bytes.length < 20 || String.fromCharCode(...bytes.subarray(1, 4)) !== "PNG") {
    throw new Error("Card avatar is not a valid PNG.");
  }
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
    if (type === "IEND") return offset;
    offset += 12 + length;
  }
  throw new Error("Card PNG is missing its IEND chunk.");
}

function createPngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(12 + data.length);
  writeUint32(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  writeUint32(chunk, 8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0);
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}
