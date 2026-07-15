import { describe, expect, it, vi } from "vitest";

import { defaultImageProviderSettings, defaultProviderSettings } from "../../src/app/appDefaults";
import {
  forgetStoredProviderKey,
  resolveComfyUiCheckpointState,
  saveProviderKeySecurely,
} from "../../src/app/providerController";
import type { KeyStorage } from "../../src/security/keyStorage";

function createKeyStorage(overrides: Partial<KeyStorage> = {}): KeyStorage {
  return {
    getStatus: vi.fn().mockResolvedValue({ available: true, storageKind: "os-keychain" }),
    storeSecret: vi.fn().mockResolvedValue({
      providerId: "alibaba-model-studio",
      secretName: "apiKey",
      storageKind: "os-keychain",
      storageKey: "local-first-rpg/alibaba-model-studio/apiKey",
    }),
    deleteSecret: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("providerController", () => {
  it("stores a hosted key and returns only its keychain reference", async () => {
    const keyStorage = createKeyStorage();
    const settings = {
      ...defaultProviderSettings,
      mode: "openai-compatible" as const,
      providerId: "alibaba-model-studio",
      baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    };

    const result = await saveProviderKeySecurely({
      settings,
      sessionApiKey: "secret-value",
      keyStorage,
      desktopRuntime: true,
    });

    expect(keyStorage.storeSecret).toHaveBeenCalledWith({
      providerId: "alibaba-model-studio",
      secretName: "apiKey",
      secretValue: "secret-value",
    });
    expect(result.clearSessionApiKey).toBe(true);
    expect(result.settings?.secretReference).toMatchObject({
      storageKind: "os-keychain",
      providerBaseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    });
    expect(JSON.stringify(result)).not.toContain("secret-value");
  });

  it("keeps an entered key session-only when secure storage is unavailable", async () => {
    const keyStorage = createKeyStorage({
      getStatus: vi.fn().mockResolvedValue({
        available: false,
        storageKind: "memory-only",
        reason: "keychain locked",
      }),
    });
    const settings = {
      ...defaultProviderSettings,
      mode: "openai-compatible" as const,
      providerId: "alibaba-model-studio",
      baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    };

    const result = await saveProviderKeySecurely({
      settings,
      sessionApiKey: "session-only",
      keyStorage,
      desktopRuntime: false,
    });

    expect(keyStorage.storeSecret).not.toHaveBeenCalled();
    expect(result.clearSessionApiKey).toBe(false);
    expect(result.status).toContain("Session key active in memory only");
    expect(result.secureStorageStatus?.reason).toBe("keychain locked");
  });

  it("forgets a keychain reference without mutating unrelated settings", async () => {
    const keyStorage = createKeyStorage();
    const settings = {
      ...defaultProviderSettings,
      secretReference: {
        providerId: "alibaba-model-studio",
        secretName: "apiKey",
        storageKind: "os-keychain" as const,
        storageKey: "local-first-rpg/alibaba-model-studio/apiKey",
      },
    };

    const result = await forgetStoredProviderKey(settings, keyStorage);

    expect(keyStorage.deleteSecret).toHaveBeenCalledWith(settings.secretReference);
    expect(result.settings.secretReference).toBeUndefined();
    expect(result.settings.model).toBe(settings.model);
    expect(result.clearSessionApiKey).toBe(true);
  });

  it("selects a visible ComfyUI checkpoint and reports the effective model", () => {
    const result = resolveComfyUiCheckpointState(
      { ...defaultImageProviderSettings, model: "missing.safetensors" },
      ["flux2.safetensors", "other.safetensors"],
      "manual",
    );

    expect(result.settings.model).toBe("flux2.safetensors");
    expect(result.status).toContain("selected installed image model flux2.safetensors");
    expect(result.ready).toBe(true);
  });
});
