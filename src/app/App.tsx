import {
  type CSSProperties,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { resolveModelCallBudget } from "../runtime/modelCallBudget";
import {
  selectLorebookEntriesWithProvenanceForPreview,
  type LoreTriggerProvenance,
} from "../runtime/loreTriggerEngine";
import {
  buildTurnSystemPrompt,
  compileTurnPrompt,
} from "../runtime/turnPipeline";
import { runMemoryConsolidationSafely } from "../runtime/memoryConsolidation";
import { requireSecureKeyStorage } from "../security/keyStorage";
import { loadLocalRuntimeSnapshot } from "./localRuntimeStore";
import { SettingsSection } from "./SettingsSection";
import { OnboardingOverlay } from "./OnboardingOverlay";
import { shouldShowOnboarding } from "./startupPersistencePolicy";
import { HydrationGate } from "./HydrationGate";
import type {
  AppRuntimeSnapshot,
  CardTab,
  ChatSession,
  ImageProviderSettings,
  MainSection,
  MemoryEntry,
  Message,
  Persona,
  PromptRun,
  ProviderSettings,
  RuntimeCard,
  RuntimeSettings,
  Theme,
} from "./runtimeTypes";
import { findScrollableAncestor, formatRestorePointTime, getErrorMessage } from "./appUtils";
import {
  createRuntimeEntityId,
  filterPersistedOpeningMessages,
  getActiveChatForCard,
  getCardChats,
} from "./chatSessions";
import {
  applyPromptDebugRetention,
  createTextProvider,
  getConfiguredTextModelInfo,
} from "./providerConfig";
import {
  buildCharacterPortraitPrompt,
  findCharacterPortraitsForCard,
} from "./generatedImages";
import {
  buildResponseContract,
  buildTurnPromptRequest,
  formatDetailedCharacterDefinition,
  isTauriRuntime,
  toVisibleTurnBudget,
} from "./turnPromptBuilders";
import {
  defaultNewCard,
  emptyCompiledPrompt,
  initialCards,
  starterMessages,
} from "./appDefaults";
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
import {
  resolveRuntimeSnapshotState,
  type ResolvedRuntimeSnapshotState,
} from "./runtimeSnapshotHydration";
import { AppSidebar, AppTopbar } from "./AppChrome";
import { useProviderManagement } from "./useProviderManagement";
import { useRuntimePersistence } from "./useRuntimePersistence";
import { useRuntimeDataManagement } from "./useRuntimeDataManagement";
import { useMediaGeneration } from "./useMediaGeneration";
import { useTurnGeneration } from "./useTurnGeneration";
import { useRuntimeContentManagement } from "./useRuntimeContentManagement";

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
  const [isConsolidatingMemory, setIsConsolidatingMemory] = useState(false);
  const [memoryConsolidationStatus, setMemoryConsolidationStatus] = useState<string | null>(null);
  const [memoryConsolidationReview, setMemoryConsolidationReview] = useState<MemoryConsolidationReview | null>(null);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);

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
  const {
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
    runSlashCommand,
  } = useRuntimeContentManagement({
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
  });
  const {
    isGenerating,
    streamingReply,
    generateTurn: generateMockTurn,
    regenerateLastReply,
    stopGeneration,
  } = useTurnGeneration({
    activeCard,
    activeChat,
    activePersona,
    runtimeRunning,
    draft,
    providerSettings,
    sessionApiKey,
    runtimeSettings,
    setActiveChatIds,
    setChatSessions,
    setCards,
    setPersonas,
    setPromptRuns,
    setDraft,
    setRuleWarning,
    runSlashCommand,
    generateMissingCharacterPortraits,
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
    stopGeneration();
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
