import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StoryEntity } from "../../src/runtime/hiddenContinuity";
import { generateConfiguredImageArtifact } from "../../src/app/assetService";
import {
  defaultImageProviderSettings,
  defaultProviderSettings,
  defaultRuntimeSettings,
  initialCards,
} from "../../src/app/appDefaults";
import { planImagePromptWithTextModel } from "../../src/app/imagePromptPlanning";
import type {
  ChatSession,
  GeneratedMapArtifact,
  ImageProviderSettings,
  Message,
} from "../../src/app/runtimeTypes";
import { useMediaGeneration } from "../../src/app/useMediaGeneration";

vi.mock("../../src/app/imagePromptPlanning", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/app/imagePromptPlanning")>(),
  planImagePromptWithTextModel: vi.fn(),
}));

vi.mock("../../src/app/assetService", () => ({
  generateConfiguredImageArtifact: vi.fn(),
}));

const planImagePromptMock = vi.mocked(planImagePromptWithTextModel);
const generateConfiguredImageArtifactMock = vi.mocked(generateConfiguredImageArtifact);

const activeCard = structuredClone(initialCards[0]);
const activeChat: ChatSession = {
  id: "chat-active",
  cardId: activeCard.id,
  title: "Active chat",
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
  messages: [],
};

function artifact(overrides: Partial<GeneratedMapArtifact> = {}): GeneratedMapArtifact {
  return {
    id: "map-active",
    imageKind: "map",
    cardId: activeCard.id,
    chatId: activeChat.id,
    prompt: "Aerial map",
    negativePrompt: "blurry",
    provider: "prompt-only",
    model: "",
    status: "prompt-only",
    createdAt: "2026-07-15T00:00:00.000Z",
    ...overrides,
  };
}

function renderMedia(overrides: {
  initialGeneratedMaps?: GeneratedMapArtifact[];
  messages?: Message[];
  imageProviderSettings?: ImageProviderSettings;
  setRuleWarning?: (warning: string | null) => void;
} = {}) {
  const setRuleWarning = overrides.setRuleWarning ?? vi.fn();
  const hook = renderHook(() => {
    const [imageProviderSettings, setImageProviderSettings] = useState<ImageProviderSettings>(
      overrides.imageProviderSettings ?? defaultImageProviderSettings,
    );
    const media = useMediaGeneration({
      initialGeneratedMaps: overrides.initialGeneratedMaps ?? [],
      initialMapArtifact: null,
      initialPhotoArtifact: null,
      activeCard,
      activeChat,
      messages: overrides.messages ?? [],
      activeLoreCount: 0,
      providerSettings: defaultProviderSettings,
      sessionApiKey: "",
      runtimeSettings: defaultRuntimeSettings,
      imageProviderSettings,
      setImageProviderSettings,
      imageSessionApiKey: "",
      imageProviderStatus: "Prompt-only image mode active.",
      comfyUiCheckpointModels: [],
      setRuleWarning,
      desktopRuntime: false,
    });
    return { media, imageProviderSettings };
  });
  return { ...hook, setRuleWarning };
}

describe("useMediaGeneration", () => {
  beforeEach(() => {
    planImagePromptMock.mockReset();
    generateConfiguredImageArtifactMock.mockReset();
  });

  it("falls back to a usable local map prompt when hosted planning fails", async () => {
    planImagePromptMock.mockRejectedValue(new Error("planner offline"));
    const setRuleWarning = vi.fn();
    const hostedSettings = {
      ...defaultProviderSettings,
      mode: "openai-compatible" as const,
      providerId: "openrouter" as const,
      baseUrl: "https://openrouter.ai/api/v1",
    };
    const { result } = renderHook(() => {
      const [imageProviderSettings, setImageProviderSettings] = useState(defaultImageProviderSettings);
      return useMediaGeneration({
        initialGeneratedMaps: [],
        initialMapArtifact: null,
        initialPhotoArtifact: null,
        activeCard,
        activeChat,
        messages: [],
        activeLoreCount: 0,
        providerSettings: hostedSettings,
        sessionApiKey: "session-key",
        runtimeSettings: defaultRuntimeSettings,
        imageProviderSettings,
        setImageProviderSettings,
        imageSessionApiKey: "",
        imageProviderStatus: "Prompt-only image mode active.",
        comfyUiCheckpointModels: [],
        setRuleWarning,
        desktopRuntime: false,
      });
    });

    await act(async () => result.current.prepareImagePrompt());

    expect(result.current.mapPrompt).toContain("Ashfall Crossing");
    expect(result.current.imagePromptDraft).toBe(result.current.mapPrompt);
    expect(result.current.isDraftingMapPrompt).toBe(false);
    expect(setRuleWarning).toHaveBeenCalledWith(expect.stringMatching(/fell back.*planner offline/i));
  });

  it("deletes only the active chat map and preserves other media", () => {
    const activeMap = artifact();
    const otherChatMap = artifact({ id: "map-other", chatId: "chat-other" });
    const activePhoto = artifact({ id: "photo-active", imageKind: "photo" });
    const { result } = renderMedia({ initialGeneratedMaps: [activeMap, otherChatMap, activePhoto] });

    act(() => result.current.media.deleteCurrentMap());

    expect(result.current.media.generatedMaps.map((item) => item.id)).toEqual(["map-other", "photo-active"]);
    expect(result.current.media.mapArtifact?.id).toBe("map-other");
  });

  it("saves confirm-first portrait prompts without invoking image generation", async () => {
    const entity: StoryEntity = {
      id: "entity-mara",
      name: "Mara",
      kind: "character",
      summary: "A red-haired scout",
      knownFacts: [],
      doesNotKnow: [],
      notes: [],
    };
    const card = { ...activeCard, storyEntities: [entity] };
    const messages: Message[] = [{ id: "message-1", role: "assistant", content: "Mara enters the hall." }];
    const { result } = renderHook(() => {
      const [imageProviderSettings, setImageProviderSettings] = useState<ImageProviderSettings>({
        ...defaultImageProviderSettings,
        portraitGenerationMode: "confirm-first",
      });
      return useMediaGeneration({
        initialGeneratedMaps: [],
        initialMapArtifact: null,
        initialPhotoArtifact: null,
        activeCard: card,
        activeChat,
        messages,
        activeLoreCount: 0,
        providerSettings: defaultProviderSettings,
        sessionApiKey: "",
        runtimeSettings: defaultRuntimeSettings,
        imageProviderSettings,
        setImageProviderSettings,
        imageSessionApiKey: "",
        imageProviderStatus: "Prompt-only image mode active.",
        comfyUiCheckpointModels: [],
        setRuleWarning: vi.fn(),
        desktopRuntime: false,
      });
    });

    await act(async () => result.current.generateMissingCharacterPortraits(card, activeChat.id, messages));
    await waitFor(() => expect(result.current.generatedMaps).toHaveLength(1));

    expect(result.current.generatedMaps[0]).toMatchObject({
      imageKind: "character",
      subjectId: entity.id,
      status: "prompt-only",
    });
    expect(generateConfiguredImageArtifactMock).not.toHaveBeenCalled();
  });
});
