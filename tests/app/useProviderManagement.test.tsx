import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchComfyUIImageModels } from "../../src/providers/comfyUIProvider";
import {
  defaultImageProviderSettings,
  defaultProviderSettings,
  initialCards,
} from "../../src/app/appDefaults";
import { useProviderManagement } from "../../src/app/useProviderManagement";
import type { ImageProviderSettings, ProviderSettings } from "../../src/app/runtimeTypes";
import type { KeyStorage } from "../../src/security/keyStorage";

vi.mock("../../src/providers/comfyUIProvider", () => ({
  fetchComfyUIImageModels: vi.fn(),
}));

const fetchComfyUIImageModelsMock = vi.mocked(fetchComfyUIImageModels);

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

describe("useProviderManagement", () => {
  beforeEach(() => {
    fetchComfyUIImageModelsMock.mockReset();
  });

  it("keeps a hosted key memory-only until secure storage returns a reference", async () => {
    const keyStorage = createKeyStorage();
    const hostedSettings = {
      ...defaultProviderSettings,
      mode: "openai-compatible" as const,
      providerId: "alibaba-model-studio",
      baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    };

    const { result } = renderHook(() => {
      const [providerSettings, setProviderSettings] = useState<ProviderSettings>(hostedSettings);
      const [imageProviderSettings, setImageProviderSettings] = useState<ImageProviderSettings>({
        ...defaultImageProviderSettings,
        mode: "prompt-only" as const,
      });
      const management = useProviderManagement({
        initialProviderKeyStatus: "No key stored.",
        providerSettings,
        setProviderSettings,
        imageProviderSettings,
        setImageProviderSettings,
        providerTestCard: initialCards[0],
        keyStorage,
        desktopRuntime: true,
      });
      return { management, providerSettings };
    });

    act(() => result.current.management.setSessionApiKey("secret-value"));
    await act(async () => result.current.management.saveProviderKey());

    expect(keyStorage.storeSecret).toHaveBeenCalledWith(expect.objectContaining({ secretValue: "secret-value" }));
    expect(result.current.providerSettings.secretReference).toMatchObject({ storageKind: "os-keychain" });
    expect(result.current.management.sessionApiKey).toBe("");
    expect(result.current.management.providerKeyStatus).toContain("Only a secret reference");
    expect(JSON.stringify(result.current.providerSettings)).not.toContain("secret-value");
  });

  it("reports prompt-only image mode without contacting ComfyUI", async () => {
    const keyStorage = createKeyStorage();
    const { result } = renderHook(() => {
      const [providerSettings, setProviderSettings] = useState<ProviderSettings>(defaultProviderSettings);
      const [imageProviderSettings, setImageProviderSettings] = useState<ImageProviderSettings>({
        ...defaultImageProviderSettings,
        mode: "prompt-only" as const,
      });
      return useProviderManagement({
        initialProviderKeyStatus: "Mock provider active.",
        providerSettings,
        setProviderSettings,
        imageProviderSettings,
        setImageProviderSettings,
        providerTestCard: initialCards[0],
        keyStorage,
        desktopRuntime: false,
      });
    });

    await waitFor(() => expect(result.current.secureStorageStatus.available).toBe(true));
    expect(result.current.imageProviderStatus).toBe("Prompt-only image mode active.");
    expect(result.current.comfyUiCheckpointModels).toEqual([]);
    expect(fetchComfyUIImageModelsMock).not.toHaveBeenCalled();
  });

  it("normalizes the saved ComfyUI model against startup discovery", async () => {
    fetchComfyUIImageModelsMock.mockResolvedValue(["flux2.safetensors", "other.safetensors"]);
    const keyStorage = createKeyStorage();
    const { result } = renderHook(() => {
      const [providerSettings, setProviderSettings] = useState<ProviderSettings>(defaultProviderSettings);
      const [imageProviderSettings, setImageProviderSettings] = useState<ImageProviderSettings>({
        ...defaultImageProviderSettings,
        model: "missing.safetensors",
      });
      const management = useProviderManagement({
        initialProviderKeyStatus: "Mock provider active.",
        providerSettings,
        setProviderSettings,
        imageProviderSettings,
        setImageProviderSettings,
        providerTestCard: initialCards[0],
        keyStorage,
        desktopRuntime: false,
      });
      return { management, imageProviderSettings, setImageProviderSettings };
    });

    await waitFor(() => expect(result.current.imageProviderSettings.model).toBe("flux2.safetensors"));
    expect(result.current.management.comfyUiCheckpointModels).toEqual([
      "flux2.safetensors",
      "other.safetensors",
    ]);
    expect(result.current.management.imageProviderStatus).toContain("Startup check ready");

    await waitFor(() => expect(fetchComfyUIImageModelsMock).toHaveBeenCalledTimes(2));
    act(() => result.current.setImageProviderSettings((current) => ({ ...current, steps: 1, cfg: 1 })));
    expect(fetchComfyUIImageModelsMock).toHaveBeenCalledTimes(2);
  });

  it("does not commit ComfyUI startup discovery after unmount", async () => {
    let resolveStartup!: (models: string[]) => void;
    const startupRequest = new Promise<string[]>((resolve) => {
      resolveStartup = resolve;
    });
    fetchComfyUIImageModelsMock.mockReturnValue(startupRequest);
    const setImageProviderSettings = vi.fn();

    const { unmount } = renderHook(() =>
      useProviderManagement({
        initialProviderKeyStatus: "Mock provider active.",
        providerSettings: defaultProviderSettings,
        setProviderSettings: vi.fn(),
        imageProviderSettings: {
          ...defaultImageProviderSettings,
          model: "missing.safetensors",
        },
        setImageProviderSettings,
        providerTestCard: initialCards[0],
        keyStorage: createKeyStorage(),
        desktopRuntime: false,
      }),
    );

    await waitFor(() => expect(fetchComfyUIImageModelsMock).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => {
      resolveStartup(["late-model.safetensors"]);
      await startupRequest;
    });

    expect(setImageProviderSettings).not.toHaveBeenCalled();
  });
});
