import { type Dispatch, type SetStateAction, useEffect, useState } from "react";

import type { StoryEntity } from "../runtime/hiddenContinuity";
import { compileImagePrompt } from "../runtime/imagePromptCompiler";
import { generateConfiguredImageArtifact } from "./assetService";
import {
  characterPortraitNegativePrompt,
  customImageNegativePrompt,
} from "./appDefaults";
import { getErrorMessage } from "./appUtils";
import { createRuntimeEntityId } from "./chatSessions";
import {
  buildCharacterPortraitPrompt,
  buildCustomImagePrompt,
  findCharacterPortraitForEntity,
  findGeneratedMapForChat,
  isComfyUiImageProviderReady,
  shouldPrepareCharacterPortrait,
  shouldRunCharacterPortraitGeneration,
  upsertGeneratedMap,
  upsertGeneratedMaps,
} from "./generatedImages";
import {
  buildImagePromptRequest,
  planImagePromptWithTextModel,
  sanitizeMapNegativePrompt,
} from "./imagePromptPlanning";
import type {
  ChatSession,
  GeneratedMapArtifact,
  ImageProviderSettings,
  MediaPreviewArtifact,
  Message,
  ProviderSettings,
  RuntimeCard,
  RuntimeSettings,
} from "./runtimeTypes";

export interface UseMediaGenerationOptions {
  initialGeneratedMaps: GeneratedMapArtifact[];
  initialMapArtifact: GeneratedMapArtifact | null;
  initialPhotoArtifact: GeneratedMapArtifact | null;
  activeCard: RuntimeCard | null;
  activeChat: ChatSession | undefined;
  messages: Message[];
  activeLoreCount: number;
  providerSettings: ProviderSettings;
  sessionApiKey: string;
  runtimeSettings: RuntimeSettings;
  imageProviderSettings: ImageProviderSettings;
  setImageProviderSettings: Dispatch<SetStateAction<ImageProviderSettings>>;
  imageSessionApiKey: string;
  imageProviderStatus: string;
  comfyUiCheckpointModels: string[];
  setRuleWarning: (warning: string | null) => void;
  desktopRuntime: boolean;
}

