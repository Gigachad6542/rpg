// Generated map / photo / character-portrait artifact helpers extracted from App.tsx.
import type {
  GeneratedImageKind,
  GeneratedMapArtifact,
  ImageProviderSettings,
  Message,
  PortraitGenerationMode,
  RuntimeCard,
} from "./runtimeTypes";
import { type StoryEntity } from "../runtime/hiddenContinuity";
import { isRecord } from "./appUtils";
import { formatStoryEntityKind, isDefaultPlayerStoryEntity, normalizeRuntimeText } from "./cardNormalization";
import {
  characterPortraitPresetPrompt,
  customImagePresetPrompt,
  maxGeneratedMediaArtifacts,
} from "./appDefaults";

export function parseGeneratedMaps(value: unknown): GeneratedMapArtifact[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const parsed = value
    .filter(isRecord)
    .map((artifact) => ({
      ...artifact,
      imageKind: normalizeGeneratedImageKind(artifact.imageKind),
      chatId:
        typeof artifact.chatId === "string"
          ? artifact.chatId
          : typeof artifact.cardId === "string"
            ? `chat_${artifact.cardId}`
            : "",
    }))
    .filter(isGeneratedMapArtifact);

  return dedupeGeneratedMaps(parsed);
}

export function normalizeGeneratedImageKind(value: unknown): GeneratedImageKind {
  if (value === "photo" || value === "character") {
    return value;
  }
  return "map";
}

export function isGeneratedMapArtifact(value: unknown): value is GeneratedMapArtifact {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    (value.imageKind === "map" || value.imageKind === "photo" || value.imageKind === "character") &&
    typeof value.cardId === "string" &&
    typeof value.chatId === "string" &&
    typeof value.prompt === "string" &&
    typeof value.negativePrompt === "string" &&
    typeof value.provider === "string" &&
    typeof value.model === "string" &&
    (value.status === "prompt-only" || value.status === "generated" || value.status === "error") &&
    typeof value.createdAt === "string" &&
    (value.imageUrl === undefined || typeof value.imageUrl === "string") &&
    (value.error === undefined || typeof value.error === "string") &&
    (value.userInput === undefined || typeof value.userInput === "string") &&
    (value.subjectId === undefined || typeof value.subjectId === "string") &&
    (value.subjectName === undefined || typeof value.subjectName === "string")
  );
}

export function upsertGeneratedMap(current: GeneratedMapArtifact[], artifact: GeneratedMapArtifact): GeneratedMapArtifact[] {
  return dedupeGeneratedMaps([...current, artifact]).slice(-maxGeneratedMediaArtifacts);
}

export function upsertGeneratedMaps(current: GeneratedMapArtifact[], artifacts: GeneratedMapArtifact[]): GeneratedMapArtifact[] {
  return dedupeGeneratedMaps([...current, ...artifacts]).slice(-maxGeneratedMediaArtifacts);
}

export function findGeneratedMapForChat(
  artifacts: GeneratedMapArtifact[],
  cardId: string,
  chatId: string | undefined,
  imageKind: GeneratedImageKind = "map",
): GeneratedMapArtifact | null {
  const exactChatArtifact = chatId
    ? getNewestGeneratedMap(
        artifacts.filter(
          (artifact) => artifact.cardId === cardId && artifact.chatId === chatId && artifact.imageKind === imageKind,
        ),
      )
    : null;
  if (exactChatArtifact) {
    return exactChatArtifact;
  }

  return getNewestGeneratedMap(
    artifacts.filter((artifact) => artifact.cardId === cardId && artifact.imageKind === imageKind),
  );
}

export function dedupeGeneratedMaps(artifacts: GeneratedMapArtifact[]): GeneratedMapArtifact[] {
  const latestByKey = new globalThis.Map<string, GeneratedMapArtifact>();
  for (const artifact of artifacts) {
    const subjectKey = artifact.imageKind === "character"
      ? artifact.subjectId || artifact.subjectName || artifact.id
      : "";
    const key = `${artifact.cardId}\u0000${artifact.chatId}\u0000${artifact.imageKind}\u0000${subjectKey}`;
    const current = latestByKey.get(key);
    if (!current || compareGeneratedArtifactRecency(artifact, current) > 0) {
      latestByKey.set(key, artifact);
    }
  }

  return Array.from(latestByKey.values()).sort(compareGeneratedArtifactRecency);
}

export function getNewestGeneratedMap(artifacts: GeneratedMapArtifact[]): GeneratedMapArtifact | null {
  return artifacts.reduce<GeneratedMapArtifact | null>(
    (newest, artifact) => (!newest || compareGeneratedArtifactRecency(artifact, newest) > 0 ? artifact : newest),
    null,
  );
}

