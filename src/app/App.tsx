import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { resolveModelCallBudget } from "../runtime/modelCallBudget";
import { buildThemeVars } from "./themeColors";
import {
  selectLorebookEntriesWithProvenanceForPreview,
  type LoreTriggerProvenance,
} from "../runtime/loreTriggerEngine";
import {
  buildTurnSystemPrompt,
  compileTurnPrompt,
} from "../runtime/turnPipeline";
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
  Message,
  Persona,
  PromptRun,
  ProviderSettings,
  RuntimeCard,
  RuntimeSettings,
  Theme,
} from "./runtimeTypes";
import { findScrollableAncestor, formatRestorePointTime } from "./appUtils";
import {
  filterPersistedOpeningMessages,
  getActiveChatForCard,
  getCardChats,
} from "./chatSessions";
import {
  applyPromptDebugRetention,
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
  getActivePersona,
} from "./personas";
import { NoActiveCardRuntimePanel, RuntimeSection } from "./RuntimeSection";
import { CardsSection } from "./CardsSection";
import { GlobalLorebooksSection } from "./GlobalLorebooksSection";
import { PersonasPanel } from "./PersonasPanel";
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
import { useRuntimeSessionManagement } from "./useRuntimeSessionManagement";

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
  const turnGenerationInFlightRef = useRef(false);
  const [promptRuns, setPromptRuns] = useState<PromptRun[]>(() => initialRuntimeState.promptRuns);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [ruleWarning, setRuleWarning] = useState<string | null>(null);
  const [newCard, setNewCard] = useState(defaultNewCard);
  const [providerSettings, setProviderSettings] = useState<ProviderSettings>(() => initialRuntimeState.providerSettings);
  const [imageProviderSettings, setImageProviderSettings] = useState<ImageProviderSettings>(() => initialRuntimeState.imageProviderSettings);
  const [runtimeSettings, setRuntimeSettings] = useState<RuntimeSettings>(() => initialRuntimeState.runtimeSettings);
  const [personas, setPersonas] = useState<Persona[]>(() => initialRuntimeState.personas);
  const [activePersonaId, setActivePersonaId] = useState(() => initialRuntimeState.activePersonaId);
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
          cardDefinition: formatDetailedCharacterDefinition(activeCard, {
            includeExampleDialogs: (runtimeSettings.dialogueExampleMode ?? "all") === "all",
          }),
          personaDescription: activePersona?.description,
          memoryEntries: activeCard.memory.map((entry) => `${entry.label}: ${entry.detail}`),
        },
      });
    },
    [activeCard, activePersona, messages, draft, runtimeSettings.dialogueExampleMode],
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
    generationInFlightRef: turnGenerationInFlightRef,
  });
  const {
    isGenerating,
    streamingReply,
    reasoningTraces,
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
    generationInFlightRef: turnGenerationInFlightRef,
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
    generationInFlightRef: turnGenerationInFlightRef,
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
    generationInFlightRef: turnGenerationInFlightRef,
  });
  const {
    isConsolidatingMemory,
    memoryConsolidationStatus,
    memoryConsolidationReview,
    consolidateActiveCardMemory,
    applyMemoryConsolidationReview,
    cancelMemoryConsolidationReview,
    shutdownRuntime,
    startRuntime,
    completeOnboarding,
    selectPersona,
    addPersona,
    editPersona,
    removePersona,
  } = useRuntimeSessionManagement({
    activeCard,
    providerSettings,
    sessionApiKey,
    personas,
    activePersonaId,
    setPersonas,
    setActivePersonaId,
    setRuntimeSettings,
    setOnboardingDismissed,
    setRuntimeRunning,
    setRuleWarning,
    setDraft,
    setMapPrompt,
    setImagePromptDraft,
    setImageNegativePromptDraft,
    stopGeneration,
    captureRestorePoint,
    commitManualActiveCardState,
    generationInFlightRef: turnGenerationInFlightRef,
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

  const themeStyle = buildThemeVars(runtimeSettings.accentColor, runtimeSettings.themeColors);

  return (
    <main
      className={`app-shell ${theme}`}
      data-theme={theme}
      style={themeStyle}
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
        saveStatus={saveStatus}
        repositoryStatus={repositoryStatus}
      />

      <section className="workspace" aria-label="Story workspace">
        <AppTopbar
          section={section}
          activeCard={activeCard}
          runtimeRunning={runtimeRunning}
          isGenerating={isGenerating}
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
              key={`${activeCard.id}:${activeChat?.id ?? "no-chat"}`}
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
              selectPersona={selectPersona}
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
              reasoningTraces={reasoningTraces}
              promptRuns={promptRuns.filter((run) => run.cardId === activeCard.id)}
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

        {section === "personas" ? (
          <div className="workspace-grid settings-grid">
            <PersonasPanel
              personas={personas}
              activePersonaId={activePersonaId}
              selectPersona={selectPersona}
              addPersona={addPersona}
              editPersona={editPersona}
              removePersona={removePersona}
              isGenerating={isGenerating}
            />
          </div>
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
            theme={theme}
            runtimeSettings={runtimeSettings}
            setRuntimeSettings={setRuntimeSettings}
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
            isGenerating={isGenerating}
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
