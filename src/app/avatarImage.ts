// Embedded-avatar budget enforcement. The Rust persistence layer rejects any
// single string over 200,000 chars (MAX_TEXT_CHARS in
// src-tauri/src/runtime_repository.rs), so every avatar data URL that reaches
// a snapshot must stay safely under that cap — otherwise one oversized image
// makes every subsequent SQLite save fail.

/** Hard ceiling for any persisted avatar data URL, with margin under the Rust 200k-char cap. */
export const MAX_EMBEDDED_AVATAR_DATA_URL_CHARS = 190_000;

/** Raw image bytes whose base64 data URL stays within the embed budget. */
export const AVATAR_MAX_EMBED_BYTES = Math.floor(((MAX_EMBEDDED_AVATAR_DATA_URL_CHARS - 64) / 4) * 3);

export function fitsEmbeddedAvatarBudget(dataUrl: unknown): dataUrl is string {
  return typeof dataUrl === "string" && dataUrl.length <= MAX_EMBEDDED_AVATAR_DATA_URL_CHARS;
}

export interface EmbeddableAvatarResult {
  dataUrl: string;
  downscaled: boolean;
}

type EncodeScaledImage = (source: Blob, maxDimension: number, quality: number) => Promise<string | null>;

const DOWNSCALE_LADDER: Array<{ maxDimension: number; quality: number }> = [
  { maxDimension: 512, quality: 0.85 },
  { maxDimension: 384, quality: 0.8 },
  { maxDimension: 256, quality: 0.75 },
  { maxDimension: 160, quality: 0.7 },
];

/**
 * Produces a data URL that fits the embed budget: the raw image when small
 * enough, otherwise a canvas-downscaled re-encode. Returns null when nothing
 * fits (or downscaling is unavailable, e.g. outside a browser/webview).
 */
export async function buildEmbeddableAvatarDataUrl(
  source: Blob,
  encode: EncodeScaledImage = encodeScaledImage,
): Promise<EmbeddableAvatarResult | null> {
  const raw = await blobToDataUrl(source);
  if (fitsEmbeddedAvatarBudget(raw)) {
    return { dataUrl: raw, downscaled: false };
  }
  for (const step of DOWNSCALE_LADDER) {
    const scaled = await encode(source, step.maxDimension, step.quality).catch(() => null);
    if (scaled && fitsEmbeddedAvatarBudget(scaled)) {
      return { dataUrl: scaled, downscaled: true };
    }
  }
  return null;
}

function blobToDataUrl(source: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(new Error("Could not read the image file.")));
    reader.readAsDataURL(source);
  });
}

async function encodeScaledImage(source: Blob, maxDimension: number, quality: number): Promise<string | null> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    return null;
  }
  try {
    const bitmap = await createImageBitmap(source);
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return null;
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL("image/webp", quality);
  } catch {
    return null;
  }
}
