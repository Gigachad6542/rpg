import type { ImageProviderSettings, ProviderSettings } from "./runtimeTypes";

function normalizeCredentialEndpoint(value: string): string {
  try {
    const url = new URL(value.trim());
    url.hash = "";
    url.search = "";
    url.username = "";
    url.password = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return value.trim().replace(/\/+$/, "");
  }
}

function normalizeIdentity(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Session credentials are valid only for the provider identity and endpoint at
 * the moment the user entered them. Model changes intentionally do not clear a
 * key because they remain within the same provider trust boundary.
 */
export function textProviderCredentialFingerprint(settings: ProviderSettings): string {
  return [
    settings.mode,
    normalizeIdentity(settings.providerId),
    normalizeCredentialEndpoint(settings.baseUrl),
  ].join("|");
}

export function imageProviderCredentialFingerprint(settings: ImageProviderSettings): string {
  return [
    settings.mode,
    normalizeIdentity(settings.providerId),
    normalizeCredentialEndpoint(settings.endpoint),
  ].join("|");
}
