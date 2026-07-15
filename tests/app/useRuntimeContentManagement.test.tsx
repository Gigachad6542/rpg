import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  defaultNewCard,
  defaultRuntimeSettings,
  initialCards,
} from "../../src/app/appDefaults";
import { createChatSession, filterPersistedOpeningMessages } from "../../src/app/chatSessions";
import { initializeChatTurnState } from "../../src/app/chatTurnState";
import type {
  ChatSession,
  GeneratedMapArtifact,
  PromptRun,
  RuntimeCard,
} from "../../src/app/runtimeTypes";
import { useRuntimeContentManagement } from "../../src/app/useRuntimeContentManagement";

function renderContent(options: {
  newCardName?: string;
  includeActiveChat?: boolean;
} = {}) {
  const setSection = vi.fn();
  const setCardTab = vi.fn();
  const setMapPrompt = vi.fn();
  const setImagePromptDraft = vi.fn();
  const setImageNegativePromptDraft = vi.fn();
  const setPhotoSpecDraft = vi.fn();
  const setPhotoPrompt = vi.fn();
  const setMapArtifact = vi.fn();
  const setPhotoArtifact = vi.fn();
  const setProviderSettings = vi.fn();
  const setSessionApiKey = vi.fn();
  const setProviderKeyStatus = vi.fn();
  const setOnboardingDismissed = vi.fn();
  const generateCustomImageFromRequest = vi.fn(async () => undefined);

  const hook = renderHook(() => {
    const [cards, setCards] = useState<RuntimeCard[]>(() => structuredClone(initialCards));
    const activeCard = cards[0] ?? null;
    const [activeCardId, setActiveCardId] = useState(activeCard?.id ?? "");
    const initialChat = activeCard && options.includeActiveChat
      ? initializeChatTurnState(createChatSession(activeCard.id, "Active chat"), activeCard)
      : undefined;
    const [chatSessions, setChatSessions] = useState<ChatSession[]>(() => initialChat ? [initialChat] : []);
    const [activeChatIds, setActiveChatIds] = useState<Record<string, string>>(() =>
      initialChat && activeCard ? { [activeCard.id]: initialChat.id } : {},
    );
    const activeChat = chatSessions.find((chat) => chat.id === activeChatIds[activeCardId]);
    const [promptRuns, setPromptRuns] = useState<PromptRun[]>(() => initialChat && activeCard
      ? [{
          id: "run-active",
          cardId: activeCard.id,
          chatId: initialChat.id,
          compiledPrompt: "",
          response: "",
          provider: "mock",
          model: "mock-narrator",
          tokenEstimate: 0,
          includedLayerIds: [],
          includedLoreEntryIds: [],
          warnings: [],
          stateChanges: [],
        }]
      : []);
    const [generatedMaps, setGeneratedMaps] = useState<GeneratedMapArtifact[]>(() =>
      initialChat && activeCard
        ? [{
            id: "map-active",
            imageKind: "map",
            cardId: activeCard.id,
            chatId: initialChat.id,
            prompt: "Map",
            negativePrompt: "",
            provider: "prompt-only",
            model: "",
            status: "prompt-only",
            createdAt: "2026-07-15T00:00:00.000Z",
          }]
        : [],
    );
    const [newCard, setNewCard] = useState({
      ...defaultNewCard,
      name: options.newCardName ?? defaultNewCard.name,
    });
    const [draft, setDraft] = useState("");
    const [runtimeSettings, setRuntimeSettings] = useState(defaultRuntimeSettings);
    const [ruleWarning, setRuleWarning] = useState<string | null>(null);
    const content = useRuntimeContentManagement({
      cards,
      setCards,
      activeCardId,
      setActiveCardId,
      activeCard,
      chatSessions,
      setChatSessions,
      activeChatIds,
      setActiveChatIds,
      activeChat,
      messages: filterPersistedOpeningMessages(activeChat?.messages ?? []),
      promptRuns,
      setPromptRuns,
      generatedMaps,
      setGeneratedMaps,
      newCard,
      setNewCard,
      draft,
      setDraft,
      runtimeSettings,
      setRuntimeSettings,
      setSection,
      setCardTab,
      setRuntimeRunning: vi.fn(),
      setRuleWarning,
      setOnboardingDismissed,
      setMapPrompt,
      setImagePromptDraft,
      setImageNegativePromptDraft,
      setPhotoSpecDraft,
      setPhotoPrompt,
      setMapArtifact,
      setPhotoArtifact,
      setProviderSettings,
      setSessionApiKey,
      setProviderKeyStatus,
      generateCustomImageFromRequest,
    });

    return {
      ...content,
      cards,
      activeCardId,
      chatSessions,
      activeChatIds,
      promptRuns,
      generatedMaps,
      newCard,
      draft,
      ruleWarning,
    };
  });

  return {
    ...hook,
    setSection,
    setCardTab,
    generateCustomImageFromRequest,
  };
}

describe("useRuntimeContentManagement", () => {
  it("rejects a blank card name without mutating the library", () => {
    const { result } = renderContent({ newCardName: "   " });
    const originalCards = structuredClone(result.current.cards);

    let created = true;
    act(() => {
      created = result.current.createCard();
    });

    expect(created).toBe(false);
    expect(result.current.cards).toEqual(originalCards);
    expect(result.current.newCardError).toBe("Enter a card name before creating a card.");
  });

  it("requires confirmation before deleting a chat and cleans its dependent records", () => {
    const { result } = renderContent({ includeActiveChat: true });
    const originalChatId = result.current.chatSessions[0]?.id;

    act(() => result.current.deleteActiveChat());
    expect(result.current.pendingDeleteChatId).toBe(originalChatId);
    expect(result.current.chatSessions[0]?.id).toBe(originalChatId);

    act(() => result.current.deleteActiveChat());
    expect(result.current.pendingDeleteChatId).toBeNull();
    expect(result.current.chatSessions).toHaveLength(1);
    expect(result.current.chatSessions[0]?.id).not.toBe(originalChatId);
    expect(result.current.promptRuns).toEqual([]);
    expect(result.current.generatedMaps).toEqual([]);
  });

  it("blocks slash-command dice rolls while the runtime setting is disabled", async () => {
    const { result } = renderContent({ includeActiveChat: true });

    await act(async () => result.current.runSlashCommand("roll", "d6"));

    expect(result.current.ruleWarning).toBe(
      "Dice rolls are turned off. Enable them in Settings to use /roll.",
    );
    expect(result.current.chatSessions[0]?.authoritativeEvents ?? []).toEqual([]);
  });
});
