export type SecureStorageKind = "os-keychain" | "tauri-stronghold" | "external-vault" | "memory-only";

export interface SecretReference {
  providerId: string;
  secretName: string;
  storageKind: SecureStorageKind;
  storageKey: string;
  providerBaseUrl?: string;
}

export interface StoreSecretRequest {
  providerId: string;
  secretName: string;
  secretValue: string;
}

export interface SecureStorageStatus {
  available: boolean;
  storageKind: SecureStorageKind;
  reason?: string;
}

export interface KeyStorage {
  getStatus(): Promise<SecureStorageStatus>;
  storeSecret(request: StoreSecretRequest): Promise<SecretReference>;
  deleteSecret(reference: SecretReference): Promise<void>;
}

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export class PlaintextKeyPersistenceError extends Error {
  constructor(message = "Plaintext API key persistence is not permitted. Use OS keychain or a secure vault.") {
    super(message);
    this.name = "PlaintextKeyPersistenceError";
  }
}

export class RefusingPlaintextKeyStorage implements KeyStorage {
  async getStatus(): Promise<SecureStorageStatus> {
    return {
      available: false,
      storageKind: "memory-only",
      reason: "This runtime can only keep API keys in memory for the current session.",
    };
  }

  async storeSecret(_request: StoreSecretRequest): Promise<SecretReference> {
    throw new PlaintextKeyPersistenceError();
  }

  async deleteSecret(_reference: SecretReference): Promise<void> {
    return Promise.resolve();
  }
}

export class TauriOsKeychainStorage implements KeyStorage {
  constructor(private readonly invokeImpl: TauriInvoke = invokeTauriCommand) {}

  async getStatus(): Promise<SecureStorageStatus> {
    try {
      const status = await this.invokeImpl<TauriSecureStorageStatus>("secure_storage_status");
      return {
        available: status.available,
        storageKind: status.storageKind,
        reason: status.reason ?? undefined,
      };
    } catch (error) {
      return {
        available: false,
        storageKind: "memory-only",
        reason: sanitizeSecretError(error),
      };
    }
  }

  async storeSecret(request: StoreSecretRequest): Promise<SecretReference> {
    validateSecretInput(request.providerId, "provider id");
    validateSecretInput(request.secretName, "secret name");
    if (!request.secretValue.trim()) {
      throw new PlaintextKeyPersistenceError("Secret value cannot be empty.");
    }

    const reference = await this.invokeImpl<SecretReference>("store_provider_secret", {
      providerId: request.providerId,
      secretName: request.secretName,
      secretValue: request.secretValue,
    }).catch((error) => {
      throw new PlaintextKeyPersistenceError(sanitizeSecretError(error));
    });
    return validateSecretReference(reference);
  }

  async deleteSecret(reference: SecretReference): Promise<void> {
    const validated = validateSecretReference(reference);
    await this.invokeImpl<void>("delete_provider_secret", {
      providerId: validated.providerId,
      secretName: validated.secretName,
      storageKey: validated.storageKey,
    }).catch((error) => {
      throw new PlaintextKeyPersistenceError(sanitizeSecretError(error));
    });
  }
}

export function createSecretReference(
  providerId: string,
  secretName: string,
  storageKind: SecureStorageKind,
  storageKey: string,
): SecretReference {
  if (storageKind === "memory-only") {
    throw new PlaintextKeyPersistenceError("Memory-only key storage cannot be used as a persistent secret reference.");
  }

  return validateSecretReference({
    providerId,
    secretName,
    storageKind,
    storageKey,
  });
}

export function requireSecureKeyStorage(storage?: KeyStorage): KeyStorage {
  return storage ?? (isTauriRuntime() ? new TauriOsKeychainStorage() : new RefusingPlaintextKeyStorage());
}

export function validateSecretReference(reference: SecretReference): SecretReference {
  const providerId = validateSecretComponent(reference.providerId, "provider id");
  const secretName = validateSecretComponent(reference.secretName, "secret name");
  const storageKey = validateStorageKey(reference.storageKey, providerId, secretName);
  if (!["os-keychain", "tauri-stronghold", "external-vault", "memory-only"].includes(reference.storageKind)) {
    throw new PlaintextKeyPersistenceError("Secret reference uses an unsupported storage kind.");
  }
  if (reference.storageKind === "memory-only") {
    throw new PlaintextKeyPersistenceError("Memory-only key storage cannot be used as a persistent secret reference.");
  }

  return {
    providerId,
    secretName,
    storageKind: reference.storageKind,
    storageKey,
    providerBaseUrl: sanitizeProviderBaseUrl(reference.providerBaseUrl),
  };
}

export function parseSecretReference(value: unknown): SecretReference | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    typeof (value as Partial<SecretReference>).providerId !== "string" ||
    typeof (value as Partial<SecretReference>).secretName !== "string" ||
    typeof (value as Partial<SecretReference>).storageKind !== "string" ||
    typeof (value as Partial<SecretReference>).storageKey !== "string"
  ) {
    return undefined;
  }

  try {
    const candidate = value as SecretReference;
    return validateSecretReference({
      providerId: candidate.providerId,
      secretName: candidate.secretName,
      storageKind: candidate.storageKind,
      storageKey: candidate.storageKey,
      providerBaseUrl: candidate.providerBaseUrl,
    });
  } catch {
    return undefined;
  }
}

function validateSecretInput(value: string, label: string): void {
  validateSecretComponent(value, label);
}

function validateSecretComponent(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new PlaintextKeyPersistenceError(`${label} cannot be empty.`);
  }
  if (trimmed.length > 96) {
    throw new PlaintextKeyPersistenceError(`${label} is too long.`);
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(trimmed)) {
    throw new PlaintextKeyPersistenceError(
      `${label} can only contain letters, numbers, dashes, underscores, or periods.`,
    );
  }
  return trimmed;
}

function validateStorageKey(storageKey: string, providerId: string, secretName: string): string {
  const trimmed = storageKey.trim();
  if (looksLikeRawSecret(trimmed)) {
    throw new PlaintextKeyPersistenceError("Secret reference storage key cannot look like a raw secret.");
  }

  const expected = `${providerId}:${secretName}`;
  if (trimmed !== expected) {
    throw new PlaintextKeyPersistenceError("Secret reference storage key is not canonical for its provider.");
  }
  return trimmed;
}

function sanitizeProviderBaseUrl(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function looksLikeRawSecret(value: string): boolean {
  return /(?:sk-[A-Za-z0-9_-]{6,}|[A-Za-z0-9_-]{40,})/.test(value);
}

async function invokeTauriCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) {
    throw new PlaintextKeyPersistenceError("OS keychain storage is available only in the desktop app.");
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

interface TauriSecureStorageStatus {
  available: boolean;
  storageKind: SecureStorageKind;
  reason?: string | null;
}

function sanitizeSecretError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/key|token|secret|authorization/i.test(message)) {
    return "Secure storage failed without exposing the secret value.";
  }
  return message || "Secure storage failed.";
}