export function compareGeneratedArtifactRecency(a: GeneratedMapArtifact, b: GeneratedMapArtifact): number {
  const createdDelta = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  if (createdDelta !== 0 && Number.isFinite(createdDelta)) {
    return createdDelta;
  }
  const statusDelta = generatedArtifactStatusRank(a.status) - generatedArtifactStatusRank(b.status);
  if (statusDelta !== 0) {
    return statusDelta;
  }
  return a.id.localeCompare(b.id);
}

export function generatedArtifactStatusRank(status: GeneratedMapArtifact["status"]): number {
  if (status === "generated") {
    return 2;
  }
  if (status === "error") {
    return 1;
  }
  return 0;
}

export function toGeneratedImageSrc(artifact: GeneratedMapArtifact): string {
  if (!artifact.imageUrl) {
    return "";
  }

  const separator = artifact.imageUrl.includes("?") ? "&" : "?";
  return `${artifact.imageUrl}${separator}lc_run=${encodeURIComponent(artifact.id)}`;
}

export function findCharacterPortraitsForCard(artifacts: GeneratedMapArtifact[], cardId: string): GeneratedMapArtifact[] {
  return artifacts.filter((artifact) => artifact.cardId === cardId && artifact.imageKind === "character");
}

export function findCharacterPortraitForEntity(
  artifacts: GeneratedMapArtifact[],
  cardId: string,
  entity: StoryEntity,
): GeneratedMapArtifact | null {
  return getNewestGeneratedMap(
    artifacts.filter((artifact) =>
      artifact.imageKind === "character" &&
      (!cardId || artifact.cardId === cardId) &&
      (artifact.subjectId === entity.id ||
        (!!artifact.subjectName && normalizeRuntimeText(artifact.subjectName) === normalizeRuntimeText(entity.name))),
    ),
  );
}

export function hasGeneratedCharacterPortraitForEntity(
  artifacts: GeneratedMapArtifact[],
  cardId: string,
  entity: StoryEntity,
): boolean {
  const portrait = findCharacterPortraitForEntity(artifacts, cardId, entity);
  return Boolean(portrait?.status === "generated" && portrait.imageUrl);
}

export function shouldAutoGenerateCharacterPortrait(entity: StoryEntity): boolean {
  return (entity.kind === "player" || entity.kind === "character") && !isDefaultPlayerStoryEntity(entity);
}

export function entityAppearsInVisibleMessages(
  entity: StoryEntity,
  messages: readonly Message[],
): boolean {
  const name = entity.name.trim();
  if (!name) {
    return false;
  }
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const visibleName = new RegExp(`(^|[^A-Za-z0-9])${escapedName}(?=$|[^A-Za-z0-9])`, "i");
  return messages.some(
    (message) =>
      (message.role === "user" || message.role === "assistant") && visibleName.test(message.content),
  );
}

export function shouldPrepareCharacterPortrait(
  entity: StoryEntity,
  visibleMessages: readonly Message[],
  mode: PortraitGenerationMode,
): boolean {
  return (
    mode !== "off" &&
    shouldAutoGenerateCharacterPortrait(entity) &&
    entityAppearsInVisibleMessages(entity, visibleMessages)
  );
}

export function shouldRunCharacterPortraitGeneration(mode: PortraitGenerationMode): boolean {
  return mode === "auto";
}

export function buildCharacterPortraitPrompt(card: RuntimeCard, entity: StoryEntity): string {
  const context = [
    `Subject: ${entity.name}`,
    `Role: ${formatStoryEntityKind(entity.kind)}`,
    entity.summary ? `Established description: ${entity.summary}` : "",
    card.rpg?.location ? `Current scene location: ${card.rpg.location}` : "",
    card.summary ? `Story context: ${card.summary}` : "",
    "Use only stable visual details from the story. Keep the portrait reusable across future scenes.",
  ]
    .filter(Boolean)
    .join("\n");

  return `${characterPortraitPresetPrompt}\n\n${context}`;
}

export function isComfyUiImageProviderReady(
  settings: ImageProviderSettings,
  status: string,
  installedModels: string[],
): boolean {
  return (
    settings.mode === "comfyui" &&
    installedModels.length > 0 &&
    installedModels.includes(settings.model) &&
    /\bready\b/i.test(status)
  );
}

export function buildCustomImagePrompt(userInput: string): string {
  return `${customImagePresetPrompt}\n\nplus user inputs: ${userInput.trim()}`;
}
