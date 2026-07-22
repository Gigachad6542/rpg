import { parseImageProviderSettings, parseProviderSettings } from "./providerConfig";
import type { ImageProviderSettings, ProviderSettings } from "./runtimeTypes";

export interface RuntimeProviderChangeReview {
  label: "Text provider" | "Image provider";
  before: string;
  after: string;
}

function textProviderIdentity(settings: ProviderSettings): string {
  return `${settings.providerId} / ${settings.model} at ${settings.baseUrl}`;
}

function imageProviderIdentity(settings: ImageProviderSettings): string {
  return `${settings.providerId} / ${settings.model} (${settings.mode}) at ${settings.endpoint}`;
}

export function buildRuntimeProviderChangeReview(input: {
  currentProviderSettings: ProviderSettings;
  currentImageProviderSettings: ImageProviderSettings;
  importedProviderSettings?: Record<string, unknown>;
  importedImageProviderSettings?: Record<string, unknown>;
}): RuntimeProviderChangeReview[] {
  const importedProvider = parseProviderSettings(input.importedProviderSettings);
  const importedImageProvider = parseImageProviderSettings(input.importedImageProviderSettings);
  const currentProvider = textProviderIdentity(input.currentProviderSettings);
  const nextProvider = textProviderIdentity(importedProvider);
  const currentImageProvider = imageProviderIdentity(input.currentImageProviderSettings);
  const nextImageProvider = imageProviderIdentity(importedImageProvider);
  const changes: RuntimeProviderChangeReview[] = [];

  if (currentProvider !== nextProvider) {
    changes.push({ label: "Text provider", before: currentProvider, after: nextProvider });
  }
  if (currentImageProvider !== nextImageProvider) {
    changes.push({ label: "Image provider", before: currentImageProvider, after: nextImageProvider });
  }
  return changes;
}
