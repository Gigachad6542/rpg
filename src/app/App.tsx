import {
  type CSSProperties,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  applyHiddenContinuityToCard,
  buildVisibleUserMessageWithHiddenContinuity,
  createEmptyHiddenContinuityResult,
  runHiddenContinuityPassSafely,
} from "../runtime/hiddenContinuity";
import { createRuntimeTurnEffects } from "../runtime/runtimeTurnLineage";
import { resolveModelCallBudget } from "../runtime/modelCallBudget";
import { resolveHiddenContinuityPlan } from "../runtime/hiddenContinuityPolicy";
import { resolveModelPricing } from "../runtime/modelCallTelemetry";
import { detectKnowledgeLeaks, describeKnowledgeLeaks } from "../runtime/knowledgeLeakDetector";
import {
  selectLorebookEntriesWithProvenanceForPreview,
  selectActiveLorebookEntriesSafely,
  type LoreTriggerProvenance,
  validateLoreKeys,
} from "../runtime/loreTriggerEngine";
import { formatDiceResult, rollFromNotation } from "../runtime/diceEngine";
import {
  appendAuthoritativeEvent,
  createDiceRolledEvent,
  createPlayerActionEvent,
  createRuleDecisionEvent,
  createStateCommittedEvent,
  createToolResultEvent,
  type AuthoritativeEventStream,
} from "../runtime/authoritativeEventStream";
import { parseSlashCommand } from "../runtime/slashCommands";
import {
  deriveStatusBlockLocationProposal,
  stripTrailingCallToAction,
} from "./assistantMessageParsing";
import {
  buildTurnSystemPrompt,
  compileTurnPrompt,
  runTurnPipeline,
  TURN_PIPELINE_LAYER_IDS,
} from "../runtime/turnPipeline";
import { runMemoryConsolidationSafely } from "../runtime/memoryConsolidation";
import {
  validatePlayerAction as validatePlayerActionWithRules,
} from "../runtime/playerRuleEngine";
import { requireSecureKeyStorage } from "../security/keyStorage";
import { loadLocalRuntimeSnapshot } from "./localRuntimeStore";
import { SettingsSection } from "./SettingsSection";
import { OnboardingOverlay } from "./OnboardingOverlay";
import { shouldShowOnboarding } from "./startupPersistencePolicy";
import { HydrationGate } from "./HydrationGate";
import {
  filterHiddenContinuityForPolicy,
  filterValidatedTurnEffectsForPolicy,
} from "./turnEffects";

import type {
  AppRuntimeSnapshot,
  CardTab,
  ChatSession,
  ImageProviderSettings,
  Lorebook,
  LorebookEntry,
  MainSection,
  MemoryEntry,
  Message,
  ModelCallRecord,
  NewLorebookEntry,
  Persona,
  PromptRun,
  ProviderSettings,
  RpgCardState,
  RuntimeCard,
  RuntimeSettings,
  Theme,
} from "./runtimeTypes";
import {
  downloadJson,
  findScrollableAncestor,
  formatDownloadTimestamp,
  formatRestorePointTime,
  getErrorMessage,
  parseList,
  toBoundedNumber,
} from "./appUtils";
import {
  buildWriteForMeDraft,
  buildChatExportPayload,
  advanceChatSessionRollingSummary,
  cloneMessagesForBranch,
  createChatSession,
  createRuntimeEntityId,
  deriveChatTitle,
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
  deriveCardForRegeneration,
  forkChatForMessageEdit,
  initializeChatTurnState,
  rebaseChatTurnState,
  recordChatTurnVariant,
  recordRegeneratedChatVariant,
  switchChatMessageVariant,
  undoChatTurnEffects,
} from "./chatTurnState";
import {
  createEmptyLorebook,
  createInitialStoryEntities,
  normalizeRuntimeCards,
  toHiddenContinuityCard,
} from "./cardNormalization";
import {
  applyPromptDebugRetention,
  createTextProvider,
  getConfiguredTextModelInfo,
  getConfiguredTextModelInfoForModel,
  getProviderPricingSnapshots,
} from "./providerConfig";
import {
  buildCharacterPortraitPrompt,
  findCharacterPortraitsForCard,
  findGeneratedMapForChat,
} from "./generatedImages";
import {
  buildResponseContract,
  buildTurnPromptRequest,
  formatDetailedCharacterDefinition,
  isTauriRuntime,
  toVisibleTurnBudget,
} from "./turnPromptBuilders";
import type { ImportedCard } from "./cardImport";
import {
  defaultNewCard,
  defaultProviderSettings,
  emptyCompiledPrompt,
  initialCards,
  randomOpeningAction,
  starterMessages,
} from "./appDefaults";
import { PLAYABLE_SAMPLE_RPG } from "./starterContent";
import { getReadinessChecklist } from "./readiness";
import {
  collectActiveLorebooks,
  createPersona,
  deletePersona,
  getActivePersona,
  parseActivePersonaId,
  setDefaultPersona,
  updatePersona,
} from "./personas";
import { NoActiveCardRuntimePanel, RuntimeSection } from "./RuntimeSection";
import { CardsSection } from "./CardsSection";
import { GlobalLorebooksSection } from "./GlobalLorebooksSection";
import { ProvidersSection } from "./ProvidersSection";
import { MediaPreviewDialog, MemoryDrawer } from "./Overlays";
import { buildAuthoritativeStateMutations } from "./authoritativeStateMutations";
import {
  createModelCallCaptureAdapter,
  elapsedMilliseconds,
  readMonotonicMilliseconds,
  toModelCallRecord,
  type TextModelCallOutcome,
} from "./modelCallTelemetryAdapter";
import {
  disableLoreEntriesInCard,
  disableLoreEntriesInPersona,
  isAbortError,
} from "./appControllerHelpers";
import { buildRuntimeCardFromDraft } from "./runtimeCardFactory";
import {
  resolveRuntimeSnapshotState,
  type ResolvedRuntimeSnapshotState,
} from "./runtimeSnapshotHydration";
import { AppSidebar, AppTopbar } from "./AppChrome";
import {
  archiveActiveChatState,
  deleteActiveChatState,
  restoreArchivedChatState,
} from "./chatLifecycle";
import { useProviderManagement } from "./useProviderManagement";
import { useRuntimePersistence } from "./useRuntimePersistence";
import { useRuntimeDataManagement } from "./useRuntimeDataManagement";
import { useMediaGeneration } from "./useMediaGeneration";

interface MemoryConsolidationReview {
  cardId: string;
  originalMemory: MemoryEntry[];
  proposedMemory: MemoryEntry[];
}

