import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export interface PersistGeneratedImageDeps {
  fetchImpl?: typeof fetch;
  invokeImpl?: <T>(command: string, args: Record<string, unknown>) => Promise<T>;
  convertFileSrcImpl?: (path: string) => string;
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
  const invokeImpl = deps.invokeImpl ?? invoke;
  const convertFileSrcImpl = deps.convertFileSrcImpl ?? convertFileSrc;

  try {
    const response = await fetchImpl(imageUrl);
    if (!response.ok) {
      return null;
    }
    const blob = await response.blob();
    const format = FORMAT_BY_MIME_TYPE[blob.type] ?? "png";
    const base64Data = arrayBufferToBase64(await blob.arrayBuffer());
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

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return binary ? btoa(binary) : "";
}
