import { describe, expect, it } from "vitest";

import {
  PlaintextKeyPersistenceError,
  RefusingPlaintextKeyStorage,
  TauriOsKeychainStorage,
  createSecretReference,
  parseSecretReference,
  requireSecureKeyStorage,
  validateSecretReference,
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

  it("reports plaintext storage status and treats deletion as a harmless no-op", async () => {
    const storage = new RefusingPlaintextKeyStorage();

    await expect(storage.getStatus()).resolves.toMatchObject({
      available: false,
      storageKind: "memory-only",
      reason: expect.stringMatching(/current session/i),
    });
    await expect(
      storage.deleteSecret({
        providerId: "provider",
        secretName: "apiKey",
        storageKind: "os-keychain",
        storageKey: "provider:apiKey",
      }),
    ).resolves.toBeUndefined();
    expect(requireSecureKeyStorage(storage)).toBe(storage);
  });

  it("sanitizes secure-storage command failures and validates secret inputs", async () => {
    const failingStorage = new TauriOsKeychainStorage(async (command) => {
      if (command === "secure_storage_status") {
        throw new Error("plain connection failure");
      }
      throw new Error("secret sk-very-private-token leaked by platform");
    });

    await expect(failingStorage.getStatus()).resolves.toMatchObject({
      available: false,
      reason: "plain connection failure",
    });
    await expect(
      failingStorage.storeSecret({ providerId: "provider", secretName: "apiKey", secretValue: "sk-test" }),
    ).rejects.toThrow(/without exposing the secret/i);
    await expect(
      failingStorage.deleteSecret({
        providerId: "provider",
        secretName: "apiKey",
        storageKind: "os-keychain",
        storageKey: "provider:apiKey",
      }),
    ).rejects.toThrow(/without exposing the secret/i);

    const storage = new TauriOsKeychainStorage(async () => {
      throw new Error("unexpected");
    });
    await expect(storage.storeSecret({ providerId: "provider", secretName: "apiKey", secretValue: "   " })).rejects.toThrow(
      /Secret value cannot be empty/i,
    );
    await expect(storage.storeSecret({ providerId: "bad provider", secretName: "apiKey", secretValue: "x" })).rejects.toThrow(
      /provider id can only contain/i,
    );
    await expect(
      storage.storeSecret({ providerId: "provider", secretName: "a".repeat(97), secretValue: "x" }),
    ).rejects.toThrow(/secret name is too long/i);
    expect(() =>
      validateSecretReference({
        providerId: "   ",
        secretName: "apiKey",
        storageKind: "os-keychain",
        storageKey: "provider:apiKey",
      }),
    ).toThrow(/provider id cannot be empty/i);
  });

  it("rejects unsupported or noncanonical secret references and invalid parsed shapes", () => {
    expect(() =>
      validateSecretReference({
        providerId: "provider",
        secretName: "apiKey",
        storageKind: "unknown" as "os-keychain",
        storageKey: "provider:apiKey",
      }),
    ).toThrow(/unsupported storage kind/i);
    expect(() =>
      validateSecretReference({
        providerId: "provider",
        secretName: "apiKey",
        storageKind: "os-keychain",
        storageKey: "other:apiKey",
      }),
    ).toThrow(/not canonical/i);
    expect(parseSecretReference(null)).toBeUndefined();
    expect(parseSecretReference([])).toBeUndefined();
    expect(
      parseSecretReference({
        providerId: "provider",
        secretName: "apiKey",
        storageKind: "memory-only",
        storageKey: "provider:apiKey",
      }),
    ).toBeUndefined();
  });

  it("uses Tauri key storage only when desktop internals are present", () => {
    const previousDescriptor = Object.getOwnPropertyDescriptor(window, "__TAURI_INTERNALS__");
    try {
      delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
      expect(requireSecureKeyStorage()).toBeInstanceOf(RefusingPlaintextKeyStorage);

      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        value: {},
        configurable: true,
      });
      expect(requireSecureKeyStorage()).toBeInstanceOf(TauriOsKeychainStorage);
    } finally {
      if (previousDescriptor) {
        Object.defineProperty(window, "__TAURI_INTERNALS__", previousDescriptor);
      } else {
        delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
      }
    }
  });

  it("refuses default Tauri command storage outside the desktop runtime", async () => {
    const previousDescriptor = Object.getOwnPropertyDescriptor(window, "__TAURI_INTERNALS__");
    try {
      delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
      const storage = new TauriOsKeychainStorage();

      await expect(
        storage.storeSecret({
          providerId: "provider",
          secretName: "apiKey",
          secretValue: "sk-test",
        }),
      ).rejects.toThrow(/without exposing the secret/i);
    } finally {
      if (previousDescriptor) {
        Object.defineProperty(window, "__TAURI_INTERNALS__", previousDescriptor);
      } else {
        delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
      }
    }
  });
});