export function useMediaGeneration({
  initialGeneratedMaps,
  initialMapArtifact,
  initialPhotoArtifact,
  activeCard,
  activeChat,
  messages,
  activeLoreCount,
  providerSettings,
  sessionApiKey,
  runtimeSettings,
  imageProviderSettings,
  setImageProviderSettings,
  imageSessionApiKey,
  imageProviderStatus,
  comfyUiCheckpointModels,
  setRuleWarning,
  desktopRuntime,
}: UseMediaGenerationOptions) {
  const [mapPrompt, setMapPrompt] = useState<string | null>(null);
  const [imagePromptDraft, setImagePromptDraft] = useState("");
  const [imageNegativePromptDraft, setImageNegativePromptDraft] = useState("");
  const [mapArtifact, setMapArtifact] = useState<GeneratedMapArtifact | null>(initialMapArtifact);
  const [photoSpecDraft, setPhotoSpecDraft] = useState("");
  const [photoPrompt, setPhotoPrompt] = useState("");
  const [photoArtifact, setPhotoArtifact] = useState<GeneratedMapArtifact | null>(initialPhotoArtifact);
  const [generatedMaps, setGeneratedMaps] = useState<GeneratedMapArtifact[]>(initialGeneratedMaps);
  const [isDraftingMapPrompt, setIsDraftingMapPrompt] = useState(false);
  const [isGeneratingMapImage, setIsGeneratingMapImage] = useState(false);
  const [isGeneratingPhoto, setIsGeneratingPhoto] = useState(false);
  const [mediaPreview, setMediaPreview] = useState<MediaPreviewArtifact | null>(null);

  useEffect(() => {
    setMapArtifact(activeCard ? findGeneratedMapForChat(generatedMaps, activeCard.id, activeChat?.id, "map") : null);
    setPhotoArtifact(activeCard ? findGeneratedMapForChat(generatedMaps, activeCard.id, activeChat?.id, "photo") : null);
  }, [activeCard, activeChat?.id, generatedMaps]);

  useEffect(() => {
    if (!mapArtifact) {
      return;
    }

    setMapPrompt(mapArtifact.prompt);
    setImagePromptDraft(mapArtifact.prompt);
    setImageNegativePromptDraft(mapArtifact.negativePrompt);
  }, [mapArtifact]);

  async function runConfiguredImageGeneration(input: {
    baseArtifact: GeneratedMapArtifact;
    prompt: string;
    negativePrompt: string;
    metadata: Record<string, unknown>;
  }): Promise<GeneratedMapArtifact> {
    const result = await generateConfiguredImageArtifact({
      settings: imageProviderSettings,
      sessionApiKey: imageSessionApiKey,
      ...input,
      desktopRuntime,
    });
    if (result.settings !== imageProviderSettings) {
      setImageProviderSettings(result.settings);
    }
    return result.artifact;
  }

  async function prepareImagePrompt() {
    if (!activeCard?.mapEnabled) {
      return;
    }

    setIsDraftingMapPrompt(true);
    try {
      const planned =
        providerSettings.mode === "mock"
          ? compileImagePrompt(buildImagePromptRequest(activeCard, messages))
          : await planImagePromptWithTextModel({
              card: activeCard,
              messages,
              providerSettings,
              sessionApiKey,
              activeLoreCount,
              runtimeSettings,
            });
      setMapPrompt(planned.prompt);
      setImagePromptDraft(planned.prompt);
      setImageNegativePromptDraft(sanitizeMapNegativePrompt(planned.negativePrompt));
    } catch (error) {
      const fallback = compileImagePrompt(buildImagePromptRequest(activeCard, messages));
      setMapPrompt(fallback.prompt);
      setImagePromptDraft(fallback.prompt);
      setImageNegativePromptDraft(sanitizeMapNegativePrompt(fallback.negativePrompt));
      setRuleWarning(`Aerial image prompt planner fell back to local summary: ${getErrorMessage(error)}`);
    } finally {
      setIsDraftingMapPrompt(false);
    }
  }

  async function generateImageFromPrompt() {
    if (!activeCard?.mapEnabled || !imagePromptDraft.trim()) {
      return;
    }

    setIsGeneratingMapImage(true);
    const baseArtifact: GeneratedMapArtifact = {
      id: createRuntimeEntityId("map"),
      imageKind: "map",
      cardId: activeCard.id,
      chatId: activeChat?.id ?? `chat_${activeCard.id}`,
      prompt: imagePromptDraft.trim(),
      negativePrompt: sanitizeMapNegativePrompt(imageNegativePromptDraft),
      provider: imageProviderSettings.mode === "comfyui" ? "comfyui" : "prompt-only",
      model: imageProviderSettings.model,
      status: "prompt-only",
      createdAt: new Date().toISOString(),
    };

    try {
      const artifact = await runConfiguredImageGeneration({
        baseArtifact,
        prompt: imagePromptDraft.trim(),
        negativePrompt: sanitizeMapNegativePrompt(imageNegativePromptDraft),
        metadata: {
          cardId: activeCard.id,
          chatId: activeChat?.id,
          cardName: activeCard.name,
        },
      });
      setMapArtifact(artifact);
      setGeneratedMaps((current) => upsertGeneratedMap(current, artifact));
    } catch (error) {
      const artifact: GeneratedMapArtifact = {
        ...baseArtifact,
        status: "error",
        error: getErrorMessage(error),
      };
      setMapArtifact(artifact);
      setGeneratedMaps((current) => upsertGeneratedMap(current, artifact));
    } finally {
      setIsGeneratingMapImage(false);
    }
  }

  function resetMapPrompt() {
    setMapPrompt(null);
    setImagePromptDraft("");
    setImageNegativePromptDraft("");
  }

  function deleteCurrentMap() {
    if (!activeCard) {
      return;
    }

    const chatId = activeChat?.id;
    setGeneratedMaps((current) =>
      current.filter(
        (artifact) =>
          artifact.imageKind !== "map" ||
          artifact.cardId !== activeCard.id ||
          (chatId ? artifact.chatId !== chatId : false),
      ),
    );
    setMapArtifact(null);
  }

  async function generateCustomImageFromRequest(specOverride?: string) {
    const userInput = (specOverride ?? photoSpecDraft).trim();
    if (!activeCard || !userInput) {
      return;
    }
    if (specOverride !== undefined) {
      setPhotoSpecDraft(userInput);
    }

    const prompt = buildCustomImagePrompt(userInput);
    setPhotoPrompt(prompt);
    setIsGeneratingPhoto(true);
    const baseArtifact: GeneratedMapArtifact = {
      id: createRuntimeEntityId("image"),
      imageKind: "photo",
      cardId: activeCard.id,
      chatId: activeChat?.id ?? `chat_${activeCard.id}`,
      prompt,
      negativePrompt: customImageNegativePrompt,
      provider: imageProviderSettings.mode === "comfyui" ? "comfyui" : "prompt-only",
      model: imageProviderSettings.model,
      status: "prompt-only",
      userInput,
      createdAt: new Date().toISOString(),
    };

    try {
      const artifact = await runConfiguredImageGeneration({
        baseArtifact,
        prompt,
        negativePrompt: customImageNegativePrompt,
        metadata: {
          cardId: activeCard.id,
          chatId: activeChat?.id,
          cardName: activeCard.name,
          imageKind: "photo",
          userInput,
        },
      });
      setPhotoArtifact(artifact);
      setGeneratedMaps((current) => upsertGeneratedMap(current, artifact));
    } catch (error) {
      const artifact: GeneratedMapArtifact = {
        ...baseArtifact,
        status: "error",
        error: getErrorMessage(error),
      };
      setPhotoArtifact(artifact);
      setGeneratedMaps((current) => upsertGeneratedMap(current, artifact));
    } finally {
      setIsGeneratingPhoto(false);
    }
  }

  function resetCustomImageRequest() {
    setPhotoSpecDraft("");
    setPhotoPrompt("");
  }

  function deleteCurrentPhoto() {
    if (!activeCard) {
      return;
    }

    const chatId = activeChat?.id;
    setGeneratedMaps((current) =>
      current.filter(
        (artifact) =>
          artifact.imageKind !== "photo" ||
          artifact.cardId !== activeCard.id ||
          (chatId ? artifact.chatId !== chatId : false),
      ),
    );
    setPhotoArtifact(null);
    setPhotoPrompt("");
  }

  async function regenerateCharacterPortrait(entity: StoryEntity, promptOverride: string) {
    if (!activeCard) {
      return;
    }
    const chatId = activeChat?.id ?? `chat_${activeCard.id}`;
    const existing = findCharacterPortraitForEntity(generatedMaps, activeCard.id, entity);
    const prompt = promptOverride.trim() || existing?.prompt || buildCharacterPortraitPrompt(activeCard, entity);
    const baseArtifact: GeneratedMapArtifact = {
      id: existing?.id ?? createRuntimeEntityId("portrait"),
      imageKind: "character",
      cardId: activeCard.id,
      chatId,
      subjectId: entity.id,
      subjectName: entity.name,
      prompt,
      negativePrompt: characterPortraitNegativePrompt,
      provider: imageProviderSettings.mode === "comfyui" ? "comfyui" : "prompt-only",
      model: imageProviderSettings.model,
      status: "prompt-only",
      userInput: entity.name,
      createdAt: new Date().toISOString(),
    };
    setGeneratedMaps((current) => upsertGeneratedMap(current, baseArtifact));
    try {
      const artifact = await runConfiguredImageGeneration({
        baseArtifact,
        prompt,
        negativePrompt: baseArtifact.negativePrompt,
        metadata: {
          cardId: activeCard.id,
          chatId,
          cardName: activeCard.name,
          imageKind: "character",
          subjectId: entity.id,
          subjectName: entity.name,
        },
      });
      setGeneratedMaps((current) => upsertGeneratedMap(current, artifact));
    } catch (error) {
      setGeneratedMaps((current) =>
        upsertGeneratedMap(current, {
          ...baseArtifact,
          status: "error",
          error: getErrorMessage(error),
        }),
      );
    }
  }

  async function generateMissingCharacterPortraits(
    card: RuntimeCard,
    chatId: string,
    visibleMessages: readonly Message[],
  ) {
    const portraitMode = imageProviderSettings.portraitGenerationMode;
    const missingPortraits = card.storyEntities
      .filter((entity) => shouldPrepareCharacterPortrait(entity, visibleMessages, portraitMode))
      .filter((entity) => {
        const existing = findCharacterPortraitForEntity(generatedMaps, card.id, entity);
        return !existing || (portraitMode === "auto" && existing.status !== "generated");
      });
    if (missingPortraits.length === 0) {
      return;
    }

    const baseArtifacts = missingPortraits.map((entity): GeneratedMapArtifact => {
      const existing = findCharacterPortraitForEntity(generatedMaps, card.id, entity);
      return {
        id: existing?.id ?? createRuntimeEntityId("portrait"),
        imageKind: "character",
        cardId: card.id,
        chatId,
        subjectId: entity.id,
        subjectName: entity.name,
        prompt: existing?.prompt || buildCharacterPortraitPrompt(card, entity),
        negativePrompt: existing?.negativePrompt || characterPortraitNegativePrompt,
        provider: imageProviderSettings.mode === "comfyui" ? "comfyui" : "prompt-only",
        model: imageProviderSettings.model,
        status: "prompt-only",
        error: isComfyUiImageProviderReady(imageProviderSettings, imageProviderStatus, comfyUiCheckpointModels)
          ? undefined
          : imageProviderSettings.mode === "comfyui"
            ? "ComfyUI is not ready yet; portrait prompt saved."
            : undefined,
        userInput: entity.name,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      };
    });
    setGeneratedMaps((current) => upsertGeneratedMaps(current, baseArtifacts));

    if (
      !shouldRunCharacterPortraitGeneration(portraitMode) ||
      !isComfyUiImageProviderReady(imageProviderSettings, imageProviderStatus, comfyUiCheckpointModels)
    ) {
      return;
    }

    for (const baseArtifact of baseArtifacts) {
      try {
        const artifact = await runConfiguredImageGeneration({
          baseArtifact,
          prompt: baseArtifact.prompt,
          negativePrompt: baseArtifact.negativePrompt,
          metadata: {
            cardId: card.id,
            chatId,
            cardName: card.name,
            imageKind: "character",
            subjectId: baseArtifact.subjectId,
            subjectName: baseArtifact.subjectName,
          },
        });
        setGeneratedMaps((current) => upsertGeneratedMap(current, artifact));
      } catch (error) {
        setGeneratedMaps((current) =>
          upsertGeneratedMap(current, {
            ...baseArtifact,
            status: "error",
            error: getErrorMessage(error),
          }),
        );
      }
    }
  }

  return {
    mapPrompt,
    setMapPrompt,
    imagePromptDraft,
    setImagePromptDraft,
    imageNegativePromptDraft,
    setImageNegativePromptDraft,
    mapArtifact,
    setMapArtifact,
    photoSpecDraft,
    setPhotoSpecDraft,
    photoPrompt,
    setPhotoPrompt,
    photoArtifact,
    setPhotoArtifact,
    generatedMaps,
    setGeneratedMaps,
    isDraftingMapPrompt,
    isGeneratingMapImage,
    isGeneratingPhoto,
    mediaPreview,
    setMediaPreview,
    prepareImagePrompt,
    generateImageFromPrompt,
    resetMapPrompt,
    deleteCurrentMap,
    generateCustomImageFromRequest,
    resetCustomImageRequest,
    deleteCurrentPhoto,
    regenerateCharacterPortrait,
    generateMissingCharacterPortraits,
  };
}
