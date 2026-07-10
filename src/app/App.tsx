import {
  type CSSProperties,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BookOpen,
  Eye,
  KeyRound,
  Layers3,
  MessageSquare,
  Moon,
  PenLine,
  Power,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { persistGeneratedImageLocally } from "./imagePersistence";
import { createSnapshotSaveQueue, type SnapshotSaveQueue } from "./snapshotSaveQueue";
import { compileImagePrompt } from "../runtime/imagePromptCompiler";
import {
  applyHiddenContinuityToCard,
  buildVisibleUserMessageWithHiddenContinuity,
  createEmptyHiddenContinuityResult,
  runHiddenContinuityPassSafely,
  toHiddenContinuityKnowledgeUpdates,
  type HiddenContinuityResult,
  type StoryEntity,
} from "../runtime/hiddenContinuity";
import { detectKnowledgeLeaks, describeKnowledgeLeaks } from "../runtime/knowledgeLeakDetector";
import { selectActiveLorebookEntries } from "../runtime/loreTriggerEngine";
import { formatDiceResult, rollFromNotation } from "../runtime/diceEngine";
import { parseSlashCommand } from "../runtime/slashCommands";
import {
  appendRestorePoint,
  buildRestorePoint,
  findRestorePoint,
  type RestorePoint,
} from "../runtime/restorePoints";
import { conversationRestoreSignature } from "./restoreSignature";
import {
  deriveStatusBlockLocationProposal,
  stripTrailingCallToAction,
} from "./assistantMessageParsing";
import {
  compileTurnPrompt,
  runTurnPipeline,
  TURN_PIPELINE_LAYER_IDS,
} from "../runtime/turnPipeline";
import { runMemoryConsolidationSafely } from "../runtime/memoryConsolidation";
import {
  validatePlayerAction as validatePlayerActionWithRules,
} from "../runtime/playerRuleEngine";
import { ComfyUIImageProvider, fetchComfyUIImageModels } from "../providers/comfyUIProvider";
import {
  requireSecureKeyStorage,
  type KeyStorage,
  type SecureStorageStatus,
} from "../security/keyStorage";
import {
  loadLocalRuntimeSnapshot,
  saveLocalRuntimeSnapshot,
} from "./localRuntimeStore";
import {
  buildRuntimeDiagnostics,
  buildVersionedRuntimeExport,
  parseVersionedRuntimeExport,
} from "./runtimeDataBundle";
import { RuntimeRepositoryStore, type RuntimeRepository, type RepositoryRuntimeSnapshot } from "./runtimeRepositoryStore";
import { SettingsSection } from "./SettingsSection";
import { OnboardingOverlay } from "./OnboardingOverlay";
import {
  shouldPersistFullLocalSnapshot,
  shouldShowOnboarding,
  shouldUseRepositorySnapshot,
} from "./startupPersistencePolicy";
import {
  applyValidatedTurnEffectsToCard,
  describeValidatedTurnEffects,
  filterValidatedTurnEffectsForPolicy,
} from "./turnEffects";

import type {
  AppRuntimeSnapshot,
  CardTab,
  ChatSession,
  GeneratedMapArtifact,
  ImageProviderSettings,
  Lorebook,
  LorebookEntry,
  MainSection,
  MediaPreviewArtifact,
  Message,
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
  toRepositorySnapshot,
  toRuntimeExportSnapshot,
} from "./appUtils";
import {
  buildWriteForMeDraft,
  cloneMessagesForBranch,
  createChatSession,
  createRuntimeEntityId,
  deriveChatTitle,
  filterPersistedOpeningMessages,
  getActiveChatForCard,
  getCardChats,
  getStartupActiveCardId,
  parseActiveChatIds,
  parseChatSessions,
  upsertChatSession,
} from "./chatSessions";
import {
  buildImagePromptRequest,
  planImagePromptWithTextModel,
  sanitizeMapNegativePrompt,
} from "./imagePromptPlanning";
import {
  createCustomPlayerRule,
  createDefaultCharacterPlayerRules,
  createDefaultRpgPlayerRules,
  createEmptyLorebook,
  createInitialLorebooks,
  createInitialStoryEntities,
  describeHiddenContinuityChanges,
  normalizeRuntimeCards,
  toHiddenContinuityCard,
} from "./cardNormalization";
import {
  applyPromptDebugRetention,
  createTextProvider,
  getAllowedProviderBaseUrl,
  isHostedDesktopProvider,
  normalizeImageProviderQualitySettings,
  parseImageProviderSettings,
  parseProviderSettings,
  parseRuntimeSettings,
} from "./providerConfig";
import {
  buildCharacterPortraitPrompt,
  buildCustomImagePrompt,
  isComfyUiImageProviderReady,
  findCharacterPortraitForEntity,
  findCharacterPortraitsForCard,
  findGeneratedMapForChat,
  hasGeneratedCharacterPortraitForEntity,
  parseGeneratedMaps,
  shouldAutoGenerateCharacterPortrait,
  upsertGeneratedMap,
  upsertGeneratedMaps,
} from "./generatedImages";
import { buildTurnPromptRequest, isTauriRuntime } from "./turnPromptBuilders";
import type { ImportedCard } from "./cardImport";
import {
  characterPortraitNegativePrompt,
  customImageNegativePrompt,
  defaultNewCard,
  emptyCompiledPrompt,
  initialCards,
  randomOpeningAction,
  starterMessages,
} from "./appDefaults";


import {
  collectActiveLorebooks,
  createPersona,
  deletePersona,
  getActivePersona,
  parseActivePersonaId,
  parsePersonas,
  setDefaultPersona,
  updatePersona,
} from "./personas";
import { NoActiveCardRuntimePanel, RuntimeSection } from "./RuntimeSection";
import { CardsSection } from "./CardsSection";
import { GlobalLorebooksSection } from "./GlobalLorebooksSection";
import { ProvidersSection } from "./ProvidersSection";
import { MediaPreviewDialog, MemoryDrawer } from "./Overlays";

/** Pre-persona snapshots kept the impersonation prompt on runtimeSettings; parsePersonas migrates it. */
function readLegacyImpersonationPrompt(runtimeSettings: Record<string, unknown> | undefined): string {
  const legacy = runtimeSettings?.impersonationPrompt;
  return typeof legacy === "string" ? legacy : "";
}

export function App() {
  const [initialSnapshot] = useState(() => loadLocalRuntimeSnapshot<RuntimeCard, Message, PromptRun, ChatSession>());
  const initialRuntimeSettings = parseRuntimeSettings(initialSnapshot?.runtimeSettings);
  const initialPersonas = parsePersonas(
    initialSnapshot?.personas,
    readLegacyImpersonationPrompt(initialSnapshot?.runtimeSettings),
  );
  const normalizedInitialCards = normalizeRuntimeCards(initialSnapshot?.cards ?? initialCards);
  const initialActiveCardId = getStartupActiveCardId(initialSnapshot, normalizedInitialCards);
  const initialChatSessions = parseChatSessions(
    initialSnapshot?.chatSessions,
    normalizedInitialCards,
    initialSnapshot?.messages ?? starterMessages,
    initialActiveCardId,
  );
  const repositoryStoreRef = useRef<RuntimeRepository | null>(null);
  const snapshotSaveQueueRef = useRef<SnapshotSaveQueue<RepositoryRuntimeSnapshot> | null>(null);
  const pendingReviewRef = useRef<Record<string, string[]>>({});
  const keyStorageRef = useRef<KeyStorage>(requireSecureKeyStorage());
  const [theme, setTheme] = useState<Theme>(() => initialSnapshot?.theme ?? "dark");
  const [section, setSection] = useState<MainSection>("runtime");
  const [cards, setCards] = useState<RuntimeCard[]>(() => normalizedInitialCards);
  const [activeCardId, setActiveCardId] = useState(() => initialActiveCardId);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>(() => initialChatSessions);
  const [activeChatIds, setActiveChatIds] = useState<Record<string, string>>(() =>
    parseActiveChatIds(initialSnapshot?.activeChatIds, normalizedInitialCards, initialChatSessions, initialActiveCardId),
  );
  const [cardTab, setCardTab] = useState<CardTab>("chat");
  const [draft, setDraft] = useState("");
  const [runtimeRunning, setRuntimeRunning] = useState(true);
  const [promptRuns, setPromptRuns] = useState<PromptRun[]>(() =>
    applyPromptDebugRetention(initialSnapshot?.promptRuns ?? [], initialRuntimeSettings),
  );
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [ruleWarning, setRuleWarning] = useState<string | null>(null);
  const [mapPrompt, setMapPrompt] = useState<string | null>(null);
  const [imagePromptDraft, setImagePromptDraft] = useState("");
  const [imageNegativePromptDraft, setImageNegativePromptDraft] = useState("");
  const [mapArtifact, setMapArtifact] = useState<GeneratedMapArtifact | null>(() =>
    parseGeneratedMaps(initialSnapshot?.generatedMaps).find(
      (artifact) => artifact.cardId === initialSnapshot?.activeCardId && artifact.imageKind === "map",
    ) ??
    null,
  );
  const [photoSpecDraft, setPhotoSpecDraft] = useState("");
  const [photoPrompt, setPhotoPrompt] = useState("");
  const [photoArtifact, setPhotoArtifact] = useState<GeneratedMapArtifact | null>(() =>
    parseGeneratedMaps(initialSnapshot?.generatedMaps).find(
      (artifact) => artifact.cardId === initialSnapshot?.activeCardId && artifact.imageKind === "photo",
    ) ??
    null,
  );
  const [generatedMaps, setGeneratedMaps] = useState<GeneratedMapArtifact[]>(() =>
    parseGeneratedMaps(initialSnapshot?.generatedMaps),
  );
  const [isDraftingMapPrompt, setIsDraftingMapPrompt] = useState(false);
  const [isGeneratingMapImage, setIsGeneratingMapImage] = useState(false);
  const [isGeneratingPhoto, setIsGeneratingPhoto] = useState(false);
  const [newCard, setNewCard] = useState(defaultNewCard);
  const [providerKeyStatus, setProviderKeyStatus] = useState(
    () => initialSnapshot?.providerKeyStatus ?? "No plaintext keys stored.",
  );
  const [providerTestStatus, setProviderTestStatus] = useState("No provider test has run yet.");
  const [providerSettings, setProviderSettings] = useState<ProviderSettings>(() =>
    parseProviderSettings(initialSnapshot?.providerSettings),
  );
  const [imageProviderSettings, setImageProviderSettings] = useState<ImageProviderSettings>(() =>
    parseImageProviderSettings(initialSnapshot?.imageProviderSettings),
  );
  const [comfyUiCheckpointModels, setComfyUiCheckpointModels] = useState<string[]>([]);
  const [imageProviderStatus, setImageProviderStatus] = useState("ComfyUI image model check has not run yet.");
  const [runtimeSettings, setRuntimeSettings] = useState<RuntimeSettings>(() => initialRuntimeSettings);
  const [personas, setPersonas] = useState<Persona[]>(() => initialPersonas);
  const [activePersonaId, setActivePersonaId] = useState(() =>
    parseActivePersonaId(initialSnapshot?.activePersonaId, initialPersonas),
  );
  const [sessionApiKey, setSessionApiKey] = useState("");
  const [imageSessionApiKey, setImageSessionApiKey] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingReply, setStreamingReply] = useState("");
  const [isConsolidatingMemory, setIsConsolidatingMemory] = useState(false);
  const [memoryConsolidationStatus, setMemoryConsolidationStatus] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState(initialSnapshot ? "Loaded local runtime snapshot." : "Ready for local save.");
  const [repositoryStatus, setRepositoryStatus] = useState("Repository store initializing.");
  const [dataManagementStatus, setDataManagementStatus] = useState("Runtime export, import, and diagnostics are ready.");
  const [repositoryHydrated, setRepositoryHydrated] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [restorePoints, setRestorePoints] = useState<RestorePoint<AppRuntimeSnapshot>[]>([]);
  const [restoreStatus, setRestoreStatus] = useState("Restore points capture automatically as you play this session.");
  const [pendingDeleteChatId, setPendingDeleteChatId] = useState<string | null>(null);
  const [pendingDeleteCardId, setPendingDeleteCardId] = useState<string | null>(null);
  const [newCardError, setNewCardError] = useState<string | null>(null);
  const [lorebookEntryError, setLorebookEntryError] = useState<string | null>(null);
  const [mediaPreview, setMediaPreview] = useState<MediaPreviewArtifact | null>(null);
  const [secureStorageStatus, setSecureStorageStatus] = useState<SecureStorageStatus>({
    available: false,
    storageKind: "memory-only",
    reason: "Secure storage status has not been checked yet.",
  });

  const activeCard = cards.find((card) => card.id === activeCardId) ?? null;
  const activePersona = getActivePersona(personas, activePersonaId);
  const activeChat = activeCard ? getActiveChatForCard(activeCard.id, chatSessions, activeChatIds) : undefined;
  const messages = useMemo(() => filterPersistedOpeningMessages(activeChat?.messages ?? []), [activeChat?.messages]);
  const visibleMessages = messages.filter((message) => message.role !== "system");
  const activeLorebookEntries = useMemo(
    () => {
      if (!activeCard) {
        return [];
      }
      return selectActiveLorebookEntries({
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
      });
    },
    [activeCard, activePersona, messages, draft],
  );

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
      return compileTurnPrompt({
        ...buildTurnPromptRequest(
          activeCard,
          deferredLorebookEntries,
          messages,
          deferredDraft,
          runtimeSettings,
          activePersona,
        ),
        includeLayerLabels: true,
      });
    },
    [activeCard, activePersona, deferredLorebookEntries, deferredDraft, messages, runtimeSettings],
  );
  const compiledPrompt = compiledPromptResult.prompt;
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

  const currentSnapshotRef = useRef(currentSnapshot);
  const restoreSignatureRef = useRef<string>("");

  useEffect(() => {
    currentSnapshotRef.current = currentSnapshot;
  }, [currentSnapshot]);

  useEffect(() => {
    if (!repositoryHydrated) {
      return;
    }
    const signature = conversationRestoreSignature(chatSessions, cards.length);
    if (signature === restoreSignatureRef.current) {
      return;
    }
    restoreSignatureRef.current = signature;
    setRestorePoints((current) =>
      appendRestorePoint(
        current,
        buildRestorePoint({
          id: createRuntimeEntityId("restore"),
          createdAt: new Date().toISOString(),
          snapshot: currentSnapshotRef.current,
        }),
      ),
    );
  }, [cards, chatSessions, repositoryHydrated]);

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
    let cancelled = false;

    if (imageProviderSettings.mode !== "comfyui") {
      setComfyUiCheckpointModels([]);
      setImageProviderStatus("Prompt-only image mode active.");
      return () => {
        cancelled = true;
      };
    }

    setImageProviderStatus("Checking ComfyUI startup requirements...");
    void fetchComfyUIImageModels({
      endpoint: imageProviderSettings.endpoint,
      apiKey: imageSessionApiKey,
    })
      .then((models) => {
        if (cancelled) {
          return;
        }
        setComfyUiCheckpointModels(models);
        if (models.length === 0) {
          setImageProviderStatus(
            "ComfyUI is reachable, but no image diffusion models are visible. Install a FLUX.2 model in models/diffusion_models, then refresh ComfyUI.",
          );
          return;
        }

        if (models.includes(imageProviderSettings.model)) {
          setImageProviderStatus(
            `Startup check ready: ${models.length} image model${models.length === 1 ? "" : "s"} visible. Selected ${imageProviderSettings.model}.`,
          );
          return;
        }

        const installedModel = models[0];
        setImageProviderSettings((current) =>
          current.mode === "comfyui" && !models.includes(current.model)
            ? {
                ...current,
                model: installedModel,
              }
            : current,
        );
        setImageProviderStatus(
          `Startup check ready: selected installed image model ${installedModel} because the saved model was not visible to ComfyUI.`,
        );
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setComfyUiCheckpointModels([]);
        setImageProviderStatus(`ComfyUI startup check failed: ${getErrorMessage(error)}`);
      });

    return () => {
      cancelled = true;
    };
  }, [imageProviderSettings.endpoint, imageProviderSettings.mode, imageProviderSettings.model, imageSessionApiKey]);

  useEffect(() => {
    let cancelled = false;
    setRepositoryHydrated(false);

    void RuntimeRepositoryStore.create()
      .then(async (store) => {
        if (cancelled) {
          return;
        }

        repositoryStoreRef.current = store;
        setRepositoryStatus(
          store.getStatus().backend === "tauri-sqlite"
            ? "SQLite repository ready."
            : "Repository API ready with in-memory SQL fallback.",
        );

        try {
          const repositorySnapshot = await store.loadSnapshot();
          if (!cancelled && repositorySnapshot && shouldUseRepositorySnapshot(repositorySnapshot, initialSnapshot)) {
            hydrateFromSnapshot(repositorySnapshot);
          }
        } finally {
          if (!cancelled) {
            setRepositoryHydrated(true);
          }
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setRepositoryStatus(`Repository unavailable: ${getErrorMessage(error)}`);
          setRepositoryHydrated(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [initialSnapshot]);

  useEffect(() => {
    let cancelled = false;

    void keyStorageRef.current.getStatus().then((status) => {
      if (!cancelled) {
        setSecureStorageStatus(status);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setMapArtifact(activeCard ? findGeneratedMapForChat(generatedMaps, activeCard.id, activeChat?.id, "map") : null);
    setPhotoArtifact(activeCard ? findGeneratedMapForChat(generatedMaps, activeCard.id, activeChat?.id, "photo") : null);
  }, [activeCard, activeChat?.id, generatedMaps]);

  useEffect(() => {
    if (!runtimeSettings.promptDebugLogs) {
      setPromptRuns((current) => applyPromptDebugRetention(current, runtimeSettings));
    }
  }, [runtimeSettings]);

  useEffect(() => {
    if (!mapArtifact) {
      return;
    }

    setMapPrompt(mapArtifact.prompt);
    setImagePromptDraft(mapArtifact.prompt);
    setImageNegativePromptDraft(mapArtifact.negativePrompt);
  }, [mapArtifact]);

  useEffect(() => {
    let cancelled = false;
    const shouldPersistBrowserFallback = shouldPersistFullLocalSnapshot({ isDesktopRuntime: isTauriRuntime() });
    if (shouldPersistBrowserFallback) {
      saveLocalRuntimeSnapshot(currentSnapshot);
      setSaveStatus("Saved locally in this browser runtime.");
    } else if (!repositoryHydrated) {
      setSaveStatus("Waiting for SQLite repository before writing desktop state.");
    }

    const store = repositoryStoreRef.current;
    if (store && repositoryHydrated) {
      snapshotSaveQueueRef.current ??= createSnapshotSaveQueue((snapshot: RepositoryRuntimeSnapshot) =>
        store.saveSnapshot(snapshot),
      );
      void snapshotSaveQueueRef.current
        .enqueue(toRepositorySnapshot(currentSnapshot))
        .then(() => {
          if (!cancelled) {
            setSaveStatus(
              store.getStatus().backend === "tauri-sqlite"
                ? "Saved to local SQLite repository."
                : "Saved to repository API and browser fallback.",
            );
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setSaveStatus(
              shouldPersistBrowserFallback
                ? `Local fallback saved; repository save failed: ${getErrorMessage(error)}`
                : `Repository save failed: ${getErrorMessage(error)}`,
            );
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [currentSnapshot, repositoryHydrated]);

  function hydrateFromSnapshot(snapshot: RepositoryRuntimeSnapshot, status = "Loaded repository runtime snapshot.") {
    const normalizedCards = normalizeRuntimeCards(snapshot.cards as RuntimeCard[]);
    const hydratedActiveCardId = getStartupActiveCardId(snapshot as AppRuntimeSnapshot, normalizedCards);
    const hydratedChatSessions = parseChatSessions(
      snapshot.chatSessions as ChatSession[] | undefined,
      normalizedCards,
      snapshot.messages as Message[],
      hydratedActiveCardId,
    );
    setTheme(snapshot.theme);
    setCards(normalizedCards);
    setActiveCardId(hydratedActiveCardId);
    setChatSessions(hydratedChatSessions);
    setActiveChatIds(parseActiveChatIds(snapshot.activeChatIds, normalizedCards, hydratedChatSessions, hydratedActiveCardId));
    const hydratedRuntimeSettings = parseRuntimeSettings(snapshot.runtimeSettings);
    const hydratedPersonas = parsePersonas(snapshot.personas, readLegacyImpersonationPrompt(snapshot.runtimeSettings));
    setPromptRuns(applyPromptDebugRetention(snapshot.promptRuns as PromptRun[], hydratedRuntimeSettings));
    setProviderKeyStatus(snapshot.providerKeyStatus);
    setProviderSettings(parseProviderSettings(snapshot.providerSettings));
    setImageProviderSettings(parseImageProviderSettings(snapshot.imageProviderSettings));
    setRuntimeSettings(hydratedRuntimeSettings);
    setPersonas(hydratedPersonas);
    setActivePersonaId(parseActivePersonaId(snapshot.activePersonaId, hydratedPersonas));
    const hydratedMaps = parseGeneratedMaps(snapshot.generatedMaps);
    setGeneratedMaps(hydratedMaps);
    setMapArtifact(hydratedActiveCardId ? findGeneratedMapForChat(hydratedMaps, hydratedActiveCardId, undefined, "map") : null);
    setPhotoArtifact(hydratedActiveCardId ? findGeneratedMapForChat(hydratedMaps, hydratedActiveCardId, undefined, "photo") : null);
    setSaveStatus(status);
  }

  function exportRuntimeData() {
    const bundle = buildVersionedRuntimeExport(toRuntimeExportSnapshot(currentSnapshot));
    downloadJson(`rpg-runtime-${formatDownloadTimestamp(bundle.exportedAt)}.json`, bundle);
    setDataManagementStatus(`Runtime export downloaded: schema v${bundle.version}.`);
  }

  function importRuntimeData(rawJson: string) {
    try {
      const snapshot = parseVersionedRuntimeExport(rawJson);
      hydrateFromSnapshot(snapshot as RepositoryRuntimeSnapshot, "Imported runtime export.");
      setDataManagementStatus(`Imported runtime export saved at ${snapshot.savedAt}.`);
    } catch (error) {
      setDataManagementStatus(getErrorMessage(error));
    }
  }

  function downloadDiagnostics() {
    const diagnostics = buildRuntimeDiagnostics({
      snapshot: toRuntimeExportSnapshot(currentSnapshot),
      repositoryStatus,
      saveStatus,
      providerKeyStatus,
      imageProviderStatus,
      runtimeBackend: repositoryStoreRef.current?.getStatus().backend ?? "unknown",
    });
    downloadJson(`rpg-diagnostics-${formatDownloadTimestamp(diagnostics.exportedAt)}.json`, diagnostics);
    setDataManagementStatus(`Diagnostics downloaded: schema v${diagnostics.version}.`);
  }

  function selectCard(card: RuntimeCard) {
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

  function editCard(card: RuntimeCard) {
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

    const customRuleText = newCard.playerRules
      .split("\n")
      .map((rule) => rule.trim())
      .filter(Boolean);
    const baseRules = newCard.kind === "rpg" ? createDefaultRpgPlayerRules() : createDefaultCharacterPlayerRules();
    const customRules = customRuleText.map((rule) => createCustomPlayerRule(rule, rule));
    const cardId = createRuntimeEntityId("card");

    const card: RuntimeCard = {
      id: cardId,
      name: newCard.name.trim(),
      kind: newCard.kind,
      summary: newCard.summary.trim() || "User-created runtime card.",
      characterName: newCard.characterName.trim() || newCard.name.trim(),
      characterDescription: newCard.characterDescription.trim(),
      scenario: newCard.scenario.trim(),
      greeting: newCard.greeting.trim(),
      exampleDialogs: newCard.exampleDialogs.trim(),
      systemPrompt: newCard.systemPrompt.trim() || "Follow this card's local rules and continuity.",
      preHistoryInstructions: newCard.preHistoryInstructions.trim(),
      postHistoryInstructions: newCard.postHistoryInstructions.trim(),
      playerRules: [...baseRules, ...customRules],
      mapEnabled: newCard.mapEnabled,
      lorebooks: createInitialLorebooks(cardId, newCard.lorebookName),
      memory: [],
      storyEntities: createInitialStoryEntities(cardId, {
        cardKind: newCard.kind,
        cardCharacterName: newCard.characterName.trim() || newCard.name.trim(),
      }),
      rpg:
        newCard.kind === "rpg"
          ? {
              location: "Unmapped starting area",
              health: "not configured",
              inventory: [],
              quests: [],
              flags: {},
              knownPlaces: [],
              mapStyle: "birdseye map, readable labels, clean cartographic layout",
            }
          : undefined,
    };

    setCards((current) => [...current, card]);
    const chat = createChatSession(card.id, `${card.name} chat`);
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
    const chat = createChatSession(card.id, `${card.name} chat`);
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
    setCards((current) =>
      current.map((card) => (card.id === activeCard.id ? { ...card, ...patch } : card)),
    );
  }

  function clearStoryCharacters() {
    if (!activeCard) {
      return;
    }
    setCards((current) =>
      current.map((card) =>
        card.id === activeCard.id
          ? {
              ...card,
              storyEntities: createInitialStoryEntities(card.id, {
                cardKind: card.kind,
                cardCharacterName: card.characterName,
              }),
            }
          : card,
      ),
    );
    setGeneratedMaps((current) =>
      current.filter((artifact) => artifact.cardId !== activeCard.id || artifact.imageKind !== "character"),
    );
  }

  function ensureChatForCard(card: RuntimeCard) {
    const existing = chatSessions.find((chat) => chat.cardId === card.id);
    if (existing) {
      setActiveChatIds((current) => ({ ...current, [card.id]: current[card.id] ?? existing.id }));
      return;
    }

    const chat = createChatSession(card.id, `${card.name} chat`);
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
    const chat = createChatSession(activeCard.id, `${activeCard.name} chat ${getCardChats(activeCard.id, chatSessions).length + 1}`);
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
    const branch = createChatSession(activeCard.id, `${activeChat.title || activeCard.name} branch`, {
      id: branchId,
      branchOfId: activeChat.id,
      branchedFromMessageId: activeChat.messages[activeChat.messages.length - 1]?.id,
      messages: cloneMessagesForBranch(activeChat.messages, branchId),
    });
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

    const remainingForCard = getCardChats(activeCard.id, chatSessions).filter((chat) => chat.id !== activeChat.id);
    const fallback = remainingForCard[0] ?? createChatSession(activeCard.id, `${activeCard.name} chat`);
    setPendingDeleteChatId(null);
    setChatSessions((current) => [
      ...current.filter((chat) => chat.id !== activeChat.id && (chat.cardId !== activeCard.id || remainingForCard.some((candidate) => candidate.id === chat.id))),
      ...(remainingForCard.length === 0 ? [fallback] : []),
    ]);
    setActiveChatIds((current) => ({ ...current, [activeCard.id]: fallback.id }));
    setPromptRuns((current) => current.filter((run) => run.chatId !== activeChat.id));
    setGeneratedMaps((current) => current.filter((artifact) => artifact.chatId !== activeChat.id));
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
    if (!activeCard) {
      return;
    }
    setCards((current) =>
      current.map((card) =>
        card.id === activeCard.id && card.rpg
          ? {
              ...card,
              rpg: {
                ...card.rpg,
                ...patch,
              },
            }
          : card,
      ),
    );
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
    setLorebookEntryError(null);

    const nextEntry: LorebookEntry = {
      id: `lore_entry_${Date.now()}`,
      title: entry.title.trim() || "Untitled lore entry",
      keys: parseList(entry.keys),
      secondaryKeys: parseList(entry.secondaryKeys),
      content: entry.content.trim(),
      insertionOrder: toBoundedNumber(entry.insertionOrder, 100, 0, 10_000),
      priority: toBoundedNumber(entry.priority, 0, -100, 100),
      enabled: true,
      constant: entry.constant,
      probability: toBoundedNumber(entry.probability, 100, 0, 100),
      caseSensitive: entry.caseSensitive,
      wholeWord: entry.wholeWord,
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
    if (!activeChat) {
      return;
    }
    const trimmed = content.trim();
    if (!trimmed) {
      return;
    }
    setChatSessions((current) =>
      upsertChatSession(current, {
        ...activeChat,
        messages: activeChat.messages.map((message) => {
          if (message.id !== messageId) {
            return message;
          }
          if (message.variants && message.variants.length > 0) {
            const activeIndex = message.activeVariantIndex ?? message.variants.length - 1;
            return {
              ...message,
              content: trimmed,
              variants: message.variants.map((variant, index) => (index === activeIndex ? trimmed : variant)),
            };
          }
          return { ...message, content: trimmed };
        }),
        updatedAt: new Date().toISOString(),
      }),
    );
  }

  function swipeMessageVariant(messageId: string, direction: -1 | 1) {
    if (!activeChat) {
      return;
    }
    setChatSessions((current) =>
      upsertChatSession(current, {
        ...activeChat,
        messages: activeChat.messages.map((message) => {
          if (message.id !== messageId || !message.variants || message.variants.length < 2) {
            return message;
          }
          const currentIndex = message.activeVariantIndex ?? message.variants.length - 1;
          const nextIndex = (currentIndex + direction + message.variants.length) % message.variants.length;
          return { ...message, content: message.variants[nextIndex], activeVariantIndex: nextIndex };
        }),
        updatedAt: new Date().toISOString(),
      }),
    );
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
    await generateMockTurn({ actionOverride: action, baseMessages, previousVariants });
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
    const rollChat = activeChat ?? createChatSession(activeCard.id, `${activeCard.name} chat`);
    if (!activeChat) {
      setActiveChatIds((current) => ({ ...current, [activeCard.id]: rollChat.id }));
    }
    const diceMessage: Message = {
      id: `dice-${createRuntimeEntityId("run")}`,
      role: "user",
      content: formatDiceResult(rolled),
    };
    setChatSessions((current) =>
      upsertChatSession(current, {
        ...rollChat,
        messages: [...filterPersistedOpeningMessages(rollChat.messages), diceMessage],
        updatedAt: new Date().toISOString(),
      }),
    );
    setDraft("");
    setRuleWarning("");
  }

  async function generateMockTurn(options?: {
    actionOverride?: string;
    baseMessages?: Message[];
    previousVariants?: string[];
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

    const parsedCommand = options?.actionOverride === undefined ? parseSlashCommand(draft.trim()) : null;
    if (parsedCommand) {
      await runSlashCommand(parsedCommand.command.name, parsedCommand.args);
      return;
    }

    const visibleUserAction = (options?.actionOverride ?? draft).trim();
    const generationAction = visibleUserAction || randomOpeningAction;

    const validation = validatePlayerActionWithRules({
      cardKind: activeCard.kind,
      rules: activeCard.playerRules,
      action: generationAction,
      rpgState: activeCard.rpg,
    });
    setRuleWarning(validation.warning);
    if (!validation.allowed) {
      return;
    }

    setIsGenerating(true);
    setStreamingReply("");
    const runId = createRuntimeEntityId("run");
    const chat = activeChat ?? createChatSession(activeCard.id, `${activeCard.name} chat`);
    const chatMessages = options?.baseMessages ?? filterPersistedOpeningMessages(chat.messages);
    if (!activeChat) {
      setChatSessions((current) => [...current, chat]);
      setActiveChatIds((current) => ({ ...current, [activeCard.id]: chat.id }));
    }
    const userMessage: Message = {
      id: `user-${runId}`,
      role: "user",
      content: generationAction,
    };
    try {
      const provider = createTextProvider(providerSettings, sessionApiKey, activeCard, generationAction, activeLorebookEntries.length);
      const model = providerSettings.mode === "mock" ? "mock-narrator" : providerSettings.model;
      const hiddenContinuity = await runHiddenContinuityPassSafely({
        modelAdapter: provider,
        model,
        card: toHiddenContinuityCard(activeCard),
        messages: chatMessages,
        latestUserMessage: generationAction,
        activeLoreCount: activeLorebookEntries.length,
        pendingReviewProposals: pendingReviewRef.current[activeCard.id] ?? [],
      });
      const continuityCard = applyHiddenContinuityToCard(activeCard, hiddenContinuity);
      const hiddenLatestUserMessage: Message = {
        ...userMessage,
        content: buildVisibleUserMessageWithHiddenContinuity(
          generationAction,
          hiddenContinuity,
          toHiddenContinuityCard(continuityCard),
        ),
      };
      const pipelineResult = await runTurnPipeline({
        ...buildTurnPromptRequest(
          continuityCard,
          activeLorebookEntries,
          chatMessages,
          generationAction,
          runtimeSettings,
          activePersona,
          {
            latestUserMessage: hiddenLatestUserMessage,
            promptRunId: runId,
            metadata: {
              cardKind: activeCard.kind,
              includedLoreEntryIds: activeLorebookEntries.map((entry) => entry.id),
              providerMode: providerSettings.mode,
              textStreaming: runtimeSettings.textStreaming,
              chatId: chat.id,
              hiddenContinuityPass: true,
            },
          },
        ),
        modelAdapter: provider,
        model,
        temperature: 0.6,
        onStreamText: (text) => setStreamingReply(text),
      });
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
      pendingReviewRef.current[activeCard.id] = policyResult.warnings
        .filter((warning) => /^Blocked/i.test(warning))
        .slice(-8);
      const visibleKnowledgeContinuity: HiddenContinuityResult = {
        ...createEmptyHiddenContinuityResult(),
        knowledgeUpdates: toHiddenContinuityKnowledgeUpdates(policyResult.extraction.character_knowledge_updates),
      };
      const warnings = [
        ...hiddenContinuity.warnings.map((warning) => `Hidden continuity: ${warning}`),
        ...pipelineResult.warnings.map((warning) => warning.message),
        ...policyResult.warnings,
      ];
      const stateChanges = [
        ...describeHiddenContinuityChanges(hiddenContinuity),
        ...describeValidatedTurnEffects(policyResult.extraction),
      ];
      const assistantContent = stripTrailingCallToAction(pipelineResult.assistantMessageText);
      const assistantVariants = options?.previousVariants
        ? [...options.previousVariants, assistantContent]
        : undefined;
      const assistantMessage: Message = {
        id: `assistant-${runId}`,
        role: "assistant",
        content: assistantContent,
        ...(assistantVariants && assistantVariants.length > 1
          ? { variants: assistantVariants, activeVariantIndex: assistantVariants.length - 1 }
          : {}),
      };
      const nextActiveCard = applyValidatedTurnEffectsToCard(
        applyHiddenContinuityToCard(continuityCard, visibleKnowledgeContinuity),
        policyResult.extraction,
      );
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

      setChatSessions((current) =>
        upsertChatSession(current, {
          ...chat,
          messages: visibleUserAction ? [...chatMessages, userMessage, assistantMessage] : [...chatMessages, assistantMessage],
          title: chat.title || deriveChatTitle(generationAction),
          updatedAt: new Date().toISOString(),
        }),
      );
      setCards((current) =>
        current.map((card) =>
          card.id === activeCard.id
            ? applyValidatedTurnEffectsToCard(
                applyHiddenContinuityToCard(
                  applyHiddenContinuityToCard(card, hiddenContinuity),
                  visibleKnowledgeContinuity,
                ),
                policyResult.extraction,
              )
            : card,
        ),
      );
      void generateMissingCharacterPortraits(nextActiveCard, chat.id);
      setPromptRuns((current) => [
        ...current,
        {
          id: runId,
          cardId: activeCard.id,
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
          usage: pipelineResult.promptRun.usage,
        },
      ]);
      setDraft("");
    } catch (error) {
      setRuleWarning(getErrorMessage(error));
    } finally {
      setIsGenerating(false);
      setStreamingReply("");
    }
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
    setIsConsolidatingMemory(true);
    setMemoryConsolidationStatus("Consolidating memory...");
    try {
      const provider = createTextProvider(providerSettings, sessionApiKey, activeCard, "", 0);
      const model = providerSettings.mode === "mock" ? "mock-narrator" : providerSettings.model;
      const result = await runMemoryConsolidationSafely({ modelAdapter: provider, model, entries });
      if (result.changed) {
        const before = entries.length;
        setCards((current) =>
          current.map((card) =>
            card.id === activeCard.id
              ? {
                  ...card,
                  memory: result.entries.map((entry) => ({
                    id: entry.id ?? createRuntimeEntityId("memory"),
                    label: entry.label,
                    detail: entry.detail,
                  })),
                }
              : card,
          ),
        );
        setMemoryConsolidationStatus(`Memory consolidated: ${before} to ${result.entries.length} entries.`);
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

  async function prepareImagePrompt() {
    if (!activeCard) {
      return;
    }
    if (!activeCard.mapEnabled) {
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
              activeLoreCount: activeLorebookEntries.length,
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
    if (!activeCard) {
      return;
    }
    if (!activeCard.mapEnabled || !imagePromptDraft.trim()) {
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

  async function generateMissingCharacterPortraits(card: RuntimeCard, chatId: string) {
    const missingPortraits = card.storyEntities
      .filter(shouldAutoGenerateCharacterPortrait)
      .filter((entity) => !hasGeneratedCharacterPortraitForEntity(generatedMaps, card.id, entity));
    if (missingPortraits.length === 0) {
      return;
    }

    const baseArtifacts = missingPortraits.map((entity): GeneratedMapArtifact => ({
      id: createRuntimeEntityId("portrait"),
      imageKind: "character",
      cardId: card.id,
      chatId,
      subjectId: entity.id,
      subjectName: entity.name,
      prompt: buildCharacterPortraitPrompt(card, entity),
      negativePrompt: characterPortraitNegativePrompt,
      provider: imageProviderSettings.mode === "comfyui" ? "comfyui" : "prompt-only",
      model: imageProviderSettings.model,
      status: "prompt-only",
      error: isComfyUiImageProviderReady(imageProviderSettings, imageProviderStatus, comfyUiCheckpointModels)
        ? undefined
        : imageProviderSettings.mode === "comfyui"
          ? "ComfyUI is not ready yet; portrait prompt saved."
          : undefined,
      userInput: entity.name,
      createdAt: new Date().toISOString(),
    }));
    setGeneratedMaps((current) => upsertGeneratedMaps(current, baseArtifacts));

    if (!isComfyUiImageProviderReady(imageProviderSettings, imageProviderStatus, comfyUiCheckpointModels)) {
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

  async function runConfiguredImageGeneration(input: {
    baseArtifact: GeneratedMapArtifact;
    prompt: string;
    negativePrompt: string;
    metadata: Record<string, unknown>;
  }): Promise<GeneratedMapArtifact> {
    const effectiveImageProviderSettings = normalizeImageProviderQualitySettings(imageProviderSettings);
    if (effectiveImageProviderSettings !== imageProviderSettings) {
      setImageProviderSettings(effectiveImageProviderSettings);
    }

    if (
      effectiveImageProviderSettings.mode === "prompt-only" ||
      !effectiveImageProviderSettings.workflowJson.trim()
    ) {
      return {
        ...input.baseArtifact,
        status:
          effectiveImageProviderSettings.mode === "comfyui"
            ? "error"
            : input.baseArtifact.status,
        error:
          effectiveImageProviderSettings.mode === "comfyui"
            ? "Paste a ComfyUI API workflow in Image Provider settings to generate an image."
            : undefined,
      };
    }

    const provider = new ComfyUIImageProvider({
      endpoint: effectiveImageProviderSettings.endpoint,
      workflowJson: effectiveImageProviderSettings.workflowJson,
      model: effectiveImageProviderSettings.model,
      apiKey: imageSessionApiKey,
      pollTimeoutMs: effectiveImageProviderSettings.pollTimeoutMs,
    });
    const result = await provider.generateImage({
      model: effectiveImageProviderSettings.model,
      prompt: input.prompt,
      negativePrompt: input.negativePrompt,
      width: effectiveImageProviderSettings.width,
      height: effectiveImageProviderSettings.height,
      seed: effectiveImageProviderSettings.seed,
      steps: effectiveImageProviderSettings.steps,
      cfg: effectiveImageProviderSettings.cfg,
      samplerName: effectiveImageProviderSettings.samplerName,
      scheduler: effectiveImageProviderSettings.scheduler,
      metadata: input.metadata,
    });
    const imageUrl = result.images[0]?.url;
    if (!imageUrl) {
      return {
        ...input.baseArtifact,
        provider: result.providerId,
        status: "error",
        error: "Image provider finished without an image output.",
      };
    }

    const generatedArtifact: GeneratedMapArtifact = {
      ...input.baseArtifact,
      provider: result.providerId,
      status: "generated",
      imageUrl,
    };
    if (isTauriRuntime()) {
      const durableImageUrl = await persistGeneratedImageLocally(generatedArtifact.id, imageUrl);
      if (durableImageUrl) {
        return { ...generatedArtifact, imageUrl: durableImageUrl };
      }
    }
    return generatedArtifact;
  }

  async function refreshComfyUICheckpoints() {
    if (imageProviderSettings.mode !== "comfyui") {
      setComfyUiCheckpointModels([]);
      setImageProviderStatus("Prompt-only image mode active.");
      return;
    }

    setImageProviderStatus("Checking ComfyUI image models...");
    try {
      const models = await fetchComfyUIImageModels({
        endpoint: imageProviderSettings.endpoint,
        apiKey: imageSessionApiKey,
      });
      applyComfyUiCheckpointModels(models, "manual");
    } catch (error) {
      setComfyUiCheckpointModels([]);
      setImageProviderStatus(`ComfyUI image model check failed: ${getErrorMessage(error)}`);
    }
  }

  function applyComfyUiCheckpointModels(models: string[], source: "startup" | "manual") {
    setComfyUiCheckpointModels(models);
    if (models.length === 0) {
      setImageProviderStatus(
        "ComfyUI is reachable, but no image diffusion models are visible. Install a FLUX.2 model in models/diffusion_models, then refresh ComfyUI.",
      );
      return;
    }

    const sourceLabel = source === "startup" ? "Startup check" : "Image model refresh";
    if (models.includes(imageProviderSettings.model)) {
      setImageProviderStatus(
        `${sourceLabel} ready: ${models.length} image model${models.length === 1 ? "" : "s"} visible. Selected ${imageProviderSettings.model}.`,
      );
      if (activeCard && activeChat) {
        void generateMissingCharacterPortraits(activeCard, activeChat.id);
      }
      return;
    }

    const installedModel = models[0];
    setImageProviderSettings((current) =>
      current.mode === "comfyui" && !models.includes(current.model)
        ? {
            ...current,
            model: installedModel,
          }
        : current,
    );
    setImageProviderStatus(
      `${sourceLabel} ready: selected installed image model ${installedModel} because the saved model was not visible to ComfyUI.`,
    );
    if (activeCard && activeChat) {
      void generateMissingCharacterPortraits(activeCard, activeChat.id);
    }
  }

  async function saveProviderKey() {
    if (providerSettings.mode === "mock") {
      setProviderKeyStatus("Mock provider active; no API key needed.");
      return;
    }

    if (providerSettings.providerId === "local" && !sessionApiKey.trim()) {
      setProviderKeyStatus("Local OpenAI-compatible endpoint active without a stored API key.");
      return;
    }

    if (!sessionApiKey.trim()) {
      setProviderKeyStatus(
        providerSettings.secretReference
          ? "Stored OS keychain reference active. The raw key is not saved in local app data."
          : isHostedDesktopProvider(providerSettings)
            ? "Store this hosted provider key in the OS keychain before generation."
            : "Enter a session API key to use the OpenAI-compatible provider path.",
      );
      return;
    }

    if (providerSettings.providerId === "local") {
      setProviderKeyStatus("Local OpenAI-compatible endpoint active with a memory-only session key.");
      return;
    }

    const status = await keyStorageRef.current.getStatus();
    setSecureStorageStatus(status);
    if (!status.available) {
      setProviderKeyStatus(isTauriRuntime()
        ? `Store this hosted provider key in the OS keychain before generation. Secure storage unavailable: ${
            status.reason ?? "desktop keychain unavailable"
          }`
        : `Session key active in memory only; secure storage unavailable: ${status.reason ?? "desktop keychain unavailable"}`);
      return;
    }

    try {
      const normalizedBaseUrl = getAllowedProviderBaseUrl(providerSettings);
      if (!normalizedBaseUrl) {
        setProviderKeyStatus("Provider endpoint must be the known hosted URL or a loopback local endpoint.");
        return;
      }
      const reference = await keyStorageRef.current.storeSecret({
        providerId: providerSettings.providerId,
        secretName: "apiKey",
        secretValue: sessionApiKey.trim(),
      });
      setProviderSettings((current) => ({
        ...current,
        secretReference: {
          ...reference,
          providerBaseUrl: normalizedBaseUrl,
        },
      }));
      setSessionApiKey("");
      setProviderKeyStatus("API key stored in OS keychain. Only a secret reference is saved locally.");
    } catch (error) {
      setProviderKeyStatus(getErrorMessage(error));
    }
  }

  async function forgetProviderKey() {
    if (!providerSettings.secretReference) {
      setSessionApiKey("");
      setProviderKeyStatus("No stored provider key reference to forget.");
      return;
    }

    try {
      await keyStorageRef.current.deleteSecret(providerSettings.secretReference);
      setProviderSettings((current) => {
        const { secretReference: _secretReference, ...rest } = current;
        return rest;
      });
      setSessionApiKey("");
      setProviderKeyStatus("Stored provider key reference removed.");
    } catch (error) {
      setProviderKeyStatus(getErrorMessage(error));
    }
  }

  async function testTextProvider() {
    setProviderTestStatus("Testing provider...");
    try {
      const providerCard = activeCard ?? cards[0];
      const provider = createTextProvider(providerSettings, sessionApiKey, providerCard, "Provider test", 0);
      const response = await provider.generateText({
        model: providerSettings.mode === "mock" ? "mock-narrator" : providerSettings.model,
        prompt: "Return a short provider health check response.",
        maxOutputTokens: 80,
        temperature: 0,
        metadata: {
          testOnly: true,
        },
      });
      setProviderTestStatus(
        `Provider responded through ${response.providerId} / ${response.model}. Estimated tokens: ${response.usage.totalTokens}.`,
      );
    } catch (error) {
      setProviderTestStatus(getErrorMessage(error));
    }
  }

  function shutdownRuntime() {
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
    const remaining = deletePersona(personas, personaId);
    setPersonas(remaining);
    setActivePersonaId(parseActivePersonaId(activePersonaId, remaining));
  }

  function makePersonaDefault(personaId: string) {
    setPersonas((current) => setDefaultPersona(current, personaId));
  }

  function restoreRuntimeFromPoint(pointId: string) {
    const point = findRestorePoint(restorePoints, pointId);
    if (!point) {
      setRestoreStatus("That restore point is no longer available.");
      return;
    }
    const snapshot = point.snapshot;
    const restoredMessages = snapshot.chatSessions.reduce((count, session) => count + session.messages.length, 0);
    restoreSignatureRef.current = `${restoredMessages}:${snapshot.cards.length}`;
    setTheme(snapshot.theme);
    setCards(snapshot.cards);
    setActiveCardId(snapshot.activeCardId);
    setChatSessions(snapshot.chatSessions);
    setActiveChatIds(snapshot.activeChatIds);
    setPromptRuns(snapshot.promptRuns);
    setProviderKeyStatus(snapshot.providerKeyStatus);
    setProviderSettings(snapshot.providerSettings);
    setImageProviderSettings(snapshot.imageProviderSettings);
    setRuntimeSettings(snapshot.runtimeSettings);
    const restoredPersonas = parsePersonas(snapshot.personas);
    setPersonas(restoredPersonas);
    setActivePersonaId(parseActivePersonaId(snapshot.activePersonaId, restoredPersonas));
    setGeneratedMaps(snapshot.generatedMaps);
    setRestoreStatus(`Restored "${point.label}" from ${formatRestorePointTime(point.createdAt)}.`);
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
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <h1>Local Cards</h1>
            <p>Character and RPG runtime</p>
          </div>
        </div>

        <nav className="nav-list" aria-label="Main sections">
          <button
            className={`nav-item ${section === "runtime" ? "active" : ""}`}
            type="button"
            onClick={() => setSection("runtime")}
          >
            <MessageSquare size={18} />
            Runtime
          </button>
          <button
            className={`nav-item ${section === "cards" ? "active" : ""}`}
            type="button"
            onClick={() => setSection("cards")}
          >
            <BookOpen size={18} />
            Cards
          </button>
          <button
            className={`nav-item ${section === "lorebooks" ? "active" : ""}`}
            type="button"
            onClick={() => setSection("lorebooks")}
          >
            <Layers3 size={18} />
            Lorebooks
          </button>
          <button
            className={`nav-item ${section === "providers" ? "active" : ""}`}
            type="button"
            onClick={() => setSection("providers")}
          >
            <KeyRound size={18} />
            API Keys
          </button>
          <button
            className={`nav-item ${section === "settings" ? "active" : ""}`}
            type="button"
            onClick={() => setSection("settings")}
          >
            <Settings2 size={18} />
            Settings
          </button>
        </nav>

        <button
          className="secondary-button full-width"
          type="button"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>

        <section className="storage-status" aria-label="Active card summary">
          <div className="section-title">
            <ShieldCheck size={16} />
            <h2>Active Card</h2>
          </div>
          <dl className="compact-dl">
            <div>
              <dt>Name</dt>
              <dd>{activeCard?.name ?? "Select a card"}</dd>
            </div>
            <div>
              <dt>Type</dt>
              <dd>{activeCard?.kind ?? "saved library"}</dd>
            </div>
            <div>
              <dt>Local save</dt>
              <dd role="status" aria-live="polite">
                {saveStatus}
              </dd>
            </div>
            <div>
              <dt>Repository</dt>
              <dd role="status" aria-live="polite">
                {repositoryStatus}
              </dd>
            </div>
          </dl>
        </section>
      </aside>

      <section className="workspace" aria-label="Story workspace">
        <header className="topbar">
          <div className="title-stack">
            <p className="eyebrow">
              {activeCard ? (activeCard.kind === "rpg" ? "RPG card active" : "Character card active") : "No card active"}
            </p>
            <h2>{activeCard?.name ?? "Open a saved card"}</h2>
            <p className="title-summary">
              {activeCard?.summary ?? "The starter RPG is saved in the card library and will stay idle until opened."}
            </p>
          </div>
          <div className="topbar-actions">
            {section === "runtime" && activeCard ? (
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  editCard(activeCard);
                  setSection("cards");
                }}
              >
                <PenLine size={17} />
                Edit card
              </button>
            ) : null}
            <button className="secondary-button" type="button" onClick={() => setMemoryOpen(true)} disabled={!activeCard}>
              <Eye size={17} />
              Inspect memory
            </button>
            {runtimeRunning && activeCard ? (
              <button className="secondary-button danger-button" type="button" onClick={shutdownRuntime}>
                <Power size={17} />
                Shut down runtime
              </button>
            ) : activeCard ? (
              <button className="secondary-button" type="button" onClick={startRuntime}>
                <RotateCcw size={17} />
                Start runtime
              </button>
            ) : null}
          </div>
        </header>

        {section === "runtime" ? (
          activeCard ? (
            <RuntimeSection
              activeCard={activeCard}
              activeChat={activeChat}
              cardChats={getCardChats(activeCard.id, chatSessions)}
              selectChat={selectChat}
              startNewChat={startNewChatForActiveCard}
              branchChat={branchActiveChat}
              deleteChat={deleteActiveChat}
              isDeleteChatPending={pendingDeleteChatId === activeChat?.id}
              personas={personas}
              activePersonaId={activePersonaId}
              selectPersona={setActivePersonaId}
              messages={visibleMessages}
              editMessage={editMessageContent}
              regenerateLastReply={regenerateLastReply}
              swipeMessageVariant={swipeMessageVariant}
              draft={draft}
              setDraft={setDraft}
              sendMessage={generateMockTurn}
              writeForMe={writeForMe}
              runtimeRunning={runtimeRunning}
              startRuntime={startRuntime}
              isGenerating={isGenerating}
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
            updateActiveCard={updateActiveCard}
            updateRpgState={updateActiveRpgState}
            updateActiveLorebook={updateActiveLorebook}
            addLorebookEntry={addLorebookEntry}
            lorebookEntryError={lorebookEntryError}
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
        />
      ) : null}
      {showOnboarding ? (
        <OnboardingOverlay
          onAddApiKey={() => setSection("providers")}
          onOpenCards={() => setSection("cards")}
          onDismiss={completeOnboarding}
        />
      ) : null}
    </main>
  );
}

