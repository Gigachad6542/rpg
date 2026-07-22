import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useRef,
  useState,
} from "react";

import {
  appendAuthoritativeEvent,
  createDiceRolledEvent,
  createToolResultEvent,
} from "../runtime/authoritativeEventStream";
import { formatDiceResult, rollFromNotation } from "../runtime/diceEngine";
import { validateLoreKeys } from "../runtime/loreTriggerEngine";
import type { ImportedCard } from "./cardImport";
import {
  defaultNewCard,
  defaultProviderSettings,
} from "./appDefaults";
import {
  downloadJson,
  formatDownloadTimestamp,
  getErrorMessage,
  parseList,
  toBoundedNumber,
} from "./appUtils";
import {
  createEmptyLorebook,
  createInitialStoryEntities,
  normalizeRuntimeCards,
} from "./cardNormalization";
import {
  archiveActiveChatState,
  deleteActiveChatState,
  restoreArchivedChatState,
} from "./chatLifecycle";
import {
  advanceChatSessionRollingSummary,
  buildChatExportPayload,
  buildWriteForMeDraft,
  cloneMessagesForBranch,
  createChatSession,
  createRuntimeEntityId,
  filterPersistedOpeningMessages,
  getActiveChatForCard,
  getCardChats,
  renameChatSession,
  setChatArchived,
  upsertChatSession,
} from "./chatSessions";
import {
  branchChatTurnState,
  deriveCardForChat,
  forkChatForMessageEdit,
  initializeChatTurnState,
  rebaseChatTurnState,
  switchChatMessageVariant,
  undoChatTurnEffects,
} from "./chatTurnState";
import { findGeneratedMapForChat } from "./generatedImages";
import { buildRuntimeCardFromDraft } from "./runtimeCardFactory";
import type {
  CardTab,
  ChatSession,
  GeneratedMapArtifact,
  Lorebook,
  LorebookEntry,
  MainSection,
  Message,
  NewLorebookEntry,
  PromptRun,
  ProviderSettings,
  RpgCardState,
  RuntimeCard,
  RuntimeSettings,
} from "./runtimeTypes";
import { PLAYABLE_SAMPLE_RPG } from "./starterContent";

interface UseRuntimeContentManagementOptions {
  cards: RuntimeCard[];
  setCards: Dispatch<SetStateAction<RuntimeCard[]>>;
  activeCardId: string;
  setActiveCardId: Dispatch<SetStateAction<string>>;
  activeCard: RuntimeCard | null;
  chatSessions: ChatSession[];
  setChatSessions: Dispatch<SetStateAction<ChatSession[]>>;
  activeChatIds: Record<string, string>;
  setActiveChatIds: Dispatch<SetStateAction<Record<string, string>>>;
  activeChat?: ChatSession;
  messages: Message[];
  promptRuns: PromptRun[];
  setPromptRuns: Dispatch<SetStateAction<PromptRun[]>>;
  generatedMaps: GeneratedMapArtifact[];
  setGeneratedMaps: Dispatch<SetStateAction<GeneratedMapArtifact[]>>;
  newCard: typeof defaultNewCard;
  setNewCard: Dispatch<SetStateAction<typeof defaultNewCard>>;
  setDraft: Dispatch<SetStateAction<string>>;
  runtimeSettings: RuntimeSettings;
  setRuntimeSettings: Dispatch<SetStateAction<RuntimeSettings>>;
  setSection: Dispatch<SetStateAction<MainSection>>;
  setCardTab: Dispatch<SetStateAction<CardTab>>;
  setRuntimeRunning: Dispatch<SetStateAction<boolean>>;
  setRuleWarning: Dispatch<SetStateAction<string | null>>;
  setOnboardingDismissed: Dispatch<SetStateAction<boolean>>;
  setMapPrompt: Dispatch<SetStateAction<string | null>>;
  setImagePromptDraft: Dispatch<SetStateAction<string>>;
  setImageNegativePromptDraft: Dispatch<SetStateAction<string>>;
  setPhotoSpecDraft: Dispatch<SetStateAction<string>>;
  setPhotoPrompt: Dispatch<SetStateAction<string>>;
  setMapArtifact: Dispatch<SetStateAction<GeneratedMapArtifact | null>>;
  setPhotoArtifact: Dispatch<SetStateAction<GeneratedMapArtifact | null>>;
  setProviderSettings: Dispatch<SetStateAction<ProviderSettings>>;
  setSessionApiKey: Dispatch<SetStateAction<string>>;
  setProviderKeyStatus: Dispatch<SetStateAction<string>>;
  generateCustomImageFromRequest: (specOverride?: string) => Promise<void>;
  generationInFlightRef?: MutableRefObject<boolean>;
}

