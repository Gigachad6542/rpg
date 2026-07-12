/**
 * Returns a trimmed, parseable URL only when its authority contains no
 * username/password material. Persisted endpoint settings must never become a
 * second credential store through URL userinfo.
 */
export function sanitizeCredentialFreeUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const url = new URL(trimmed);
    return url.username || url.password ? undefined : trimmed;
  } catch {
    return undefined;
  }
}
