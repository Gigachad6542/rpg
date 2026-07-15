import type { KeyStorage, SecureStorageStatus } from "../security/keyStorage";
import { getErrorMessage } from "./appUtils";
import { getAllowedProviderBaseUrl } from "./providerConfig";
import type { ImageProviderSettings, ProviderSettings } from "./runtimeTypes";

export type ProviderKeySaveResult = {
  status: string;
  settings?: ProviderSettings;
  secureStorageStatus?: SecureStorageStatus;
  clearSessionApiKey: boolean;
};

export function saveProviderKeySecurely(input: {
  settings: ProviderSettings;
  sessionApiKey: string;
  keyStorage: KeyStorage;
  desktopRuntime: boolean;
}): ProviderKeySaveResult | Promise<ProviderKeySaveResult> {
  const { settings, sessionApiKey, desktopRuntime } = input;
  if (settings.mode === "mock") {
    return { status: "Mock provider active; no API key needed.", clearSessionApiKey: false };
  }

  if (settings.providerId === "local" && !sessionApiKey.trim()) {
    return {
      status: "Local OpenAI-compatible endpoint active without a stored API key.",
      clearSessionApiKey: false,
    };
  }

  if (!sessionApiKey.trim()) {
    return {
      status: settings.secretReference
        ? "Stored OS keychain reference active. The raw key is not saved in local app data."
        : desktopRuntime && settings.providerId !== "local"
          ? "Store this hosted provider key in the OS keychain before generation."
          : "Enter a session API key to use the OpenAI-compatible provider path.",
      clearSessionApiKey: false,
    };
  }

  if (settings.providerId === "local") {
    return {
      status: "Local OpenAI-compatible endpoint active with a memory-only session key.",
      clearSessionApiKey: false,
    };
  }

  return saveHostedProviderKey(input);
}

async function saveHostedProviderKey(input: {
  settings: ProviderSettings;
  sessionApiKey: string;
  keyStorage: KeyStorage;
  desktopRuntime: boolean;
}): Promise<ProviderKeySaveResult> {
  const { settings, sessionApiKey, keyStorage, desktopRuntime } = input;
  const secureStorageStatus = await keyStorage.getStatus();
  if (!secureStorageStatus.available) {
    const reason = secureStorageStatus.reason ?? "desktop keychain unavailable";
    return {
      status: desktopRuntime
        ? `Store this hosted provider key in the OS keychain before generation. Secure storage unavailable: ${reason}`
        : `Session key active in memory only; secure storage unavailable: ${reason}`,
      secureStorageStatus,
      clearSessionApiKey: false,
    };
  }

  try {
    const normalizedBaseUrl = getAllowedProviderBaseUrl(settings);
    if (!normalizedBaseUrl) {
      return {
        status: "Provider endpoint must be the known hosted URL or a loopback local endpoint.",
        secureStorageStatus,
        clearSessionApiKey: false,
      };
    }
    const reference = await keyStorage.storeSecret({
      providerId: settings.providerId,
      secretName: "apiKey",
      secretValue: sessionApiKey.trim(),
    });
    return {
      status: "API key stored in OS keychain. Only a secret reference is saved locally.",
      settings: {
        ...settings,
        secretReference: {
          ...reference,
          providerBaseUrl: normalizedBaseUrl,
        },
      },
      secureStorageStatus,
      clearSessionApiKey: true,
    };
  } catch (error) {
    return {
      status: getErrorMessage(error),
      secureStorageStatus,
      clearSessionApiKey: false,
    };
  }
}

export type ProviderKeyForgetResult = {
  status: string;
  settings: ProviderSettings;
  clearSessionApiKey: boolean;
};

export function forgetStoredProviderKey(
  settings: ProviderSettings,
  keyStorage: KeyStorage,
): ProviderKeyForgetResult | Promise<ProviderKeyForgetResult> {
  if (!settings.secretReference) {
    return {
      status: "No stored provider key reference to forget.",
      settings,
      clearSessionApiKey: true,
    };
  }

  return deleteStoredProviderKey(settings, settings.secretReference, keyStorage);
}

async function deleteStoredProviderKey(
  settings: ProviderSettings,
  secretReference: NonNullable<ProviderSettings["secretReference"]>,
  keyStorage: KeyStorage,
): Promise<ProviderKeyForgetResult> {
  try {
    await keyStorage.deleteSecret(secretReference);
    const { secretReference: _secretReference, ...settingsWithoutReference } = settings;
    return {
      status: "Stored provider key reference removed.",
      settings: settingsWithoutReference,
      clearSessionApiKey: true,
    };
  } catch (error) {
    return {
      status: getErrorMessage(error),
      settings,
      clearSessionApiKey: false,
    };
  }
}

export function resolveComfyUiCheckpointState(
  settings: ImageProviderSettings,
  models: string[],
  source: "startup" | "manual",
): {
  settings: ImageProviderSettings;
  status: string;
  ready: boolean;
} {
  if (models.length === 0) {
    return {
      settings,
      status:
        "ComfyUI is reachable, but no image diffusion models are visible. Install a FLUX.2 model in models/diffusion_models, then refresh ComfyUI.",
      ready: false,
    };
  }

  const sourceLabel = source === "startup" ? "Startup check" : "Image model refresh";
  if (models.includes(settings.model)) {
    return {
      settings,
      status: `${sourceLabel} ready: ${models.length} image model${models.length === 1 ? "" : "s"} visible. Selected ${settings.model}.`,
      ready: true,
    };
  }

  const installedModel = models[0];
  return {
    settings: settings.mode === "comfyui" ? { ...settings, model: installedModel } : settings,
    status: `${sourceLabel} ready: selected installed image model ${installedModel} because the saved model was not visible to ComfyUI.`,
    ready: true,
  };
}
