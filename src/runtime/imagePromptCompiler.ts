export interface ImagePromptCharacter {
  name: string;
  appearance: string;
  pose?: string;
  position?: string;
}

export interface ImagePromptRequest {
  scene?: string;
  locationVisuals?: string;
  characters?: ImagePromptCharacter[];
  currentAction?: string;
  mood?: string;
  lighting?: string;
  camera?: string;
  stylePreset?: string;
  continuityLocks?: string[];
  negativePrompt?: string[];
  providerFormatting?: "generic" | "sdxl" | "midjourney";
}

export interface CompiledImagePrompt {
  prompt: string;
  negativePrompt: string;
  includedLayers: string[];
  providerFormatting: "generic" | "sdxl" | "midjourney";
}

export function compileImagePrompt(request: ImagePromptRequest): CompiledImagePrompt {
  const includedLayers: string[] = [];
  const parts: string[] = [];

  addLayer(parts, includedLayers, "scene", request.scene);
  addLayer(parts, includedLayers, "location", request.locationVisuals);

  if (request.characters && request.characters.length > 0) {
    includedLayers.push("characters");
    parts.push(
      request.characters
        .map((character) =>
          [character.name, character.appearance, character.pose, character.position].filter(Boolean).join(", "),
        )
        .join("; "),
    );
  }

  addLayer(parts, includedLayers, "currentAction", request.currentAction);
  addLayer(parts, includedLayers, "mood", request.mood);
  addLayer(parts, includedLayers, "lighting", request.lighting);
  addLayer(parts, includedLayers, "camera", request.camera);
  addLayer(parts, includedLayers, "stylePreset", request.stylePreset);

  if (request.continuityLocks && request.continuityLocks.length > 0) {
    includedLayers.push("continuityLocks");
    parts.push(`continuity locks: ${request.continuityLocks.join(", ")}`);
  }

  return {
    prompt: parts.join(", "),
    negativePrompt: request.negativePrompt?.join(", ") ?? "",
    includedLayers,
    providerFormatting: request.providerFormatting ?? "generic",
  };
}

function addLayer(parts: string[], includedLayers: string[], layerName: string, value?: string) {
  if (!value) {
    return;
  }

  includedLayers.push(layerName);
  parts.push(value);
}
