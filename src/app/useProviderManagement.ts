import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

import { fetchComfyUIImageModels } from "../providers/comfyUIProvider";
import type { KeyStorage, SecureStorageStatus } from "../security/keyStorage";
import { getErrorMessage } from "./appUtils";
import { createTextProvider } from "./providerConfig";
import {
  forgetStoredProviderKey,
  resolveComfyUiCheckpointState,
  saveProviderKeySecurely,
} from "./providerController";
import type { ImageProviderSettings, ProviderSettings, RuntimeCard } from "./runtimeTypes";

interface ProviderManagementInput {
  initialProviderKeyStatus: string;
  providerSettings: ProviderSettings;
  setProviderSettings: Dispatch<SetStateAction<ProviderSettings>>;
  imageProviderSettings: ImageProviderSettings;
  setImageProviderSettings: Dispatch<SetStateAction<ImageProviderSettings>>;
  providerTestCard: RuntimeCard | undefined;
  keyStorage: KeyStorage;
  desktopRuntime: boolean;
  onComfyUiReady?: () => void;
}

export function useProviderManagement(input: ProviderManagementInput) {
  const {
    initialProviderKeyStatus,
    providerSettings,
    setProviderSettings,
    imageProviderSettings,
    setImageProviderSettings,
    providerTestCard,
    keyStorage,
    desktopRuntime,
    onComfyUiReady,
  } = input;
  const [providerKeyStatus, setProviderKeyStatus] = useState(initialProviderKeyStatus);
  const [providerTestStatus, setProviderTestStatus] = useState("No provider test has run yet.");
  const [comfyUiCheckpointModels, setComfyUiCheckpointModels] = useState<string[]>([]);
  const [imageProviderStatus, setImageProviderStatus] = useState(
    "ComfyUI image model check has not run yet.",
  );
  const [sessionApiKey, setSessionApiKey] = useState("");
  const [imageSessionApiKey, setImageSessionApiKey] = useState("");
  const [secureStorageStatus, setSecureStorageStatus] = useState<SecureStorageStatus>({
    available: false,
    storageKind: "memory-only",
    reason: "Secure storage status has not been checked yet.",
  });
  const imageProviderSettingsRef = useRef(imageProviderSettings);
  imageProviderSettingsRef.current = imageProviderSettings;

  useEffect(() => {
    let cancelled = false;
    void keyStorage.getStatus().then((status) => {
      if (!cancelled) {
        setSecureStorageStatus(status);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [keyStorage]);

  useEffect(() => {
    let cancelled = false;
    const settings = imageProviderSettingsRef.current;

    if (settings.mode !== "comfyui") {
      setComfyUiCheckpointModels([]);
      setImageProviderStatus("Prompt-only image mode active.");
      return () => {
        cancelled = true;
      };
    }

    setImageProviderStatus("Checking ComfyUI startup requirements...");
    void fetchComfyUIImageModels({
      endpoint: settings.endpoint,
      apiKey: imageSessionApiKey,
    })
      .then((models) => {
        if (cancelled) {
          return;
        }
        const result = resolveComfyUiCheckpointState(imageProviderSettingsRef.current, models, "startup");
        setComfyUiCheckpointModels(models);
        setImageProviderSettings(result.settings);
        setImageProviderStatus(result.status);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setComfyUiCheckpointModels([]);
        setImageProviderStatus(`ComfyUI startup check failed: ${getErrorMessage(error)}`);
      });

    return () => {
      cancelled = true;
    };
  }, [
    imageSessionApiKey,
    imageProviderSettings.endpoint,
    imageProviderSettings.mode,
    imageProviderSettings.model,
    setImageProviderSettings,
  ]);

  function applyProviderKeySaveResult(result: Awaited<ReturnType<typeof saveProviderKeySecurely>>) {
    setProviderKeyStatus(result.status);
    if (result.secureStorageStatus) {
      setSecureStorageStatus(result.secureStorageStatus);
    }
    if (result.settings) {
      setProviderSettings(result.settings);
    }
    if (result.clearSessionApiKey) {
      setSessionApiKey("");
    }
  }

  function saveProviderKey(): Promise<void> {
    const operation = saveProviderKeySecurely({
      settings: providerSettings,
      sessionApiKey,
      keyStorage,
      desktopRuntime,
    });
    if (operation instanceof Promise) {
      return operation.then(applyProviderKeySaveResult);
    }
    applyProviderKeySaveResult(operation);
    return Promise.resolve();
  }

  function applyProviderKeyForgetResult(result: Awaited<ReturnType<typeof forgetStoredProviderKey>>) {
    setProviderKeyStatus(result.status);
    setProviderSettings(result.settings);
    if (result.clearSessionApiKey) {
      setSessionApiKey("");
    }
  }

  function forgetProviderKey(): Promise<void> {
    const operation = forgetStoredProviderKey(providerSettings, keyStorage);
    if (operation instanceof Promise) {
      return operation.then(applyProviderKeyForgetResult);
    }
    applyProviderKeyForgetResult(operation);
    return Promise.resolve();
  }

  async function testTextProvider() {
    setProviderTestStatus("Testing provider...");
    try {
      if (!providerTestCard) {
        throw new Error("Create or import a card before testing this provider.");
      }
      const provider = createTextProvider(
        providerSettings,
        sessionApiKey,
        providerTestCard,
        "Provider test",
        0,
      );
      const response = await provider.generateText({
        model: providerSettings.mode === "mock" ? "mock-narrator" : providerSettings.model,
        prompt: "Return a short provider health check response.",
        maxOutputTokens: 80,
        temperature: 0,
        metadata: { testOnly: true },
      });
      setProviderTestStatus(
        `Provider responded through ${response.providerId} / ${response.model}. Estimated tokens: ${response.usage.totalTokens}.`,
      );
    } catch (error) {
      setProviderTestStatus(getErrorMessage(error));
    }
  }

  async function refreshComfyUICheckpoints() {
    if (imageProviderSettings.mode !== "comfyui") {
      setComfyUiCheckpointModels([]);
      setImageProviderStatus("Prompt-only image mode active.");
      return;
    }

    setImageProviderStatus("Checking ComfyUI image models...");
    try {
      const models = await fetchComfyUIImageModels({
        endpoint: imageProviderSettings.endpoint,
        apiKey: imageSessionApiKey,
      });
      const result = resolveComfyUiCheckpointState(imageProviderSettings, models, "manual");
      setComfyUiCheckpointModels(models);
      setImageProviderSettings(result.settings);
      setImageProviderStatus(result.status);
      if (result.ready) {
        onComfyUiReady?.();
      }
    } catch (error) {
      setComfyUiCheckpointModels([]);
      setImageProviderStatus(`ComfyUI image model check failed: ${getErrorMessage(error)}`);
    }
  }

  return {
    providerKeyStatus,
    setProviderKeyStatus,
    providerTestStatus,
    comfyUiCheckpointModels,
    imageProviderStatus,
    sessionApiKey,
    setSessionApiKey,
    imageSessionApiKey,
    setImageSessionApiKey,
    secureStorageStatus,
    saveProviderKey,
    forgetProviderKey,
    testTextProvider,
    refreshComfyUICheckpoints,
  };
}
