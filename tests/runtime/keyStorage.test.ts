import { describe, expect, it } from "vitest";

import {
  PlaintextKeyPersistenceError,
  RefusingPlaintextKeyStorage,
  TauriOsKeychainStorage,
  createSecretReference,
  parseSecretReference,
} from "../../src/security/keyStorage";

describe("key storage", () => {
  it("refuses to persist API keys in plaintext storage", async () => {
    const storage = new RefusingPlaintextKeyStorage();

    await expect(
      storage.storeSecret({
        providerId: "local",
        secretName: "apiKey",
        secretValue: "not-a-real-key",
      }),
    ).rejects.toBeInstanceOf(PlaintextKeyPersistenceError);
  });

  it("stores and deletes provider secrets through a narrow Tauri command surface", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const invoke = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
      calls.push({ command, args });
      if (command === "secure_storage_status") {
        return { available: true, storageKind: "os-keychain" } as T;
      }
      if (command === "store_provider_secret") {
        expect(args).toMatchObject({
          providerId: "openrouter",
          secretName: "apiKey",
          secretValue: "sk-test",
        });
        return {
          providerId: "openrouter",
          secretName: "apiKey",
          storageKind: "os-keychain",
          storageKey: "openrouter:apiKey",
        } as T;
      }
      if (command === "delete_provider_secret") {
        return undefined as T;
      }
      throw new Error(`unexpected command ${command}`);
    };
    const storage = new TauriOsKeychainStorage(invoke);

    await expect(storage.getStatus()).resolves.toMatchObject({ available: true, storageKind: "os-keychain" });
    const reference = await storage.storeSecret({
      providerId: "openrouter",
      secretName: "apiKey",
      secretValue: "sk-test",
    });
    await expect(storage.deleteSecret(reference)).resolves.toBeUndefined();
    expect(calls.map((call) => call.command)).toEqual([
      "secure_storage_status",
      "store_provider_secret",
      "delete_provider_secret",
    ]);
  });

  it("validates references and rejects memory-only persistent references", () => {
    expect(() => createSecretReference("provider", "apiKey", "memory-only", "provider:apiKey")).toThrow(
      PlaintextKeyPersistenceError,
    );
    expect(() => createSecretReference("a:b", "c", "os-keychain", "a:b:c")).toThrow(PlaintextKeyPersistenceError);
    expect(() => createSecretReference("provider", "apiKey", "os-keychain", "sk-this-looks-raw")).toThrow(
      PlaintextKeyPersistenceError,
    );
    expect(parseSecretReference({ providerId: "provider", secretName: "apiKey", storageKind: "os-keychain" })).toBeUndefined();
    expect(
      parseSecretReference({
        providerId: "provider",
        secretName: "apiKey",
        storageKind: "os-keychain",
        storageKey: "provider:apiKey",
        providerBaseUrl: "https://example.test/v1",
      }),
    ).toMatchObject({
      providerId: "provider",
      storageKind: "os-keychain",
      providerBaseUrl: "https://example.test/v1",
    });
  });
});
