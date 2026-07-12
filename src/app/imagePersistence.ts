export interface PersistGeneratedImageDeps {
  fetchImpl?: typeof fetch;
  invokeImpl?: <T>(command: string, args: Record<string, unknown>) => Promise<T>;
  convertFileSrcImpl?: (path: string) => string;
}

export async function syncGeneratedImageFiles(
  activeArtifactIds: string[],
  deps: Pick<PersistGeneratedImageDeps, "invokeImpl"> = {},
): Promise<number> {
  try {
    const invokeImpl = deps.invokeImpl ?? (await import("@tauri-apps/api/core")).invoke;
    const removed = await invokeImpl<number>("sync_generated_image_files", { activeArtifactIds });
    return typeof removed === "number" && Number.isFinite(removed) ? removed : 0;
  } catch {
    return 0;
  }
}

const FORMAT_BY_MIME_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
};

/**
 * Downloads a freshly generated image from the local image provider and asks
 * the desktop backend to persist the bytes under app data, returning a durable
 * asset URL. Provider URLs (for example ComfyUI /view links) stop working when
 * the provider restarts or clears its output folder, so desktop artifacts must
 * not rely on them. Fails open with null so callers keep the provider URL.
 */
export async function persistGeneratedImageLocally(
  artifactId: string,
  imageUrl: string,
  deps: PersistGeneratedImageDeps = {},
): Promise<string | null> {
  const fetchImpl = deps.fetchImpl ?? fetch;

  try {
    const tauriCore = deps.invokeImpl && deps.convertFileSrcImpl
      ? null
      : await import("@tauri-apps/api/core");
    const invokeImpl = deps.invokeImpl ?? tauriCore?.invoke;
    const convertFileSrcImpl = deps.convertFileSrcImpl ?? tauriCore?.convertFileSrc;
    if (!invokeImpl || !convertFileSrcImpl) return null;
    const response = await fetchImpl(imageUrl);
    if (!response.ok) {
      return null;
    }
    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    // Derive the format from the actual bytes so the persisted extension always
    // matches the payload — providers such as ComfyUI's /view endpoint do not
    // always set a Content-Type. Fall back to the declared MIME type, and bail
    // (keeping the provider URL) when the bytes are not a recognized image, so we
    // never write mislabeled data.
    const format = detectImageFormat(bytes) ?? FORMAT_BY_MIME_TYPE[blob.type];
    if (!format) {
      return null;
    }
    const base64Data = arrayBufferToBase64(buffer);
    if (!base64Data) {
      return null;
    }
    const savedPath = await invokeImpl<string>("persist_generated_image", {
      artifactId,
      format,
      base64Data,
    });
    if (typeof savedPath !== "string" || !savedPath) {
      return null;
    }
    return convertFileSrcImpl(savedPath);
  } catch {
    return null;
  }
}

/**
 * Sniffs the leading magic bytes of a decoded image, returning the canonical
 * format name the desktop backend expects, or undefined when the bytes are not a
 * recognized PNG/JPEG/WebP payload. Keeping this in sync with the backend's
 * magic-byte guard means a legitimately generated image never mismatches its
 * declared extension.
 */
function detectImageFormat(bytes: Uint8Array): string | undefined {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 && // "RIFF"
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50 // "WEBP"
  ) {
    return "webp";
  }
  return undefined;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return binary ? btoa(binary) : "";
}