export function App() {
  const [initialSnapshot] = useState(() => loadLocalRuntimeSnapshot<RuntimeCard, Message, PromptRun, ChatSession>());
  const [initialRuntimeState] = useState(() => resolveRuntimeSnapshotState(initialSnapshot, {
    fallbackCards: initialCards,
    fallbackMessages: starterMessages,
  }));
  const pendingReviewRef = useRef<Record<string, string[]>>({});
  const keyStorageRef = useRef(requireSecureKeyStorage());
  const [theme, setTheme] = useState<Theme>(() => initialRuntimeState.theme);
  const [section, setSection] = useState<MainSection>("runtime");
  const [cards, setCards] = useState<RuntimeCard[]>(() => initialRuntimeState.cards);
  const [activeCardId, setActiveCardId] = useState(() => initialRuntimeState.activeCardId);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>(() => initialRuntimeState.chatSessions);
  const [activeChatIds, setActiveChatIds] = useState<Record<string, string>>(() => initialRuntimeState.activeChatIds);
  const [cardTab, setCardTab] = useState<CardTab>("chat");
  const [draft, setDraft] = useState("");
  const [runtimeRunning, setRuntimeRunning] = useState(true);
  const [promptRuns, setPromptRuns] = useState<PromptRun[]>(() => initialRuntimeState.promptRuns);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [ruleWarning, setRuleWarning] = useState<string | null>(null);
  const [newCard, setNewCard] = useState(defaultNewCard);
  const [providerSettings, setProviderSettings] = useState<ProviderSettings>(() => initialRuntimeState.providerSettings);
  const [imageProviderSettings, setImageProviderSettings] = useState<ImageProviderSettings>(() => initialRuntimeState.imageProviderSettings);
  const [runtimeSettings, setRuntimeSettings] = useState<RuntimeSettings>(() => initialRuntimeState.runtimeSettings);
  const [personas, setPersonas] = useState<Persona[]>(() => initialRuntimeState.personas);
  const [activePersonaId, setActivePersonaId] = useState(() => initialRuntimeState.activePersonaId);
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingReply, setStreamingReply] = useState("");
  const [isConsolidatingMemory, setIsConsolidatingMemory] = useState(false);
  const [memoryConsolidationStatus, setMemoryConsolidationStatus] = useState<string | null>(null);
  const [memoryConsolidationReview, setMemoryConsolidationReview] = useState<MemoryConsolidationReview | null>(null);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [pendingDeleteChatId, setPendingDeleteChatId] = useState<string | null>(null);
  const [pendingDeleteCardId, setPendingDeleteCardId] = useState<string | null>(null);
  const [newCardError, setNewCardError] = useState<string | null>(null);
  const [lorebookEntryError, setLorebookEntryError] = useState<string | null>(null);
  const turnAbortControllerRef = useRef<AbortController | null>(null);

  const activeCard = cards.find((card) => card.id === activeCardId) ?? null;
  const activePersona = getActivePersona(personas, activePersonaId);
  const activeChat = activeCard ? getActiveChatForCard(activeCard.id, chatSessions, activeChatIds) : undefined;
  const {
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
  } = useProviderManagement({
    initialProviderKeyStatus: initialRuntimeState.providerKeyStatus,
    providerSettings,
    setProviderSettings,
    imageProviderSettings,
    setImageProviderSettings,
    providerTestCard: activeCard ?? cards[0],
    keyStorage: keyStorageRef.current,
    desktopRuntime: isTauriRuntime(),
    onComfyUiReady: () => {
      if (activeCard && activeChat) {
        void generateMissingCharacterPortraits(activeCard, activeChat.id, activeChat.messages);
      }
    },
  });
  const messages = useMemo(() => filterPersistedOpeningMessages(activeChat?.messages ?? []), [activeChat?.messages]);
  const visibleMessages = messages.filter((message) => message.role !== "system");
  const activeLoreSelection = useMemo(
    () => {
      if (!activeCard) {
        return { entries: [], triggers: [] };
      }
      return selectLorebookEntriesWithProvenanceForPreview({
        lorebooks: collectActiveLorebooks(activeCard, activePersona),
        messages,
        draft,
        context: activeCard.rpg
          ? {
              currentLocation: activeCard.rpg.location,
              activeQuests: activeCard.rpg.quests,
              inventory: activeCard.rpg.inventory,
              worldFlags: activeCard.rpg.flags,
            }
          : undefined,
        sources: {
          cardDefinition: formatDetailedCharacterDefinition(activeCard),
          personaDescription: activePersona?.description,
          memoryEntries: activeCard.memory.map((entry) => `${entry.label}: ${entry.detail}`),
        },
      });
    },
    [activeCard, activePersona, messages, draft],
  );
  const activeLorebookEntries = activeLoreSelection.entries;
  const activeLoreTriggers: LoreTriggerProvenance[] = activeLoreSelection.triggers;
  const {
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
  } = useMediaGeneration({
    initialGeneratedMaps: initialRuntimeState.generatedMaps,
    initialMapArtifact: initialRuntimeState.mapArtifact,
    initialPhotoArtifact: initialRuntimeState.photoArtifact,
    activeCard,
    activeChat,
    messages,
    activeLoreCount: activeLorebookEntries.length,
    providerSettings,
    sessionApiKey,
    runtimeSettings,
    imageProviderSettings,
    setImageProviderSettings,
    imageSessionApiKey,
    imageProviderStatus,
    comfyUiCheckpointModels,
    setRuleWarning,
    desktopRuntime: isTauriRuntime(),
  });

  // The prompt preview recompiles the full token-budgeted prompt, which is
  // expensive for large cards and lorebooks. Deferring the draft and lore inputs
  // keeps typing responsive under React's concurrent scheduler: the preview
  // recomputes at low priority instead of synchronously on every keystroke. The
  // live `draft` / `activeLorebookEntries` still drive the actual turn (see
  // generateMockTurn), so deferring only affects the preview, never what is sent.
  const deferredDraft = useDeferredValue(draft);
  const deferredLorebookEntries = useDeferredValue(activeLorebookEntries);
  const compiledPromptResult = useMemo(
    () => {
      if (!activeCard) {
        return emptyCompiledPrompt;
      }
      const previewModel = providerSettings.mode === "mock" ? "mock-narrator" : providerSettings.model;
      const previewBudget = resolveModelCallBudget({
        providerId: providerSettings.providerId,
        model: previewModel,
        phase: "visible-response",
        modelInfo: getConfiguredTextModelInfo(providerSettings),
      });
      return compileTurnPrompt({
        ...buildTurnPromptRequest(
          activeCard,
          deferredLorebookEntries,
          messages,
          deferredDraft,
          runtimeSettings,
          activePersona,
          {
            ...toVisibleTurnBudget(previewBudget),
            ...(activeChat
              ? {
                  retrievalContext: {
                    chatId: activeChat.id,
                    branchId: activeChat.id,
                    rollingSummary: activeChat.rollingSummary,
                  },
                }
              : {}),
          },
        ),
        includeLayerLabels: true,
      });
    },
    [activeCard, activeChat, activePersona, deferredLorebookEntries, deferredDraft, messages, providerSettings, runtimeSettings],
  );
  const compiledPrompt = useMemo(
    () => activeCard
      ? [
          "## Trusted system instructions",
          buildTurnSystemPrompt({ responseContract: buildResponseContract(runtimeSettings) }),
          "## User context",
          compiledPromptResult.prompt,
        ].join("\n\n")
      : "",
    [activeCard, compiledPromptResult.prompt, runtimeSettings],
  );
  const currentSnapshot = useMemo<AppRuntimeSnapshot>(
    () => ({
      version: 2 as const,
      theme,
      activeCardId,
      cards,
      messages,
      chatSessions,
      activeChatIds,
      promptRuns,
      providerKeyStatus,
      providerSettings,
      imageProviderSettings,
      runtimeSettings,
      personas,
      activePersonaId,
      generatedMaps,
      savedAt: new Date().toISOString(),
    }),
    [
      activeCardId,
      activePersonaId,
      cards,
      chatSessions,
      generatedMaps,
      imageProviderSettings,
      messages,
      personas,
      promptRuns,
      activeChatIds,
      providerKeyStatus,
      providerSettings,
      runtimeSettings,
      theme,
    ],
  );

  const applyResolvedRuntimeState = useCallback((state: ResolvedRuntimeSnapshotState) => {
    setTheme(state.theme);
    setCards(state.cards);
    setActiveCardId(state.activeCardId);
    setChatSessions(state.chatSessions);
    setActiveChatIds(state.activeChatIds);
    setPromptRuns(state.promptRuns);
    setProviderKeyStatus(state.providerKeyStatus);
    setProviderSettings(state.providerSettings);
    setImageProviderSettings(state.imageProviderSettings);
    setRuntimeSettings(state.runtimeSettings);
    setPersonas(state.personas);
    setActivePersonaId(state.activePersonaId);
    setGeneratedMaps(state.generatedMaps);
    setMapArtifact(state.mapArtifact);
    setPhotoArtifact(state.photoArtifact);
  }, [setGeneratedMaps, setMapArtifact, setPhotoArtifact, setProviderKeyStatus]);

  const {
    saveStatus,
    repositoryStatus,
    hydration,
    repositoryHydrated,
    restorePoints,
    restoreStatus,
    hydrateFromSnapshot,
    captureRestorePoint,
    retryHydration,
    archiveDatabaseAndStartFresh,
    restoreRuntimeFromPoint,
    getRepositoryBackend,
  } = useRuntimePersistence({
    initialSnapshot,
    currentSnapshot,
    applyResolvedRuntimeState,
  });
  const {
    dataManagementStatus,
    pendingImportReview,
    exportRuntimeData,
    importRuntimeData,
    applyRuntimeImport,
    cancelRuntimeImport,
    downloadDiagnostics,
  } = useRuntimeDataManagement({
    currentSnapshot,
    captureRestorePoint,
    hydrateFromSnapshot,
    repositoryStatus,
    saveStatus,
    providerKeyStatus,
    imageProviderStatus,
    getRepositoryBackend,
  });

  useEffect(() => {
    return () => turnAbortControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    function handleWheelZoom(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      event.preventDefault();
      const scrollTarget = findScrollableAncestor(event.target);
      if (scrollTarget) {
        scrollTarget.scrollTop += event.deltaY;
        scrollTarget.scrollLeft += event.deltaX;
        return;
      }

      window.scrollBy({
        left: event.deltaX,
        top: event.deltaY,
      });
    }

    window.addEventListener("wheel", handleWheelZoom, { capture: true, passive: false });
    return () => window.removeEventListener("wheel", handleWheelZoom, { capture: true });
  }, []);

  useEffect(() => {
    if (!runtimeSettings.promptDebugLogs) {
      setPromptRuns((current) => applyPromptDebugRetention(current, runtimeSettings));
    }
  }, [runtimeSettings]);

  function selectCard(card: RuntimeCard) {
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
    setMapPrompt(null);
    setImagePromptDraft("");
    setImageNegativePromptDraft("");
    setPhotoSpecDraft("");
    setPhotoPrompt("");
    setMapArtifact(findGeneratedMapForChat(generatedMaps, card.id, activeChatIds[card.id], "map"));
    setPhotoArtifact(findGeneratedMapForChat(generatedMaps, card.id, activeChatIds[card.id], "photo"));
    setRuntimeRunning(true);
    ensureChatForCard(card);
  }

  function updateCardLibraryState(
    cardId: string,
    patch: Pick<RuntimeCard, "favorite" | "archived">,
  ) {
    setCards((current) => current.map((card) => card.id === cardId ? { ...card, ...patch } : card));
    if (patch.archived && activeCardId === cardId) {
      setActiveCardId("");
      setSection("cards");
    }
  }

  function startMockDemo() {
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

  function editCard(card: RuntimeCard) {
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

  function importCard(result: ImportedCard) {
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

  function updateActiveCard(patch: Partial<RuntimeCard>) {
    if (!activeCard) {
      return;
    }
    const nextCard = { ...activeCard, ...patch };
    if ("memory" in patch || "storyEntities" in patch || "rpg" in patch) {
      commitManualActiveCardState(nextCard);
      return;
    }
    setCards((current) =>
      current.map((card) => (card.id === activeCard.id ? nextCard : card)),
    );
  }

  function commitManualActiveCardState(nextCard: RuntimeCard) {
    setCards((current) => current.map((card) => (card.id === nextCard.id ? nextCard : card)));
    if (activeChat) {
      const rebasedChat = rebaseChatTurnState(activeChat, nextCard);
      setChatSessions((current) => upsertChatSession(current, rebasedChat));
    }
  }

  function clearStoryCharacters() {
    if (!activeCard) {
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

  function ensureChatForCard(card: RuntimeCard) {
    const existing = chatSessions.find((chat) => chat.cardId === card.id && !chat.archived);
    if (existing) {
      setActiveChatIds((current) => ({ ...current, [card.id]: current[card.id] ?? existing.id }));
      return;
    }

    const chat = initializeChatTurnState(createChatSession(card.id, `${card.name} chat`), card);
    setChatSessions((current) => [...current, chat]);
    setActiveChatIds((current) => ({ ...current, [card.id]: chat.id }));
  }

  function selectChat(chatId: string) {
    if (!activeCard) {
      return;
    }
    const chat = chatSessions.find((candidate) => candidate.id === chatId && candidate.cardId === activeCard.id);
    if (!chat) {
      return;
    }
    const nextCard = deriveCardForChat(activeCard, chat);
    setCards((current) => current.map((card) => (card.id === activeCard.id ? nextCard : card)));
    setActiveChatIds((current) => ({ ...current, [activeCard.id]: chat.id }));
    setRuleWarning(null);
    setPendingDeleteChatId(null);
    setDraft("");
    setMapArtifact(findGeneratedMapForChat(generatedMaps, activeCard.id, chat.id, "map"));
    setPhotoArtifact(findGeneratedMapForChat(generatedMaps, activeCard.id, chat.id, "photo"));
    setMapPrompt(null);
    setImagePromptDraft("");
    setImageNegativePromptDraft("");
    setPhotoSpecDraft("");
    setPhotoPrompt("");
  }

  function startNewChatForActiveCard() {
    if (!activeCard) {
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
    setMapPrompt(null);
    setImagePromptDraft("");
    setImageNegativePromptDraft("");
    setPhotoSpecDraft("");
    setPhotoPrompt("");
    setMapArtifact(null);
    setPhotoArtifact(null);
  }

  function branchActiveChat() {
    if (!activeCard || !activeChat) {
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
    setMapPrompt(null);
    setImagePromptDraft("");
    setImageNegativePromptDraft("");
    setPhotoSpecDraft("");
    setPhotoPrompt("");
    setMapArtifact(null);
    setPhotoArtifact(null);
  }

  function deleteActiveChat() {
    if (!activeCard || !activeChat) {
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
    setMapArtifact(null);
    setPhotoArtifact(null);
    setMapPrompt(null);
    setImagePromptDraft("");
    setImageNegativePromptDraft("");
    setPhotoSpecDraft("");
    setPhotoPrompt("");
    setDraft("");
    setRuleWarning(null);
  }

  function renameActiveChat(title: string) {
    if (!activeChat) return;
    try {
      setChatSessions((current) => upsertChatSession(current, renameChatSession(activeChat, title)));
      setRuleWarning(null);
    } catch (error) {
      setRuleWarning(getErrorMessage(error));
    }
  }

  function archiveActiveChat() {
    if (!activeCard || !activeChat) return;
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

  function restoreArchivedChat(chatId: string) {
    if (!activeCard) return;
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

  function exportActiveChat() {
    if (!activeCard || !activeChat) return;
    const exportedAt = new Date().toISOString();
    downloadJson(
      `local-first-rpg-chat-${formatDownloadTimestamp(exportedAt)}.json`,
      buildChatExportPayload(activeChat, activeCard),
    );
  }

  function deleteCard(cardId: string) {
    if (cards.length <= 1) {
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
      setMapArtifact(findGeneratedMapForChat(generatedMaps, fallback.id, activeChatIds[fallback.id], "map"));
      setPhotoArtifact(findGeneratedMapForChat(generatedMaps, fallback.id, activeChatIds[fallback.id], "photo"));
    }
  }

  function writeForMe() {
    if (!activeCard) {
      return;
    }
    setDraft(buildWriteForMeDraft(activeCard, messages));
  }

  function updateActiveRpgState(patch: Partial<RpgCardState>) {
    if (!activeCard?.rpg) {
      return;
    }
    commitManualActiveCardState({
      ...activeCard,
      rpg: {
        ...activeCard.rpg,
        ...patch,
      },
    });
  }

  function updateActiveLorebook(lorebookId: string, patch: Partial<Omit<Lorebook, "id" | "entries">>) {
    if (!activeCard) {
      return;
    }
    setCards((current) =>
      current.map((card) => {
        if (card.id !== activeCard.id) {
          return card;
        }

        return {
          ...card,
          lorebooks: card.lorebooks.map((lorebook) =>
            lorebook.id === lorebookId ? { ...lorebook, ...patch } : lorebook,
          ),
        };
      }),
    );
  }

  function updateLorebook(cardId: string, lorebookId: string, lorebook: Lorebook) {
    setCards((current) =>
      current.map((card) =>
        card.id === cardId
          ? {
              ...card,
              lorebooks: card.lorebooks.map((candidate) =>
                candidate.id === lorebookId ? lorebook : candidate,
              ),
            }
          : card,
      ),
    );
  }

  function importLorebookToActiveCard(lorebook: Lorebook) {
    if (!activeCard) {
      return;
    }
    setCards((current) =>
      current.map((card) =>
        card.id === activeCard.id
          ? {
              ...card,
              lorebooks: [...card.lorebooks, lorebook],
            }
          : card,
      ),
    );
    setSection("lorebooks");
  }

  function addLorebookEntry(lorebookId: string, entry: NewLorebookEntry): boolean {
    if (!activeCard) {
      setLorebookEntryError("Open a card before adding lorebook entries.");
      return false;
    }
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

    setCards((current) =>
      current.map((card) => {
        if (card.id !== activeCard.id) {
          return card;
        }

        const targetLorebook =
          card.lorebooks.find((lorebook) => lorebook.id === lorebookId) ??
          createEmptyLorebook(card.id, "Card Lorebook");
        const updatedLorebook = {
          ...targetLorebook,
          entries: [...targetLorebook.entries, nextEntry],
        };
        const hasExistingLorebook = card.lorebooks.some((lorebook) => lorebook.id === targetLorebook.id);
        return {
          ...card,
          lorebooks: hasExistingLorebook
            ? card.lorebooks.map((lorebook) =>
                lorebook.id === targetLorebook.id ? updatedLorebook : lorebook,
              )
            : [...card.lorebooks, updatedLorebook],
        };
      }),
    );
    return true;
  }

  function editMessageContent(messageId: string, content: string) {
    if (!activeCard || !activeChat) {
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

  function swipeMessageVariant(messageId: string, direction: -1 | 1) {
    if (!activeCard || !activeChat) {
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

  function undoTurnEffects(messageId: string) {
    if (!activeCard || !activeChat) {
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

  async function regenerateLastReply() {
    if (!activeCard || !activeChat || isGenerating || !runtimeRunning) {
      return;
    }
    const history = filterPersistedOpeningMessages(activeChat.messages);
    let assistantIndex = -1;
    for (let index = history.length - 1; index >= 0; index -= 1) {
      if (history[index].role === "assistant") {
        assistantIndex = index;
        break;
      }
    }
    if (assistantIndex === -1) {
      return;
    }
    let userIndex = assistantIndex - 1;
    while (userIndex >= 0 && history[userIndex].role !== "user") {
      userIndex -= 1;
    }
    const action = userIndex >= 0 ? history[userIndex].content : randomOpeningAction;
    const baseMessages = userIndex >= 0 ? history.slice(0, userIndex) : history.slice(0, assistantIndex);
    const lastAssistant = history[assistantIndex];
    const previousVariants =
      lastAssistant.variants && lastAssistant.variants.length > 0
        ? lastAssistant.variants
        : [lastAssistant.content];
    const previousVariantRunIds = previousVariants.map(
      (_, index) =>
        lastAssistant.variantRunIds?.[index] ??
        (previousVariants.length === 1 ? lastAssistant.promptRunId ?? "" : ""),
    );
    const regenerationCard = deriveCardForRegeneration(activeCard, activeChat, lastAssistant.id);
    await generateMockTurn({
      actionOverride: action,
      baseMessages,
      previousVariants,
      previousVariantRunIds,
      previousUndoneVariantIndices: lastAssistant.undoneVariantIndices,
      cardOverride: regenerationCard,
      replacedAssistantMessageId: lastAssistant.id,
    });
  }

  async function runSlashCommand(name: string, args: string) {
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

  function postDiceRoll(notation: string) {
    if (!activeCard) {
      setRuleWarning("Open a card before rolling dice.");
      return;
    }
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
    setChatSessions((current) =>
      upsertChatSession(current, {
        ...rollChat,
        messages: rollMessages,
        authoritativeEvents,
        rollingSummary: advanceChatSessionRollingSummary(rollChat, rollMessages, occurredAt),
        updatedAt: occurredAt,
      }),
    );
    setDraft("");
    setRuleWarning("");
  }

  async function generateMockTurn(options?: {
    actionOverride?: string;
    baseMessages?: Message[];
    previousVariants?: string[];
    previousVariantRunIds?: string[];
    previousUndoneVariantIndices?: number[];
    cardOverride?: RuntimeCard;
    replacedAssistantMessageId?: string;
  }) {
    if (!activeCard) {
      setRuleWarning("Open a card before starting the runtime.");
      return;
    }
    if (!runtimeRunning) {
      setRuleWarning("Runtime is shut down. Start the runtime before generating another turn.");
      return;
    }
    // Defense in depth: the Send button and Enter handler are already disabled
    // while a turn is in flight, but a re-entrant call would capture a stale
    // `activeChat`/`chatMessages` snapshot and overwrite the in-progress turn's
    // committed messages. Refuse to start a second turn concurrently.
    if (isGenerating) {
      return;
    }

    let turnCard = options?.cardOverride ?? activeCard;
    const parsedCommand = options?.actionOverride === undefined ? parseSlashCommand(draft.trim()) : null;
    if (parsedCommand) {
      await runSlashCommand(parsedCommand.command.name, parsedCommand.args);
      return;
    }

    const visibleUserAction = (options?.actionOverride ?? draft).trim();
    const generationAction = visibleUserAction || randomOpeningAction;
    const runId = createRuntimeEntityId("run");
    const baseChat = activeChat ?? initializeChatTurnState(createChatSession(turnCard.id, `${turnCard.name} chat`), turnCard);
    const chatMessages = options?.baseMessages ?? filterPersistedOpeningMessages(baseChat.messages);
    const uncommittedAttemptMessages = options?.replacedAssistantMessageId ? baseChat.messages : chatMessages;
    const userMessage: Message = {
      id: `user-${runId}`,
      role: "user",
      content: generationAction,
    };
    const occurredAt = new Date().toISOString();
    let authoritativeEvents: AuthoritativeEventStream = appendAuthoritativeEvent(
      baseChat.authoritativeEvents ?? [],
      createPlayerActionEvent({
        id: `event-${runId}-action`,
        chatId: baseChat.id,
        branchId: baseChat.id,
        messageId: userMessage.id,
        occurredAt,
        runId,
        action: generationAction,
        origin: visibleUserAction ? "typed" : "opening",
      }),
    );
    const validation = validatePlayerActionWithRules({
      cardKind: turnCard.kind,
      rules: turnCard.playerRules,
      action: generationAction,
      rpgState: turnCard.rpg,
    });
    authoritativeEvents = appendAuthoritativeEvent(
      authoritativeEvents,
      createRuleDecisionEvent({
        id: `event-${runId}-rules`,
        chatId: baseChat.id,
        branchId: baseChat.id,
        messageId: userMessage.id,
        occurredAt,
        runId,
        action: generationAction,
        engine: "player-rule-engine-v1",
        decision: {
          allowed: validation.allowed,
          warning: validation.warning,
          triggeredRuleIds: validation.triggeredRuleIds,
        },
      }),
    );
    const chat: ChatSession = { ...baseChat, authoritativeEvents };
    setRuleWarning(validation.warning);
    if (!activeChat) {
      setActiveChatIds((current) => ({ ...current, [activeCard.id]: chat.id }));
    }
    if (!validation.allowed) {
      setChatSessions((current) => upsertChatSession(current, {
        ...chat,
        messages: uncommittedAttemptMessages,
        updatedAt: occurredAt,
      }));
      setDraft("");
      return;
    }

    const abortController = new AbortController();
    turnAbortControllerRef.current = abortController;
    setIsGenerating(true);
    setStreamingReply("");
    if (!activeChat) {
      setChatSessions((current) => [...current, chat]);
    }
    const attemptedModelCalls: ModelCallRecord[] = [];
    try {
      const loreSelection = await selectActiveLorebookEntriesSafely({
        lorebooks: collectActiveLorebooks(turnCard, activePersona),
        messages: chatMessages,
        draft: generationAction,
        context: turnCard.rpg
          ? {
              currentLocation: turnCard.rpg.location,
              activeQuests: turnCard.rpg.quests,
              inventory: turnCard.rpg.inventory,
              worldFlags: turnCard.rpg.flags,
            }
          : undefined,
        sources: {
          cardDefinition: formatDetailedCharacterDefinition(turnCard),
          personaDescription: activePersona?.description,
          memoryEntries: turnCard.memory.map((entry) => `${entry.label}: ${entry.detail}`),
        },
      });
      const turnLorebookEntries = loreSelection.entries;
      const disabledLoreEntryIds = new Set(loreSelection.disabledEntryIds);
      if (disabledLoreEntryIds.size > 0) {
        turnCard = disableLoreEntriesInCard(turnCard, disabledLoreEntryIds);
        setCards((current) =>
          current.map((card) =>
            card.id === turnCard.id ? disableLoreEntriesInCard(card, disabledLoreEntryIds) : card,
          ),
        );
        setPersonas((current) =>
          current.map((persona) => disableLoreEntriesInPersona(persona, disabledLoreEntryIds)),
        );
        setRuleWarning(
          `Disabled ${disabledLoreEntryIds.size} lore regex ${disabledLoreEntryIds.size === 1 ? "entry" : "entries"} after isolated matching failed or timed out.`,
        );
      }
      const selectedModel = providerSettings.mode === "mock" ? "mock-narrator" : providerSettings.model;
      const callPlan = resolveHiddenContinuityPlan({
        mode: runtimeSettings.hiddenContinuityMode ?? "full",
        selectedModel,
        economicalModel: runtimeSettings.economicalModel,
      });
      const provider = createTextProvider(
        providerSettings,
        sessionApiKey,
        turnCard,
        generationAction,
        turnLorebookEntries.length,
        callPlan.hiddenModel !== undefined,
      );
      const configuredModelInfo = getConfiguredTextModelInfo(providerSettings);
      const hiddenBudget = callPlan.hiddenModel
        ? resolveModelCallBudget({
            providerId: providerSettings.providerId,
            model: callPlan.hiddenModel,
            phase: "hidden-continuity",
            modelInfo: getConfiguredTextModelInfoForModel(providerSettings, callPlan.hiddenModel),
          })
        : undefined;
      const visibleBudget = resolveModelCallBudget({
        providerId: providerSettings.providerId,
        model: callPlan.visibleModel,
        phase: "visible-response",
        modelInfo: configuredModelInfo,
      });
      let hiddenCallOutcome: TextModelCallOutcome | undefined;
      const hiddenCallStartedAt = readMonotonicMilliseconds();
      let hiddenContinuityResult = createEmptyHiddenContinuityResult();
      if (callPlan.hiddenModel && hiddenBudget) {
        try {
          hiddenContinuityResult = await runHiddenContinuityPassSafely({
            modelAdapter: createModelCallCaptureAdapter(provider, (outcome) => {
              hiddenCallOutcome = outcome;
            }),
            model: callPlan.hiddenModel,
            card: toHiddenContinuityCard(turnCard),
            messages: chatMessages,
            latestUserMessage: generationAction,
            activeLoreCount: turnLorebookEntries.length,
            pendingReviewProposals: pendingReviewRef.current[turnCard.id] ?? [],
            rollingSummary: chat.rollingSummary?.text,
            inputBudgetTokens: hiddenBudget.inputBudgetTokens,
            maxOutputTokens: hiddenBudget.maxOutputTokens,
            signal: abortController.signal,
          });
        } catch (error) {
          attemptedModelCalls.push(toModelCallRecord({
            phase: "hidden-continuity",
            fallbackProvider: provider.id,
            fallbackModel: callPlan.hiddenModel,
            budget: hiddenBudget,
            durationMs: elapsedMilliseconds(hiddenCallStartedAt),
            outcome: hiddenCallOutcome ?? { error },
            pricing: resolveModelPricing({
              providerId: providerSettings.providerId,
              model: callPlan.hiddenModel,
              pricingSnapshots: getProviderPricingSnapshots(providerSettings),
            }),
            stateProposalCount: 0,
          }));
          throw error;
        }
      }
      const hiddenPolicyResult = filterHiddenContinuityForPolicy(turnCard, hiddenContinuityResult, {
        latestUserAction: generationAction,
      });
      if (callPlan.hiddenModel && hiddenBudget) {
        attemptedModelCalls.push(toModelCallRecord({
          phase: "hidden-continuity",
          fallbackProvider: provider.id,
          fallbackModel: callPlan.hiddenModel,
          budget: hiddenBudget,
          durationMs: elapsedMilliseconds(hiddenCallStartedAt),
          outcome: hiddenCallOutcome,
          pricing: resolveModelPricing({
            providerId: providerSettings.providerId,
            model: callPlan.hiddenModel,
            pricingSnapshots: getProviderPricingSnapshots(providerSettings),
          }),
          stateProposalCount: hiddenPolicyResult.proposals.length,
        }));
      }
      const hiddenContinuity = hiddenPolicyResult.result;
      const continuityCard = applyHiddenContinuityToCard(turnCard, hiddenContinuity);
      const hiddenLatestUserMessage: Message = {
        ...userMessage,
        content: buildVisibleUserMessageWithHiddenContinuity(
          generationAction,
          hiddenContinuity,
          toHiddenContinuityCard(continuityCard),
        ),
      };
      const visibleCallStartedAt = readMonotonicMilliseconds();
      let visibleCallOutcome: TextModelCallOutcome | undefined;
      let pipelineResult: Awaited<ReturnType<typeof runTurnPipeline>>;
      try {
        pipelineResult = await runTurnPipeline({
          ...buildTurnPromptRequest(
            continuityCard,
            turnLorebookEntries,
            chatMessages,
            generationAction,
            runtimeSettings,
            activePersona,
            {
              ...toVisibleTurnBudget(visibleBudget),
              retrievalContext: {
                chatId: chat.id,
                branchId: chat.id,
                rollingSummary: chat.rollingSummary,
              },
              latestUserMessage: hiddenLatestUserMessage,
              promptRunId: runId,
              metadata: {
                cardKind: turnCard.kind,
                includedLoreEntryIds: turnLorebookEntries.map((entry) => entry.id),
                providerMode: providerSettings.mode,
                textStreaming: runtimeSettings.textStreaming,
                chatId: chat.id,
                hiddenContinuityPass: callPlan.hiddenModel !== undefined,
                expectedCallCount: callPlan.expectedCallCount,
              },
            },
          ),
          modelAdapter: createModelCallCaptureAdapter(provider, (outcome) => {
            visibleCallOutcome = outcome;
          }),
          model: callPlan.visibleModel,
          temperature: 0.6,
          signal: abortController.signal,
          onStreamText: (text) => setStreamingReply(text),
        });
      } catch (error) {
        attemptedModelCalls.push(toModelCallRecord({
          phase: "visible-response",
          fallbackProvider: provider.id,
          fallbackModel: callPlan.visibleModel,
          budget: visibleBudget,
          durationMs: elapsedMilliseconds(visibleCallStartedAt),
          outcome: visibleCallOutcome ?? { error },
          pricing: resolveModelPricing({
            providerId: providerSettings.providerId,
            model: callPlan.visibleModel,
            pricingSnapshots: getProviderPricingSnapshots(providerSettings),
          }),
          stateProposalCount: 0,
        }));
        throw error;
      }
      if (!visibleCallOutcome) {
        visibleCallOutcome = {
          response: {
            providerId: pipelineResult.promptRun.providerId,
            model: pipelineResult.promptRun.model,
            text: pipelineResult.assistantMessageText,
            finishReason: pipelineResult.promptRun.finishReason,
            usage: { ...pipelineResult.promptRun.usage },
            usageSource: pipelineResult.promptRun.usageSource ?? "estimated",
          },
        };
      }
      const statusBlockLocation = deriveStatusBlockLocationProposal(
        pipelineResult.assistantMessageText,
        pipelineResult.stateProposals.extraction.rpg_state_updates.location,
        continuityCard,
      );
      const proposedExtraction = statusBlockLocation
        ? {
            ...pipelineResult.stateProposals.extraction,
            rpg_state_updates: {
              ...pipelineResult.stateProposals.extraction.rpg_state_updates,
              location: statusBlockLocation,
            },
          }
        : pipelineResult.stateProposals.extraction;
      const policyResult = filterValidatedTurnEffectsForPolicy(continuityCard, proposedExtraction, {
        latestUserAction: userMessage.content,
        assistantMessageText: pipelineResult.assistantMessageText,
      });
      attemptedModelCalls.push(toModelCallRecord({
        phase: "visible-response",
        fallbackProvider: provider.id,
        fallbackModel: callPlan.visibleModel,
        budget: visibleBudget,
        durationMs: elapsedMilliseconds(visibleCallStartedAt),
        outcome: visibleCallOutcome,
        pricing: resolveModelPricing({
          providerId: providerSettings.providerId,
          model: callPlan.visibleModel,
          pricingSnapshots: getProviderPricingSnapshots(providerSettings),
        }),
        stateProposalCount: policyResult.proposals.length,
      }));
      pendingReviewRef.current[turnCard.id] = policyResult.warnings
        .filter((warning) => /^Blocked/i.test(warning))
        .slice(-8);
      const warnings = [
        ...hiddenContinuity.warnings.map((warning) => `Hidden continuity: ${warning}`),
        ...hiddenPolicyResult.warnings,
        ...pipelineResult.warnings.map((warning) => warning.message),
        ...policyResult.warnings,
      ];
      const stateProposals = [...hiddenPolicyResult.proposals, ...policyResult.proposals];
      const stateChanges = stateProposals
        .filter((proposal) => proposal.applied)
        .map((proposal) => `[${proposal.provenance}] ${proposal.summary}`);
      const assistantContent = stripTrailingCallToAction(pipelineResult.assistantMessageText);
      const assistantVariants = options?.previousVariants
        ? [...options.previousVariants, assistantContent]
        : undefined;
      const assistantMessage: Message = {
        id: `assistant-${runId}`,
        role: "assistant",
        content: assistantContent,
        promptRunId: runId,
        ...(assistantVariants && assistantVariants.length > 1
          ? {
              variants: assistantVariants,
              activeVariantIndex: assistantVariants.length - 1,
              variantRunIds: [...(options?.previousVariantRunIds ?? []), runId],
              ...(options?.previousUndoneVariantIndices?.length
                ? { undoneVariantIndices: [...options.previousUndoneVariantIndices] }
                : {}),
            }
          : {}),
      };
      const variantIndex = assistantVariants ? assistantVariants.length - 1 : 0;
      const turnEffects = createRuntimeTurnEffects({
        hiddenContinuity,
        extraction: policyResult.extraction,
        committedAt: new Date().toISOString(),
        idSeed: `${assistantMessage.id}-v${variantIndex}`,
        memoryRetrievalScope: { level: "branch", chatId: chat.id, branchId: chat.id },
      });
      const nextMessages = visibleUserAction
        ? [...chatMessages, userMessage, assistantMessage]
        : [...chatMessages, assistantMessage];
      const nextChatDraft: ChatSession = {
        ...chat,
        messages: nextMessages,
        title: chat.title || deriveChatTitle(generationAction),
        updatedAt: new Date().toISOString(),
      };
      let nextChat = options?.replacedAssistantMessageId
        ? recordRegeneratedChatVariant({
            chat: nextChatDraft,
            card: activeCard,
            retainedMessages: chatMessages,
            replacedAssistantMessageId: options.replacedAssistantMessageId,
            replacementAssistantMessageId: assistantMessage.id,
            variantIndex,
            effects: turnEffects,
          })
        : recordChatTurnVariant(nextChatDraft, activeCard, assistantMessage.id, variantIndex, turnEffects);
      const nextActiveCard = disableLoreEntriesInCard(
        deriveCardForChat(activeCard, nextChat),
        disabledLoreEntryIds,
      );
      nextChat = {
        ...nextChat,
        authoritativeEvents: appendAuthoritativeEvent(
          nextChat.authoritativeEvents ?? [],
          createStateCommittedEvent({
            id: `event-${runId}-state-v${variantIndex}`,
            chatId: nextChat.id,
            branchId: nextChat.id,
            messageId: assistantMessage.id,
            occurredAt: new Date().toISOString(),
            runId,
            variant: { assistantMessageId: assistantMessage.id, variantIndex },
            proposalIds: stateProposals
              .map((proposal, index) => ({ proposal, id: `${runId}-proposal-${index}` }))
              .filter(({ proposal }) => proposal.applied)
              .map(({ id }) => id),
            mutations: buildAuthoritativeStateMutations(turnCard, nextActiveCard),
          }),
        ),
        rollingSummary: advanceChatSessionRollingSummary(nextChat, nextMessages, new Date().toISOString()),
      };
      const leakWarnings = describeKnowledgeLeaks(
        detectKnowledgeLeaks(assistantMessage.content, nextActiveCard.storyEntities),
      );
      const hasKnowledgeBoundaries = continuityCard.storyEntities?.some(
        (entity) => entity.doesNotKnow.length > 0,
      );
      const boundariesDropped =
        Boolean(hasKnowledgeBoundaries) &&
        !pipelineResult.promptRun.includedLayerIds.includes(TURN_PIPELINE_LAYER_IDS.knowledgeBoundaries);
      const boundaryWarnings = boundariesDropped
        ? ["Knowledge boundaries were dropped from this prompt by the token budget; character isolation may be weaker this turn."]
        : [];
      const turnWarnings = [...warnings, ...leakWarnings, ...boundaryWarnings];

      setChatSessions((current) => upsertChatSession(current, nextChat));
      setCards((current) => current.map((card) => (card.id === activeCard.id ? nextActiveCard : card)));
      void generateMissingCharacterPortraits(nextActiveCard, chat.id, nextMessages);
      setPromptRuns((current) => [
        ...current,
        {
          id: runId,
          cardId: turnCard.id,
          chatId: chat.id,
          compiledPrompt: runtimeSettings.promptDebugLogs ? pipelineResult.promptRun.compiledPrompt : "",
          response: assistantMessage.content,
          provider: pipelineResult.promptRun.providerId,
          model: pipelineResult.promptRun.model,
          tokenEstimate: pipelineResult.promptRun.tokenEstimate,
          includedLayerIds: [...pipelineResult.promptRun.includedLayerIds],
          includedLoreEntryIds: [...pipelineResult.promptRun.includedLoreEntryIds],
          warnings: turnWarnings,
          stateChanges,
          stateProposals,
          usage: pipelineResult.promptRun.usage,
          modelCalls: attemptedModelCalls,
        },
      ]);
      setDraft("");
    } catch (error) {
      setChatSessions((current) => upsertChatSession(current, {
        ...chat,
        messages: uncommittedAttemptMessages,
        updatedAt: new Date().toISOString(),
      }));
      if (attemptedModelCalls.length > 0) {
        const lastCall = attemptedModelCalls[attemptedModelCalls.length - 1];
        const failureMessage = lastCall.failure?.message ?? "Model call failed.";
        setPromptRuns((current) => current.some((run) => run.id === runId)
          ? current
          : [
              ...current,
              {
                id: runId,
                cardId: turnCard.id,
                chatId: chat.id,
                compiledPrompt: "",
                response: "",
                provider: lastCall.provider,
                model: lastCall.model,
                tokenEstimate: 0,
                includedLayerIds: [],
                includedLoreEntryIds: [],
                warnings: [failureMessage],
                stateChanges: [],
                stateProposals: [],
                modelCalls: attemptedModelCalls,
                blockedReason: failureMessage,
              },
            ]);
      }
      setRuleWarning(
        isAbortError(error)
          ? "Generation stopped. No turn messages or state changes were saved."
          : getErrorMessage(error),
      );
    } finally {
      if (turnAbortControllerRef.current === abortController) {
        turnAbortControllerRef.current = null;
      }
      setIsGenerating(false);
      setStreamingReply("");
    }
  }

  function stopGeneration() {
    turnAbortControllerRef.current?.abort();
  }

  async function consolidateActiveCardMemory() {
    if (!activeCard || isConsolidatingMemory) {
      return;
    }
    const entries = activeCard.memory.map((entry) => ({
      id: entry.id,
      label: entry.label,
      detail: entry.detail,
    }));
    setMemoryConsolidationReview(null);
    setIsConsolidatingMemory(true);
    setMemoryConsolidationStatus("Consolidating memory...");
    try {
      const provider = createTextProvider(providerSettings, sessionApiKey, activeCard, "", 0);
      const model = providerSettings.mode === "mock" ? "mock-narrator" : providerSettings.model;
      const result = await runMemoryConsolidationSafely({ modelAdapter: provider, model, entries });
      if (result.changed) {
        const before = entries.length;
        const proposedMemory = result.entries.map((entry) => ({
            id: entry.id ?? createRuntimeEntityId("memory"),
            label: entry.label,
            detail: entry.detail,
          }));
        setMemoryConsolidationReview({
          cardId: activeCard.id,
          originalMemory: activeCard.memory.map((entry) => ({ ...entry })),
          proposedMemory,
        });
        setMemoryConsolidationStatus(
          `Review the proposed consolidation: ${before} to ${result.entries.length} entries. Nothing has changed yet.`,
        );
      } else {
        setMemoryConsolidationStatus(
          result.warnings[0] ?? "Memory is already concise; nothing to consolidate.",
        );
      }
    } catch (error) {
      setMemoryConsolidationStatus(`Memory consolidation failed: ${getErrorMessage(error)}`);
    } finally {
      setIsConsolidatingMemory(false);
    }
  }

  function applyMemoryConsolidationReview() {
    if (!activeCard || !memoryConsolidationReview || memoryConsolidationReview.cardId !== activeCard.id) {
      setMemoryConsolidationReview(null);
      setMemoryConsolidationStatus("The consolidation review no longer matches the active card; memory was not changed.");
      return;
    }
    if (JSON.stringify(activeCard.memory) !== JSON.stringify(memoryConsolidationReview.originalMemory)) {
      setMemoryConsolidationReview(null);
      setMemoryConsolidationStatus("Memory changed while this review was open; the stale proposal was discarded.");
      return;
    }

    const before = activeCard.memory.length;
    const proposedMemory = memoryConsolidationReview.proposedMemory.map((entry) => ({ ...entry }));
    captureRestorePoint();
    commitManualActiveCardState({ ...activeCard, memory: proposedMemory });
    setMemoryConsolidationReview(null);
    setMemoryConsolidationStatus(`Memory consolidation applied: ${before} to ${proposedMemory.length} entries.`);
  }

  function cancelMemoryConsolidationReview() {
    setMemoryConsolidationReview(null);
    setMemoryConsolidationStatus("Memory consolidation cancelled; original memory was not changed.");
  }

  function shutdownRuntime() {
    turnAbortControllerRef.current?.abort();
    setRuntimeRunning(false);
    setRuleWarning(null);
    setMapPrompt(null);
    setImagePromptDraft("");
    setImageNegativePromptDraft("");
    setDraft("");
  }

  function startRuntime() {
    setRuntimeRunning(true);
    setRuleWarning(null);
    setDraft("");
  }

  function completeOnboarding() {
    setRuntimeSettings((current) => ({ ...current, onboardingCompleted: true }));
    setOnboardingDismissed(true);
  }

  function addPersona(name: string) {
    const persona = createPersona(name);
    setPersonas((current) => [...current, persona]);
    setActivePersonaId(persona.id);
  }

  function editPersona(personaId: string, changes: Partial<Persona>) {
    setPersonas((current) => updatePersona(current, personaId, changes));
  }

  function removePersona(personaId: string) {
    captureRestorePoint();
    const remaining = deletePersona(personas, personaId);
    setPersonas(remaining);
    setActivePersonaId(parseActivePersonaId(activePersonaId, remaining));
  }

  function makePersonaDefault(personaId: string) {
    setPersonas((current) => setDefaultPersona(current, personaId));
  }

  const restorePointViews = restorePoints.map((point) => ({
    id: point.id,
    label: point.label,
    timeLabel: formatRestorePointTime(point.createdAt),
  }));

  const showOnboarding =
    repositoryHydrated &&
    !onboardingDismissed &&
    shouldShowOnboarding({
      onboardingCompleted: runtimeSettings.onboardingCompleted,
      snapshot: { cards, messages, promptRuns, chatSessions },
    });

  return (
    <main
      className={`app-shell ${theme}`}
      data-theme={theme}
      style={
        /^#[0-9a-fA-F]{6}$/.test(runtimeSettings.accentColor)
          ? ({
              "--accent": runtimeSettings.accentColor,
              "--accent-strong": `color-mix(in srgb, ${runtimeSettings.accentColor} 78%, #000)`,
              "--accent-soft": `color-mix(in srgb, ${runtimeSettings.accentColor} 16%, transparent)`,
            } as CSSProperties)
          : undefined
      }
    >
      <HydrationGate
        state={hydration}
        onRetry={retryHydration}
        onStartFresh={() => void archiveDatabaseAndStartFresh()}
      />
      <AppSidebar
        theme={theme}
        section={section}
        selectSection={setSection}
        toggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
        activeCard={activeCard}
        saveStatus={saveStatus}
        repositoryStatus={repositoryStatus}
      />

      <section className="workspace" aria-label="Story workspace">
        <AppTopbar
          section={section}
          activeCard={activeCard}
          runtimeRunning={runtimeRunning}
          editCard={() => {
            if (!activeCard) {
              return;
            }
            editCard(activeCard);
            setSection("cards");
          }}
          openMemory={() => setMemoryOpen(true)}
          shutdownRuntime={shutdownRuntime}
          startRuntime={startRuntime}
        />

        {section === "runtime" ? (
          activeCard ? (
            <RuntimeSection
              activeCard={activeCard}
              activeChat={activeChat}
              cardChats={getCardChats(activeCard.id, chatSessions)}
              archivedChats={getCardChats(activeCard.id, chatSessions, { includeArchived: true }).filter((chat) => chat.archived)}
              selectChat={selectChat}
              startNewChat={startNewChatForActiveCard}
              branchChat={branchActiveChat}
              deleteChat={deleteActiveChat}
              cancelDeleteChat={() => {
                setPendingDeleteChatId(null);
                setRuleWarning(null);
              }}
              renameChat={renameActiveChat}
              archiveChat={archiveActiveChat}
              restoreChat={restoreArchivedChat}
              exportChat={exportActiveChat}
              isDeleteChatPending={pendingDeleteChatId === activeChat?.id}
              personas={personas}
              activePersonaId={activePersonaId}
              selectPersona={setActivePersonaId}
              messages={visibleMessages}
              editMessage={editMessageContent}
              regenerateLastReply={regenerateLastReply}
              swipeMessageVariant={swipeMessageVariant}
              undoTurnEffects={undoTurnEffects}
              draft={draft}
              setDraft={setDraft}
              sendMessage={generateMockTurn}
              writeForMe={writeForMe}
              runtimeRunning={runtimeRunning}
              startRuntime={startRuntime}
              isGenerating={isGenerating}
              stopGeneration={stopGeneration}
              streamingReply={streamingReply}
              promptRuns={promptRuns.filter((run) => run.cardId === activeCard.id && (!activeChat || run.chatId === activeChat.id))}
              ruleWarning={ruleWarning}
              mapPrompt={mapPrompt}
              mapArtifact={mapArtifact}
              imagePromptDraft={imagePromptDraft}
              setImagePromptDraft={setImagePromptDraft}
              imageNegativePromptDraft={imageNegativePromptDraft}
              setImageNegativePromptDraft={setImageNegativePromptDraft}
              photoSpecDraft={photoSpecDraft}
              setPhotoSpecDraft={setPhotoSpecDraft}
              photoPrompt={photoPrompt}
              photoArtifact={photoArtifact}
              characterPortraits={findCharacterPortraitsForCard(generatedMaps, activeCard.id)}
              isDraftingMapPrompt={isDraftingMapPrompt}
              isGeneratingMapImage={isGeneratingMapImage}
              isGeneratingPhoto={isGeneratingPhoto}
              prepareImagePrompt={prepareImagePrompt}
              generateMapImage={generateImageFromPrompt}
              resetMapPrompt={resetMapPrompt}
              deleteCurrentMap={deleteCurrentMap}
              generateCustomImageFromRequest={generateCustomImageFromRequest}
              resetCustomImageRequest={resetCustomImageRequest}
              deleteCurrentPhoto={deleteCurrentPhoto}
              clearStoryCharacters={clearStoryCharacters}
              regeneratePortrait={(entity, prompt) => void regenerateCharacterPortrait(entity, prompt)}
              buildPortraitPrompt={(entity) => (activeCard ? buildCharacterPortraitPrompt(activeCard, entity) : "")}
              openMediaPreview={setMediaPreview}
            />
          ) : (
            <NoActiveCardRuntimePanel openCards={() => setSection("cards")} />
          )
        ) : null}

        {section === "cards" ? (
          <CardsSection
            cards={cards}
            activeCard={activeCard}
            activeCardId={activeCardId}
            selectCard={selectCard}
            editCard={editCard}
            deleteCard={deleteCard}
            cancelDeleteCard={() => setPendingDeleteCardId(null)}
            updateCardLibraryState={updateCardLibraryState}
            pendingDeleteCardId={pendingDeleteCardId}
            newCard={newCard}
            setNewCard={setNewCard}
            newCardError={newCardError}
            createCard={createCard}
            onImportCard={importCard}
            cardTab={cardTab}
            setCardTab={setCardTab}
            compiledPrompt={compiledPrompt}
            compiledPromptResult={compiledPromptResult}
            activeLorebookEntries={activeLorebookEntries}
            activeLoreTriggers={activeLoreTriggers}
            updateActiveCard={updateActiveCard}
            updateRpgState={updateActiveRpgState}
            updateActiveLorebook={updateActiveLorebook}
            addLorebookEntry={addLorebookEntry}
            lorebookEntryError={lorebookEntryError}
            readinessItems={getReadinessChecklist({ cards, activeCardId, providerSettings })}
            startMockDemo={startMockDemo}
          />
        ) : null}

        {section === "lorebooks" ? (
          <GlobalLorebooksSection
            cards={cards}
            activeCardId={activeCardId}
            selectCard={selectCard}
            updateLorebook={updateLorebook}
            importLorebookToActiveCard={importLorebookToActiveCard}
          />
        ) : null}

        {section === "providers" ? (
          <ProvidersSection
            providerKeyStatus={providerKeyStatus}
            providerTestStatus={providerTestStatus}
            providerSettings={providerSettings}
            economicalModel={runtimeSettings.economicalModel}
            setProviderSettings={setProviderSettings}
            imageProviderSettings={imageProviderSettings}
            setImageProviderSettings={setImageProviderSettings}
            comfyUiCheckpointModels={comfyUiCheckpointModels}
            imageProviderStatus={imageProviderStatus}
            imageSessionApiKey={imageSessionApiKey}
            setImageSessionApiKey={setImageSessionApiKey}
            secureStorageStatus={secureStorageStatus}
            sessionApiKey={sessionApiKey}
            setSessionApiKey={setSessionApiKey}
            saveProviderKey={saveProviderKey}
            forgetProviderKey={forgetProviderKey}
            testTextProvider={testTextProvider}
            refreshComfyUICheckpoints={refreshComfyUICheckpoints}
          />
        ) : null}

        {section === "settings" ? (
          <SettingsSection
            runtimeSettings={runtimeSettings}
            setRuntimeSettings={setRuntimeSettings}
            personas={personas}
            activePersonaId={activePersonaId}
            selectPersona={setActivePersonaId}
            addPersona={addPersona}
            editPersona={editPersona}
            removePersona={removePersona}
            makePersonaDefault={makePersonaDefault}
            promptPreview={compiledPrompt}
            dataManagementStatus={dataManagementStatus}
            exportRuntimeData={exportRuntimeData}
            importRuntimeData={importRuntimeData}
            pendingImportReview={pendingImportReview}
            applyRuntimeImport={applyRuntimeImport}
            cancelRuntimeImport={cancelRuntimeImport}
            downloadDiagnostics={downloadDiagnostics}
            restorePoints={restorePointViews}
            restoreStatus={restoreStatus}
            restoreRuntimePoint={restoreRuntimeFromPoint}
          />
        ) : null}
      </section>

      {mediaPreview ? <MediaPreviewDialog preview={mediaPreview} close={() => setMediaPreview(null)} /> : null}
      {memoryOpen && activeCard ? (
        <MemoryDrawer
          card={activeCard}
          close={() => setMemoryOpen(false)}
          consolidate={() => void consolidateActiveCardMemory()}
          isConsolidating={isConsolidatingMemory}
          status={memoryConsolidationStatus}
          review={memoryConsolidationReview?.cardId === activeCard.id ? memoryConsolidationReview : null}
          applyConsolidation={applyMemoryConsolidationReview}
          cancelConsolidation={cancelMemoryConsolidationReview}
        />
      ) : null}
      {showOnboarding ? (
        <OnboardingOverlay
          onAddApiKey={() => setSection("providers")}
          onOpenCards={() => setSection("cards")}
          onStartMockDemo={startMockDemo}
          onDismiss={completeOnboarding}
        />
      ) : null}
    </main>
  );
}