export function useRuntimeContentManagement(options: UseRuntimeContentManagementOptions) {
  const {
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
    messages,
    promptRuns,
    setPromptRuns,
    generatedMaps,
    setGeneratedMaps,
    newCard,
    setNewCard,
    setDraft,
    runtimeSettings,
    setRuntimeSettings,
    setSection,
    setCardTab,
    setRuntimeRunning,
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
    generationInFlightRef: providedGenerationInFlightRef,
  } = options;
  const fallbackGenerationInFlightRef = useRef(false);
  const generationInFlightRef = providedGenerationInFlightRef ?? fallbackGenerationInFlightRef;
  const [pendingDeleteChatId, setPendingDeleteChatId] = useState<string | null>(null);
  const [pendingDeleteCardId, setPendingDeleteCardId] = useState<string | null>(null);
  const [newCardError, setNewCardError] = useState<string | null>(null);
  const [lorebookEntryError, setLorebookEntryError] = useState<string | null>(null);

  function blockMutationDuringGeneration(): boolean {
    if (!generationInFlightRef.current) {
      return false;
    }
    setRuleWarning("Stop the in-flight generation before changing chat or card continuity.");
    return true;
  }

  function resetMediaDrafts(clearArtifacts: boolean): void {
    setMapPrompt(null);
    setImagePromptDraft("");
    setImageNegativePromptDraft("");
    setPhotoSpecDraft("");
    setPhotoPrompt("");
    if (clearArtifacts) {
      setMapArtifact(null);
      setPhotoArtifact(null);
    }
  }

  function ensureChatForCard(card: RuntimeCard): void {
    const existing = getCardChats(card.id, chatSessions)[0];
    if (existing) {
      setActiveChatIds((current) => {
        const currentChatId = current[card.id];
        const currentChatIsUsable = chatSessions.some(
          (chat) => chat.id === currentChatId && chat.cardId === card.id && !chat.archived,
        );
        return { ...current, [card.id]: currentChatIsUsable ? currentChatId : existing.id };
      });
      return;
    }

    const chat = initializeChatTurnState(createChatSession(card.id, `${card.name} chat`), card);
    setChatSessions((current) => [...current, chat]);
    setActiveChatIds((current) => ({ ...current, [card.id]: chat.id }));
  }

  function commitManualActiveCardState(nextCard: RuntimeCard): void {
    if (blockMutationDuringGeneration()) return;
    setCards((current) => current.map((card) => (card.id === nextCard.id ? nextCard : card)));
    if (activeChat) {
      const rebasedChat = rebaseChatTurnState(activeChat, nextCard);
      setChatSessions((current) => upsertChatSession(current, rebasedChat));
    }
  }

  function selectCard(card: RuntimeCard): void {
    if (blockMutationDuringGeneration()) return;
    const openedCard = card.archived ? { ...card, archived: false } : card;
    const selectedChat = getActiveChatForCard(card.id, chatSessions, activeChatIds);
    const selectedCard = selectedChat ? deriveCardForChat(openedCard, selectedChat) : openedCard;
    setCards((current) => current.map((candidate) => (candidate.id === card.id ? selectedCard : candidate)));
    setActiveCardId(card.id);
    setCardTab("chat");
    setSection("runtime");
    setRuleWarning(null);
    setPendingDeleteChatId(null);
    setPendingDeleteCardId(null);
    resetMediaDrafts(false);
    setMapArtifact(findGeneratedMapForChat(generatedMaps, card.id, selectedChat?.id, "map"));
    setPhotoArtifact(findGeneratedMapForChat(generatedMaps, card.id, selectedChat?.id, "photo"));
    setRuntimeRunning(true);
    ensureChatForCard(card);
  }

  function updateCardLibraryState(
    cardId: string,
    patch: Pick<RuntimeCard, "favorite" | "archived">,
  ): void {
    if (blockMutationDuringGeneration()) return;
    setCards((current) => current.map((card) => card.id === cardId ? { ...card, ...patch } : card));
    if (patch.archived && activeCardId === cardId) {
      setActiveCardId("");
      setSection("cards");
    }
  }

  function startMockDemo(): void {
    if (blockMutationDuringGeneration()) return;
    const existingCard = cards.find((card) => card.id === PLAYABLE_SAMPLE_RPG.id);
    const sample = normalizeRuntimeCards([{ ...(existingCard ?? PLAYABLE_SAMPLE_RPG), archived: false }])[0];
    const existingChat = getCardChats(sample.id, chatSessions, { includeArchived: true })[0];
    const chat = existingChat
      ? setChatArchived(existingChat, false)
      : initializeChatTurnState(createChatSession(sample.id, `${sample.name} chat`), sample);

    setCards((current) => current.some((card) => card.id === sample.id)
      ? current.map((card) => card.id === sample.id ? sample : card)
      : [sample, ...current]);
    setChatSessions((current) => upsertChatSession(current, chat));
    setActiveChatIds((current) => ({ ...current, [sample.id]: chat.id }));
    setActiveCardId(sample.id);
    setProviderSettings({ ...defaultProviderSettings });
    setSessionApiKey("");
    setProviderKeyStatus("Mock provider active; no API key, network request, or model call is needed.");
    setRuntimeRunning(true);
    setCardTab("chat");
    setSection("runtime");
    setRuntimeSettings((current) => ({ ...current, onboardingCompleted: true }));
    setOnboardingDismissed(true);
    setRuleWarning(null);
    setDraft("");
  }

  function editCard(card: RuntimeCard): void {
    if (blockMutationDuringGeneration()) return;
    const selectedChat = getActiveChatForCard(card.id, chatSessions, activeChatIds);
    const selectedCard = selectedChat ? deriveCardForChat(card, selectedChat) : card;
    setCards((current) => current.map((candidate) => (candidate.id === card.id ? selectedCard : candidate)));
    setActiveCardId(card.id);
    setCardTab("instructions");
    setSection("cards");
    setRuleWarning(null);
    setPendingDeleteChatId(null);
    setPendingDeleteCardId(null);
    ensureChatForCard(card);
  }

  function createCard(): boolean {
    if (blockMutationDuringGeneration()) return false;
    if (!newCard.name.trim()) {
      setNewCardError("Enter a card name before creating a card.");
      return false;
    }
    setNewCardError(null);

    const cardId = createRuntimeEntityId("card");
    const card = buildRuntimeCardFromDraft(newCard, cardId);
    setCards((current) => [...current, card]);
    const chat = initializeChatTurnState(createChatSession(card.id, `${card.name} chat`), card);
    setChatSessions((current) => [...current, chat]);
    setActiveChatIds((current) => ({ ...current, [card.id]: chat.id }));
    setActiveCardId(card.id);
    setSection("runtime");
    setCardTab("chat");
    setNewCard(defaultNewCard);
    setPendingDeleteCardId(null);
    return true;
  }

  function importCard(result: ImportedCard): void {
    if (blockMutationDuringGeneration()) return;
    const [card] = normalizeRuntimeCards([result.card]);
    setCards((current) => [...current, card]);
    const chat = initializeChatTurnState(createChatSession(card.id, `${card.name} chat`), card);
    setChatSessions((current) => [...current, chat]);
    setActiveChatIds((current) => ({ ...current, [card.id]: chat.id }));
    setActiveCardId(card.id);
    setCardTab("chat");
    setPendingDeleteCardId(null);
    setSection("runtime");
  }

  function updateActiveCard(patch: Partial<RuntimeCard>): void {
    if (!activeCard || blockMutationDuringGeneration()) {
      return;
    }
    const nextCard = { ...activeCard, ...patch };
    if ("memory" in patch || "storyEntities" in patch || "rpg" in patch) {
      commitManualActiveCardState(nextCard);
      return;
    }
    setCards((current) => current.map((card) => (card.id === activeCard.id ? nextCard : card)));
  }

  function clearStoryCharacters(): void {
    if (!activeCard || blockMutationDuringGeneration()) {
      return;
    }
    commitManualActiveCardState({
      ...activeCard,
      storyEntities: createInitialStoryEntities(activeCard.id, {
        cardKind: activeCard.kind,
        cardCharacterName: activeCard.characterName,
      }),
    });
    setGeneratedMaps((current) =>
      current.filter((artifact) => artifact.cardId !== activeCard.id || artifact.imageKind !== "character"),
    );
  }

  function selectChat(chatId: string): void {
    if (!activeCard || blockMutationDuringGeneration()) {
      return;
    }
    const chat = chatSessions.find(
      (candidate) => candidate.id === chatId && candidate.cardId === activeCard.id && !candidate.archived,
    );
    if (!chat) {
      return;
    }
    const nextCard = deriveCardForChat(activeCard, chat);
    setCards((current) => current.map((card) => (card.id === activeCard.id ? nextCard : card)));
    setActiveChatIds((current) => ({ ...current, [activeCard.id]: chat.id }));
    setRuleWarning(null);
    setPendingDeleteChatId(null);
    setDraft("");
    resetMediaDrafts(false);
    setMapArtifact(findGeneratedMapForChat(generatedMaps, activeCard.id, chat.id, "map"));
    setPhotoArtifact(findGeneratedMapForChat(generatedMaps, activeCard.id, chat.id, "photo"));
  }

  function startNewChatForActiveCard(): void {
    if (!activeCard || blockMutationDuringGeneration()) {
      return;
    }
    const chat = initializeChatTurnState(
      createChatSession(activeCard.id, `${activeCard.name} chat ${getCardChats(activeCard.id, chatSessions).length + 1}`),
      activeCard,
    );
    setChatSessions((current) => [...current, chat]);
    setActiveChatIds((current) => ({ ...current, [activeCard.id]: chat.id }));
    setRuleWarning(null);
    setPendingDeleteChatId(null);
    setDraft("");
    resetMediaDrafts(true);
  }

  function branchActiveChat(): void {
    if (!activeCard || !activeChat || blockMutationDuringGeneration()) {
      return;
    }
    const branchId = createRuntimeEntityId("chat");
    const branchDraft = createChatSession(activeCard.id, `${activeChat.title || activeCard.name} branch`, {
      id: branchId,
      branchOfId: activeChat.id,
      branchedFromMessageId: activeChat.messages[activeChat.messages.length - 1]?.id,
      messages: cloneMessagesForBranch(activeChat.messages, branchId),
    });
    const branch = branchChatTurnState(activeChat, branchDraft, activeCard);
    setChatSessions((current) => [...current, branch]);
    setActiveChatIds((current) => ({ ...current, [activeCard.id]: branch.id }));
    setRuleWarning(null);
    setPendingDeleteChatId(null);
    setDraft("");
    resetMediaDrafts(true);
  }

  function deleteActiveChat(): void {
    if (!activeCard || !activeChat || blockMutationDuringGeneration()) {
      return;
    }
    if (pendingDeleteChatId !== activeChat.id) {
      setPendingDeleteChatId(activeChat.id);
      setRuleWarning("Click Confirm delete chat to permanently remove this chat.");
      return;
    }

    const result = deleteActiveChatState({
      activeCard,
      activeChat,
      cards,
      chatSessions,
      activeChatIds,
      promptRuns,
      generatedMaps,
      createFallbackChat: () => initializeChatTurnState(
        createChatSession(activeCard.id, `${activeCard.name} chat`),
        activeCard,
      ),
    });
    setPendingDeleteChatId(null);
    setChatSessions(result.chatSessions);
    setActiveChatIds(result.activeChatIds);
    setCards(result.cards);
    setPromptRuns(result.promptRuns);
    setGeneratedMaps(result.generatedMaps);
    resetMediaDrafts(true);
    setDraft("");
    setRuleWarning(null);
  }

  function renameActiveChat(title: string): void {
    if (!activeChat || blockMutationDuringGeneration()) return;
    try {
      setChatSessions((current) => upsertChatSession(current, renameChatSession(activeChat, title)));
      setRuleWarning(null);
    } catch (error) {
      setRuleWarning(getErrorMessage(error));
    }
  }

  function archiveActiveChat(): void {
    if (!activeCard || !activeChat || blockMutationDuringGeneration()) return;
    const result = archiveActiveChatState({
      activeCard,
      activeChat,
      cards,
      chatSessions,
      activeChatIds,
      createFallbackChat: () => initializeChatTurnState(
        createChatSession(activeCard.id, `${activeCard.name} chat`),
        activeCard,
      ),
    });
    setChatSessions(result.chatSessions);
    setActiveChatIds(result.activeChatIds);
    setCards(result.cards);
    setDraft("");
    setRuleWarning(null);
  }

  function restoreArchivedChat(chatId: string): void {
    if (!activeCard || blockMutationDuringGeneration()) return;
    const archived = chatSessions.find((chat) => chat.id === chatId && chat.cardId === activeCard.id && chat.archived);
    if (!archived) return;
    const result = restoreArchivedChatState({
      activeCard,
      archivedChat: archived,
      cards,
      chatSessions,
      activeChatIds,
    });
    setChatSessions(result.chatSessions);
    setActiveChatIds(result.activeChatIds);
    setCards(result.cards);
    setDraft("");
    setRuleWarning(null);
  }

  function exportActiveChat(): void {
    if (!activeCard || !activeChat) return;
    const exportedAt = new Date().toISOString();
    downloadJson(
      `local-first-rpg-chat-${formatDownloadTimestamp(exportedAt)}.json`,
      buildChatExportPayload(activeChat, activeCard),
    );
  }

  function deleteCard(cardId: string): void {
    if (cards.length <= 1 || blockMutationDuringGeneration()) {
      return;
    }
    if (pendingDeleteCardId !== cardId) {
      setPendingDeleteCardId(cardId);
      return;
    }

    const fallback = cards.find((card) => card.id !== cardId) ?? cards[0];
    setPendingDeleteCardId(null);
    setCards((current) => current.filter((card) => card.id !== cardId));
    setChatSessions((current) => current.filter((chat) => chat.cardId !== cardId));
    setActiveChatIds((current) => {
      const next = { ...current };
      delete next[cardId];
      return next;
    });
    setPromptRuns((current) => current.filter((run) => run.cardId !== cardId));
    setGeneratedMaps((current) => current.filter((artifact) => artifact.cardId !== cardId));
    if (activeCard?.id === cardId) {
      setActiveCardId(fallback.id);
      ensureChatForCard(fallback);
      const fallbackChatId = getActiveChatForCard(fallback.id, chatSessions, activeChatIds)?.id;
      setMapArtifact(findGeneratedMapForChat(generatedMaps, fallback.id, fallbackChatId, "map"));
      setPhotoArtifact(findGeneratedMapForChat(generatedMaps, fallback.id, fallbackChatId, "photo"));
    }
  }

  function writeForMe(): void {
    if (!activeCard || blockMutationDuringGeneration()) {
      return;
    }
    setDraft(buildWriteForMeDraft(activeCard, messages));
  }

  function updateActiveRpgState(patch: Partial<RpgCardState>): void {
    if (!activeCard?.rpg || blockMutationDuringGeneration()) {
      return;
    }
    commitManualActiveCardState({
      ...activeCard,
      rpg: { ...activeCard.rpg, ...patch },
    });
  }

  function updateActiveLorebook(
    lorebookId: string,
    patch: Partial<Omit<Lorebook, "id" | "entries">>,
  ): void {
    if (!activeCard || blockMutationDuringGeneration()) {
      return;
    }
    setCards((current) => current.map((card) => card.id !== activeCard.id
      ? card
      : {
          ...card,
          lorebooks: card.lorebooks.map((lorebook) =>
            lorebook.id === lorebookId ? { ...lorebook, ...patch } : lorebook,
          ),
        }));
  }

  function updateLorebook(cardId: string, lorebookId: string, lorebook: Lorebook): void {
    if (blockMutationDuringGeneration()) return;
    setCards((current) => current.map((card) => card.id === cardId
      ? {
          ...card,
          lorebooks: card.lorebooks.map((candidate) => candidate.id === lorebookId ? lorebook : candidate),
        }
      : card));
  }

  function importLorebookToActiveCard(lorebook: Lorebook): void {
    if (!activeCard || blockMutationDuringGeneration()) {
      return;
    }
    setCards((current) => current.map((card) => card.id === activeCard.id
      ? { ...card, lorebooks: [...card.lorebooks, lorebook] }
      : card));
    setSection("lorebooks");
  }

  function addLorebookEntry(lorebookId: string, entry: NewLorebookEntry): boolean {
    if (!activeCard) {
      setLorebookEntryError("Open a card before adding lorebook entries.");
      return false;
    }
    if (blockMutationDuringGeneration()) return false;
    if (!entry.content.trim()) {
      setLorebookEntryError("Enter lorebook entry content before adding an entry.");
      return false;
    }

    const keys = parseList(entry.keys);
    const aliases = parseList(entry.aliases ?? "");
    const secondaryKeys = parseList(entry.secondaryKeys);
    const keyError = validateLoreKeys([...keys, ...secondaryKeys], entry.matchMode);
    if (keyError) {
      setLorebookEntryError(keyError);
      return false;
    }
    setLorebookEntryError(null);

    const nextEntry: LorebookEntry = {
      id: `lore_entry_${Date.now()}`,
      title: entry.title.trim() || "Untitled lore entry",
      keys,
      aliases,
      secondaryKeys,
      content: entry.content.trim(),
      insertionOrder: toBoundedNumber(entry.insertionOrder, 100, 0, 10_000),
      priority: toBoundedNumber(entry.priority, 0, -100, 100),
      enabled: true,
      constant: entry.constant,
      probability: toBoundedNumber(entry.probability, 100, 0, 100),
      caseSensitive: entry.caseSensitive,
      wholeWord: entry.wholeWord,
      matchMode: entry.matchMode,
      literalMatchBehavior: entry.literalMatchBehavior ?? "boundary",
      scanScopes: entry.scanScopes,
    };

    setCards((current) => current.map((card) => {
      if (card.id !== activeCard.id) {
        return card;
      }
      const targetLorebook = card.lorebooks.find((lorebook) => lorebook.id === lorebookId)
        ?? createEmptyLorebook(card.id, "Card Lorebook");
      const updatedLorebook = { ...targetLorebook, entries: [...targetLorebook.entries, nextEntry] };
      const hasExistingLorebook = card.lorebooks.some((lorebook) => lorebook.id === targetLorebook.id);
      return {
        ...card,
        lorebooks: hasExistingLorebook
          ? card.lorebooks.map((lorebook) => lorebook.id === targetLorebook.id ? updatedLorebook : lorebook)
          : [...card.lorebooks, updatedLorebook],
      };
    }));
    return true;
  }

  function editMessageContent(messageId: string, content: string): void {
    if (!activeCard || !activeChat || blockMutationDuringGeneration()) {
      return;
    }
    const trimmed = content.trim();
    if (!trimmed) {
      return;
    }
    const branchId = createRuntimeEntityId("chat");
    const branch = forkChatForMessageEdit(activeChat, activeCard, messageId, trimmed, branchId);
    if (!branch) {
      setRuleWarning("That message could not be edited safely.");
      return;
    }
    const nextCard = deriveCardForChat(activeCard, branch);
    setChatSessions((current) => [...current, branch]);
    setActiveChatIds((current) => ({ ...current, [activeCard.id]: branch.id }));
    setCards((current) => current.map((card) => (card.id === activeCard.id ? nextCard : card)));
    setDraft("");
    setRuleWarning("Edited message opened a branch; downstream turns remain in the original chat.");
  }

  function swipeMessageVariant(messageId: string, direction: -1 | 1): void {
    if (!activeCard || !activeChat || blockMutationDuringGeneration()) {
      return;
    }
    const result = switchChatMessageVariant(activeChat, activeCard, messageId, direction);
    if (!result.changed) {
      setRuleWarning(result.reason ?? "That response variant could not be selected.");
      return;
    }
    const nextCard = deriveCardForChat(activeCard, result.chat);
    setChatSessions((current) => upsertChatSession(current, result.chat));
    setCards((current) => current.map((card) => (card.id === activeCard.id ? nextCard : card)));
    setRuleWarning(null);
  }

  function undoTurnEffects(messageId: string): void {
    if (!activeCard || !activeChat || blockMutationDuringGeneration()) {
      return;
    }
    const result = undoChatTurnEffects(activeChat, activeCard, messageId);
    if (!result.changed) {
      setRuleWarning(result.reason ?? "Those state changes could not be undone.");
      return;
    }
    const nextCard = deriveCardForChat(activeCard, result.chat);
    setChatSessions((current) => upsertChatSession(current, result.chat));
    setCards((current) => current.map((card) => (card.id === activeCard.id ? nextCard : card)));
    setRuleWarning("State changes undone for this response variant.");
  }

  function postDiceRoll(notation: string): void {
    if (!activeCard) {
      setRuleWarning("Open a card before rolling dice.");
      return;
    }
    if (blockMutationDuringGeneration()) return;
    const rolled = rollFromNotation(notation);
    if (!rolled) {
      setRuleWarning("Invalid dice notation. Try something like /roll 2d6+3.");
      return;
    }
    const rollChat = activeChat ?? initializeChatTurnState(
      createChatSession(activeCard.id, `${activeCard.name} chat`),
      activeCard,
    );
    if (!activeChat) {
      setActiveChatIds((current) => ({ ...current, [activeCard.id]: rollChat.id }));
    }
    const diceRunId = createRuntimeEntityId("run");
    const diceMessage: Message = {
      id: `dice-${diceRunId}`,
      role: "user",
      content: formatDiceResult(rolled),
    };
    const occurredAt = new Date().toISOString();
    let authoritativeEvents = appendAuthoritativeEvent(
      rollChat.authoritativeEvents ?? [],
      createDiceRolledEvent({
        id: `event-${diceRunId}-dice`,
        chatId: rollChat.id,
        branchId: rollChat.id,
        messageId: diceMessage.id,
        occurredAt,
        roll: rolled,
      }),
    );
    authoritativeEvents = appendAuthoritativeEvent(
      authoritativeEvents,
      createToolResultEvent({
        id: `event-${diceRunId}-tool`,
        chatId: rollChat.id,
        branchId: rollChat.id,
        messageId: diceMessage.id,
        occurredAt,
        runId: diceRunId,
        toolName: "dice.roll",
        callId: diceRunId,
        status: "success",
        result: {
          notation: rolled.notation,
          count: rolled.count,
          sides: rolled.sides,
          modifier: rolled.modifier,
          rolls: [...rolled.rolls],
          total: rolled.total,
        },
      }),
    );
    const rollMessages = [...filterPersistedOpeningMessages(rollChat.messages), diceMessage];
    setChatSessions((current) => upsertChatSession(current, {
      ...rollChat,
      messages: rollMessages,
      authoritativeEvents,
      rollingSummary: advanceChatSessionRollingSummary(rollChat, rollMessages, occurredAt),
      updatedAt: occurredAt,
    }));
    setDraft("");
    setRuleWarning("");
  }

  async function runSlashCommand(name: string, args: string): Promise<void> {
    if (name === "roll") {
      if (!runtimeSettings.diceRollsEnabled) {
        setRuleWarning("Dice rolls are turned off. Enable them in Settings to use /roll.");
        return;
      }
      postDiceRoll(args);
      return;
    }
    if (name === "branch") {
      if (!activeChat) {
        setRuleWarning("Start a chat before branching.");
        return;
      }
      branchActiveChat();
      return;
    }
    if (name === "img") {
      const prompt = args.trim();
      if (!prompt) {
        setRuleWarning("Describe the image, e.g. /img a storm over the harbor.");
        return;
      }
      setDraft("");
      setRuleWarning("");
      await generateCustomImageFromRequest(prompt);
    }
  }

  return {
    pendingDeleteChatId,
    setPendingDeleteChatId,
    pendingDeleteCardId,
    setPendingDeleteCardId,
    newCardError,
    lorebookEntryError,
    selectCard,
    updateCardLibraryState,
    startMockDemo,
    editCard,
    createCard,
    importCard,
    updateActiveCard,
    commitManualActiveCardState,
    clearStoryCharacters,
    ensureChatForCard,
    selectChat,
    startNewChatForActiveCard,
    branchActiveChat,
    deleteActiveChat,
    renameActiveChat,
    archiveActiveChat,
    restoreArchivedChat,
    exportActiveChat,
    deleteCard,
    writeForMe,
    updateActiveRpgState,
    updateActiveLorebook,
    updateLorebook,
    importLorebookToActiveCard,
    addLorebookEntry,
    editMessageContent,
    swipeMessageVariant,
    undoTurnEffects,
    postDiceRoll,
    runSlashCommand,
  };
}
