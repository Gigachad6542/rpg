import {
  type ChangeEvent,
  type CSSProperties,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BookOpen,
  Brush,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  Eye,
  GitBranch,
  Image,
  KeyRound,
  Layers3,
  LockKeyhole,
  Map,
  Maximize2,
  MessageSquare,
  Moon,
  PenLine,
  Plus,
  Power,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  UserRound,
  Wand2,
  X,
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
import { type CompiledPrompt } from "../runtime/promptCompiler";
import { formatDiceResult, rollFromNotation } from "../runtime/diceEngine";
import { matchSlashCommands, parseSlashCommand } from "../runtime/slashCommands";
import {
  appendRestorePoint,
  buildRestorePoint,
  findRestorePoint,
  type RestorePoint,
} from "../runtime/restorePoints";
import { conversationRestoreSignature } from "./restoreSignature";
import {
  deriveStatusBlockLocationProposal,
  parseAssistantMessageDisplay,
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
import { qwen37MaxReferencePreset, recommendedLocalImageProvider } from "../providers/modelPresets";
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
  CardKind,
  CardTab,
  ChatSession,
  GeneratedMapArtifact,
  ImageProviderMode,
  ImageProviderSettings,
  Lorebook,
  LorebookEntry,
  MainSection,
  MediaPreviewArtifact,
  Message,
  NewLorebookEntry,
  NewPlayerRule,
  PlayerRule,
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
  formatFlagsForInput,
  formatRestorePointTime,
  getErrorMessage,
  parseFlags,
  parseList,
  readFileAsText,
  toBoundedFloat,
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
  ensureLorebooks,
  filterLorebookEntries,
  formatEnforcementLabel,
  getEnabledPlayerRules,
  hasStoryEntityDetails,
  isDefaultPlayerStoryEntity,
  normalizeRuntimeCards,
  orderStoryEntitiesForDisplay,
  toHiddenContinuityCard,
} from "./cardNormalization";
import {
  applyPromptDebugRetention,
  createTextProvider,
  getAllowedProviderBaseUrl,
  getDefaultTextModel,
  getImageModelChoices,
  getTextModelChoices,
  isHostedDesktopProvider,
  normalizeImageProviderQualitySettings,
  normalizeProviderBaseUrlOrNull,
  parseImageProviderSettings,
  parseProviderSettings,
  parseRuntimeSettings,
  toLocalImageQualityDimension,
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
  toGeneratedImageSrc,
  upsertGeneratedMap,
  upsertGeneratedMaps,
} from "./generatedImages";
import { buildTurnPromptRequest, isTauriRuntime, renderNarrativeMarkup } from "./turnPromptBuilders";
import { exportLorebookAsChubJson, parseChubLorebookPayload } from "./lorebookIo";
import {
  characterPortraitNegativePrompt,
  customImageNegativePrompt,
  customImagePresetPrompt,
  defaultImageProviderSettings,
  defaultNewCard,
  defaultNewLorebookEntry,
  defaultNewPlayerRule,
  emptyCompiledPrompt,
  initialCards,
  localImageMinimumImageSize,
  localImageMinimumPollTimeoutMs,
  localImageRecommendedCfg,
  localImageRecommendedSteps,
  randomOpeningAction,
  starterMessages,
} from "./appDefaults";


export function App() {
  const [initialSnapshot] = useState(() => loadLocalRuntimeSnapshot<RuntimeCard, Message, PromptRun, ChatSession>());
  const initialRuntimeSettings = parseRuntimeSettings(initialSnapshot?.runtimeSettings);
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
  const activeChat = activeCard ? getActiveChatForCard(activeCard.id, chatSessions, activeChatIds) : undefined;
  const messages = useMemo(() => filterPersistedOpeningMessages(activeChat?.messages ?? []), [activeChat?.messages]);
  const visibleMessages = messages.filter((message) => message.role !== "system");
  const activeLorebookEntries = useMemo(
    () => {
      if (!activeCard) {
        return [];
      }
      return selectActiveLorebookEntries({
        lorebooks: ensureLorebooks(activeCard),
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
    [activeCard, messages, draft],
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
        ...buildTurnPromptRequest(activeCard, deferredLorebookEntries, messages, deferredDraft, runtimeSettings),
        includeLayerLabels: true,
      });
    },
    [activeCard, deferredLorebookEntries, deferredDraft, messages, runtimeSettings],
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
      generatedMaps,
      savedAt: new Date().toISOString(),
    }),
    [
      activeCardId,
      cards,
      chatSessions,
      generatedMaps,
      imageProviderSettings,
      messages,
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
    setPromptRuns(applyPromptDebugRetention(snapshot.promptRuns as PromptRun[], hydratedRuntimeSettings));
    setProviderKeyStatus(snapshot.providerKeyStatus);
    setProviderSettings(parseProviderSettings(snapshot.providerSettings));
    setImageProviderSettings(parseImageProviderSettings(snapshot.imageProviderSettings));
    setRuntimeSettings(hydratedRuntimeSettings);
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
        ...buildTurnPromptRequest(continuityCard, activeLorebookEntries, chatMessages, generationAction, runtimeSettings, {
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
        }),
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

function RuntimeSection(props: {
  activeCard: RuntimeCard;
  activeChat?: ChatSession;
  cardChats: ChatSession[];
  selectChat: (chatId: string) => void;
  startNewChat: () => void;
  branchChat: () => void;
  deleteChat: () => void;
  isDeleteChatPending: boolean;
  messages: Message[];
  editMessage: (messageId: string, content: string) => void;
  regenerateLastReply: () => Promise<void>;
  swipeMessageVariant: (messageId: string, direction: -1 | 1) => void;
  draft: string;
  setDraft: (draft: string) => void;
  sendMessage: () => Promise<void>;
  writeForMe: () => void;
  runtimeRunning: boolean;
  startRuntime: () => void;
  isGenerating: boolean;
  streamingReply: string;
  promptRuns: PromptRun[];
  ruleWarning: string | null;
  mapPrompt: string | null;
  mapArtifact: GeneratedMapArtifact | null;
  imagePromptDraft: string;
  setImagePromptDraft: (value: string) => void;
  imageNegativePromptDraft: string;
  setImageNegativePromptDraft: (value: string) => void;
  photoSpecDraft: string;
  setPhotoSpecDraft: (value: string) => void;
  photoPrompt: string;
  photoArtifact: GeneratedMapArtifact | null;
  characterPortraits: GeneratedMapArtifact[];
  isDraftingMapPrompt: boolean;
  isGeneratingMapImage: boolean;
  isGeneratingPhoto: boolean;
  prepareImagePrompt: () => Promise<void>;
  generateMapImage: () => Promise<void>;
  resetMapPrompt: () => void;
  deleteCurrentMap: () => void;
  generateCustomImageFromRequest: () => Promise<void>;
  resetCustomImageRequest: () => void;
  deleteCurrentPhoto: () => void;
  clearStoryCharacters: () => void;
  regeneratePortrait: (entity: StoryEntity, prompt: string) => void;
  buildPortraitPrompt: (entity: StoryEntity) => string;
  openMediaPreview: (preview: MediaPreviewArtifact) => void;
}) {
  const showMapPanel = props.activeCard.mapEnabled;
  const showMediaPanel = true;
  const isMapBusy = props.isDraftingMapPrompt || props.isGeneratingMapImage;
  const isRpgAerialImage = props.activeCard.kind === "rpg";
  const mediaPrimaryLabel = isRpgAerialImage ? "Aerial image" : "Image";
  const promptButtonLabel = isRpgAerialImage ? "Draft aerial image prompt" : "Draft image prompt";
  const generateMapButtonLabel = props.mapArtifact
    ? isRpgAerialImage
      ? "Regenerate aerial image"
      : "Regenerate image"
    : isRpgAerialImage
      ? "Generate aerial image"
      : "Generate image";
  const mapPromptDraft = props.imagePromptDraft.trim();
  const negativePromptDraft = props.imageNegativePromptDraft.trim();
  const mapArtifactMatchesDraft =
    props.mapArtifact &&
    props.mapArtifact.prompt.trim() === mapPromptDraft &&
    (props.mapArtifact.negativePrompt ?? "").trim() === negativePromptDraft;
  const hasPendingMapPromptDraft = Boolean(
    mapPromptDraft && (!props.mapArtifact || !mapArtifactMatchesDraft),
  );
  const openingText = getCardOpeningText(props.activeCard);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const lastMessage = props.messages[props.messages.length - 1];
  const regenerableMessageId =
    lastMessage?.role === "assistant" && props.runtimeRunning && !props.isGenerating ? lastMessage.id : null;

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript) {
      return;
    }
    transcript.scrollTop = transcript.scrollHeight;
  }, [props.messages.length, props.isGenerating, props.activeChat?.id, props.runtimeRunning]);

  return (
    <div className={`runtime-chat-layout ${showMediaPanel ? "" : "no-map"}`}>
      <section className="chat-shell" aria-label="Runtime chat">
        <div className="chat-session-bar" aria-label="Chat controls">
          <label className="field chat-select">
            <span>Chat</span>
            <select
              aria-label="Active chat"
              value={props.activeChat?.id ?? ""}
              onChange={(event) => props.selectChat(event.target.value)}
            >
              {props.cardChats.map((chat) => (
                <option value={chat.id} key={chat.id}>
                  {chat.title}
                </option>
              ))}
            </select>
          </label>
          <div className="chat-actions">
            <button className="secondary-button compact-button" type="button" onClick={props.startNewChat}>
              <Plus size={16} />
              New chat
            </button>
            <button
              className="secondary-button compact-button"
              type="button"
              onClick={props.branchChat}
              disabled={!props.activeChat || props.messages.length === 0}
            >
              <GitBranch size={16} />
              Branch chat
            </button>
            <button className="secondary-button danger-button compact-button" type="button" onClick={props.deleteChat}>
              <Trash2 size={16} />
              {props.isDeleteChatPending ? "Confirm delete chat" : "Delete chat"}
            </button>
          </div>
        </div>

        <div className="message-stream chat-transcript" role="log" aria-label="Chat transcript" ref={transcriptRef}>
          {!props.runtimeRunning ? (
            <section className="runtime-stopped" aria-label="Runtime stopped">
              <Power size={26} />
              <h3>Runtime shut down</h3>
              <p>The card and chat are saved. Start the runtime to continue.</p>
              <button className="primary-button compact-button" type="button" onClick={props.startRuntime}>
                <RotateCcw size={16} />
                Start runtime
              </button>
            </section>
          ) : null}
          {openingText && props.runtimeRunning ? (
            <article className="message response preset-opening" aria-label="Card opening">
              <header>
                <span className="message-role">
                  <Sparkles size={14} />
                  {props.activeCard.name}
                </span>
              </header>
              <MessageContent
                message={{
                  id: `opening-${props.activeCard.id}`,
                  role: "assistant",
                  content: openingText,
                }}
              />
            </article>
          ) : null}
          {props.messages.map((message) => (
            <article
              key={message.id}
              className={`message ${message.role === "assistant" ? "response" : "user"}`}
            >
              <header>
                <span className="message-role">
                  {message.role === "assistant" ? <Sparkles size={14} /> : <UserRound size={14} />}
                  {message.role === "assistant" ? props.activeCard.name : "You"}
                </span>
                {editingMessageId === message.id ? null : (
                  <span className="message-actions">
                    {message.variants && message.variants.length > 1 ? (
                      <span className="message-swipe" aria-label="Alternate replies">
                        <button
                          type="button"
                          className="message-swipe-arrow"
                          aria-label="Previous reply"
                          onClick={() => props.swipeMessageVariant(message.id, -1)}
                        >
                          <ChevronLeft size={14} />
                        </button>
                        <span className="message-swipe-count">
                          {(message.activeVariantIndex ?? message.variants.length - 1) + 1}/{message.variants.length}
                        </span>
                        <button
                          type="button"
                          className="message-swipe-arrow"
                          aria-label="Next reply"
                          onClick={() => props.swipeMessageVariant(message.id, 1)}
                        >
                          <ChevronRight size={14} />
                        </button>
                      </span>
                    ) : null}
                    {regenerableMessageId === message.id ? (
                      <button
                        type="button"
                        className="message-action"
                        aria-label="Regenerate reply"
                        onClick={() => void props.regenerateLastReply()}
                      >
                        <RefreshCw size={13} />
                        Regenerate
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="message-action"
                      aria-label="Edit message"
                      onClick={() => {
                        setEditingMessageId(message.id);
                        setEditDraft(message.content);
                      }}
                    >
                      <PenLine size={13} />
                      Edit
                    </button>
                  </span>
                )}
              </header>
              {editingMessageId === message.id ? (
                <div className="message-editor">
                  <textarea
                    aria-label="Edit message text"
                    value={editDraft}
                    onChange={(event) => setEditDraft(event.target.value)}
                    rows={4}
                  />
                  <div className="message-editor-actions">
                    <button
                      type="button"
                      className="primary-button compact-button"
                      disabled={!editDraft.trim()}
                      onClick={() => {
                        props.editMessage(message.id, editDraft);
                        setEditingMessageId(null);
                        setEditDraft("");
                      }}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="secondary-button compact-button"
                      onClick={() => {
                        setEditingMessageId(null);
                        setEditDraft("");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <MessageContent message={message} />
              )}
            </article>
          ))}
          {props.runtimeRunning && props.isGenerating && props.streamingReply.trim() ? (
            <article className="message response streaming-reply" aria-label="Streaming reply">
              <header>
                <span className="message-role">
                  <Sparkles size={14} />
                  {props.activeCard.name}
                </span>
              </header>
              <MessageContent
                message={{ id: "streaming-reply", role: "assistant", content: props.streamingReply }}
              />
            </article>
          ) : null}
        </div>
        {props.ruleWarning ? (
          <p className="rule-warning" role="status" aria-live="polite">
            {props.ruleWarning}
          </p>
        ) : null}
        <form
          className="composer chat-composer"
          aria-label="Message composer"
          onSubmit={(event) => {
            event.preventDefault();
            void props.sendMessage();
          }}
        >
          <label>
            <span>Message</span>
            <textarea
              aria-label="Message input"
              value={props.draft}
              onChange={(event) => props.setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (props.runtimeRunning && !props.isGenerating) {
                    void props.sendMessage();
                  }
                }
              }}
              disabled={!props.runtimeRunning}
              rows={4}
              placeholder="Type what you want to say or do..."
            />
          </label>
          {(() => {
            const slashMatches = matchSlashCommands(props.draft);
            if (slashMatches.length === 0) {
              return null;
            }
            return (
              <ul className="slash-command-menu" role="listbox" aria-label="Slash commands">
                {slashMatches.map((command) => (
                  <li key={command.name}>
                    <button
                      type="button"
                      className="slash-command-option"
                      onClick={() => props.setDraft(`/${command.name} `)}
                    >
                      <span className="slash-command-name">/{command.name}</span>
                      <span className="slash-command-summary">{command.summary}</span>
                    </button>
                  </li>
                ))}
              </ul>
            );
          })()}
          <div className="composer-actions">
            <button
              className="secondary-button compact-button"
              type="button"
              onClick={props.writeForMe}
              disabled={!props.runtimeRunning}
            >
              <Wand2 size={16} />
              Write for me
            </button>
            <button
              className="primary-button compact-button"
              type="submit"
              disabled={!props.runtimeRunning || props.isGenerating}
            >
              <Send size={16} />
              {props.isGenerating ? "Sending..." : "Send"}
            </button>
          </div>
        </form>
      </section>

      {showMediaPanel ? (
        <aside className="media-side-panel" aria-label="Image and story tools">
          {showMapPanel ? (
            <section
              className="media-section map-generator-section"
              id="media-panel-map"
              role="region"
              aria-label="Aerial image generator"
            >
              <div className="section-title">
                <Image size={17} />
                <h3>{mediaPrimaryLabel}</h3>
              </div>
              {hasPendingMapPromptDraft ? (
                <div className="map-output compact-map-output map-draft-output" role="region" aria-label="Aerial image prompt draft">
                  <div className="map-placeholder compact-placeholder">
                    <Image size={34} />
                    <span>
                      {props.mapArtifact
                        ? "Aerial image prompt draft ready. Select Generate aerial image to replace the current image."
                        : "Aerial image prompt draft ready. Select Generate aerial image to create the image."}
                    </span>
                  </div>
                </div>
              ) : null}
              {props.mapArtifact ? (
                <div className="map-output compact-map-output" role="region" aria-label="Generated aerial image">
                  {props.mapArtifact.imageUrl ? (
                    <div className="generated-image-frame">
                      <img className="generated-map-image" src={toGeneratedImageSrc(props.mapArtifact)} alt="Generated aerial scene" />
                      <button
                        className="icon-button image-maximize-button"
                        type="button"
                        onClick={() =>
                          props.openMediaPreview({
                            artifact: props.mapArtifact as GeneratedMapArtifact,
                            label: "Generated aerial image",
                          })
                        }
                        aria-label="Maximize aerial image"
                        title="Maximize aerial image"
                      >
                        <Maximize2 size={17} />
                      </button>
                    </div>
                  ) : (
                    <div className="map-placeholder compact-placeholder">
                      <Image size={34} />
                      <span>
                        {props.mapArtifact.status === "error"
                          ? "Aerial image generation needs attention"
                          : "Aerial image prompt ready for image provider"}
                      </span>
                    </div>
                  )}
                  <div className={`map-status ${props.mapArtifact.status}`}>
                    <strong>{props.mapArtifact.status}</strong>
                    <span>{props.mapArtifact.provider} / {props.mapArtifact.model}</span>
                  </div>
                  {props.mapArtifact.error ? <p className="rule-warning">{props.mapArtifact.error}</p> : null}
                </div>
              ) : props.mapPrompt && !hasPendingMapPromptDraft ? (
                <div className="map-output compact-map-output" role="region" aria-label="Aerial image prompt draft">
                  <div className="map-placeholder compact-placeholder">
                    <Image size={34} />
                    <span>Aerial image prompt ready to edit</span>
                  </div>
                </div>
              ) : null}
              <div className="button-row media-actions">
                <button
                  className="primary-button compact-button"
                  type="button"
                  onClick={() => void props.prepareImagePrompt()}
                  disabled={!props.runtimeRunning || isMapBusy}
                >
                  <Image size={16} />
                  {props.isDraftingMapPrompt ? "Drafting..." : promptButtonLabel}
                </button>
                <button
                  className="secondary-button compact-button"
                  type="button"
                  onClick={() => void props.generateMapImage()}
                  disabled={!props.runtimeRunning || isMapBusy || !props.imagePromptDraft.trim()}
                >
                  <Play size={16} />
                  {props.isGeneratingMapImage ? "Generating image..." : generateMapButtonLabel}
                </button>
                <button
                  className="secondary-button compact-button"
                  type="button"
                  onClick={props.resetMapPrompt}
                  disabled={!props.imagePromptDraft.trim() && !props.imageNegativePromptDraft.trim() && !props.mapPrompt}
                >
                  <RotateCcw size={16} />
                  Reset aerial prompt
                </button>
                <button
                  className="secondary-button danger-button compact-button"
                  type="button"
                  onClick={props.deleteCurrentMap}
                  disabled={!props.mapArtifact}
                >
                  <Trash2 size={16} />
                  Delete aerial image
                </button>
              </div>
              <label className="field">
                <span>Image prompt</span>
                <textarea
                  value={props.imagePromptDraft}
                  onChange={(event) => props.setImagePromptDraft(event.target.value)}
                  rows={5}
                  placeholder="Generate an overhead scene prompt from visible terrain, then edit it before sending."
                />
              </label>
              <label className="field">
                <span>Negative prompt</span>
                <textarea
                  value={props.imageNegativePromptDraft}
                  onChange={(event) => props.setImageNegativePromptDraft(event.target.value)}
                  rows={3}
                  placeholder="Things to avoid in the image"
                />
              </label>
            </section>
          ) : null}

          <StoryCharactersPanel
            entities={props.activeCard.storyEntities}
            portraits={props.characterPortraits}
            clearStoryCharacters={props.clearStoryCharacters}
            regeneratePortrait={props.regeneratePortrait}
            buildPortraitPrompt={props.buildPortraitPrompt}
            openMediaPreview={props.openMediaPreview}
          />

          <section
            className="media-section photo-generator-section"
            id="media-panel-image"
            role="region"
            aria-label="Image generator"
          >
            <div className="section-title">
              <Image size={17} />
              <h3>Image</h3>
            </div>
            <p className="field-help">
              Preset prompt: <strong>{customImagePresetPrompt}</strong>
            </p>
            <label className="field">
              <span>Image request</span>
              <textarea
                value={props.photoSpecDraft}
                onChange={(event) => props.setPhotoSpecDraft(event.target.value)}
                rows={5}
                placeholder="Vaguely describe the picture you want..."
              />
            </label>
            <div className="button-row media-actions">
              <button
                className="primary-button compact-button"
                type="button"
                onClick={() => void props.generateCustomImageFromRequest()}
                disabled={!props.photoSpecDraft.trim() || props.isGeneratingPhoto}
              >
                <Play size={16} />
                {props.isGeneratingPhoto ? "Generating..." : "Generate custom image"}
              </button>
              <button
                className="secondary-button compact-button"
                type="button"
                onClick={props.resetCustomImageRequest}
                disabled={!props.photoSpecDraft.trim() && !props.photoPrompt}
              >
                <RotateCcw size={16} />
                Reset image request
              </button>
              <button
                className="secondary-button danger-button compact-button"
                type="button"
                onClick={props.deleteCurrentPhoto}
                disabled={!props.photoArtifact}
              >
                <Trash2 size={16} />
                Delete image
              </button>
            </div>
            {props.photoPrompt ? (
              <p className="compiled-image-prompt">
                {props.photoPrompt}
              </p>
            ) : null}
            {props.photoArtifact ? (
              <div className="map-output photo-output" role="region" aria-label="Generated custom image">
                {props.photoArtifact.imageUrl ? (
                  <div className="generated-image-frame">
                    <img
                      className="generated-photo-image"
                      src={toGeneratedImageSrc(props.photoArtifact)}
                      alt="Generated custom scene"
                    />
                    <button
                      className="icon-button image-maximize-button"
                      type="button"
                      onClick={() =>
                        props.openMediaPreview({
                          artifact: props.photoArtifact as GeneratedMapArtifact,
                          label: "Generated custom image",
                        })
                      }
                      aria-label="Maximize image"
                      title="Maximize image"
                    >
                      <Maximize2 size={17} />
                    </button>
                  </div>
                ) : (
                  <div className="map-placeholder photo-placeholder">
                    <Image size={42} />
                    <span>
                      {props.photoArtifact.status === "error"
                        ? "Image generation needs attention"
                        : "Custom image prompt ready for image provider"}
                    </span>
                  </div>
                )}
                <div className={`map-status ${props.photoArtifact.status}`}>
                  <strong>{props.photoArtifact.status}</strong>
                  <span>{props.photoArtifact.provider} / {props.photoArtifact.model}</span>
                </div>
                {props.photoArtifact.error ? <p className="rule-warning">{props.photoArtifact.error}</p> : null}
              </div>
            ) : null}
          </section>
        </aside>
      ) : null}
    </div>
  );
}

function StoryCharactersPanel(props: {
  entities: StoryEntity[];
  portraits: GeneratedMapArtifact[];
  clearStoryCharacters: () => void;
  regeneratePortrait: (entity: StoryEntity, prompt: string) => void;
  buildPortraitPrompt: (entity: StoryEntity) => string;
  openMediaPreview: (preview: MediaPreviewArtifact) => void;
}) {
  const entities = orderStoryEntitiesForDisplay(props.entities);
  const [expandedEntityId, setExpandedEntityId] = useState<string | null>(null);
  const [portraitPromptDrafts, setPortraitPromptDrafts] = useState<Record<string, string>>({});
  const hasTrackedCharacters = entities.some((entity) => !isDefaultPlayerStoryEntity(entity) || hasStoryEntityDetails(entity));

  return (
    <section
      className="media-section story-characters-section"
      id="media-panel-characters"
      role="region"
      aria-label="Story characters"
    >
      <div className="section-title">
        <UserRound size={17} />
        <h3>Characters</h3>
        <button
          className="secondary-button danger-button compact-button story-clear-button"
          type="button"
          onClick={() => {
            setExpandedEntityId(null);
            props.clearStoryCharacters();
          }}
          disabled={!hasTrackedCharacters}
          aria-label="Clear tracked characters"
        >
          <Trash2 size={15} />
          Clear roster
        </button>
      </div>
      <div className="story-entity-list">
        {entities.map((entity) => {
          const portrait = findCharacterPortraitForEntity(props.portraits, "", entity);
          return (
            <div className={`story-entity-item ${entity.kind}`} key={entity.id}>
              <div className="story-entity-main">
                <CharacterPortrait
                  entity={entity}
                  portrait={portrait}
                  openMediaPreview={props.openMediaPreview}
                />
                <div className="story-entity-copy">
                  {hasStoryEntityDetails(entity) || !isDefaultPlayerStoryEntity(entity) ? (
                    <button
                      className="secondary-button compact-button story-details-button"
                      type="button"
                      onClick={() => setExpandedEntityId((current) => (current === entity.id ? null : entity.id))}
                      aria-expanded={expandedEntityId === entity.id}
                      aria-label={`${expandedEntityId === entity.id ? "Hide" : "Show"} details for ${entity.name}`}
                    >
                      <Eye size={15} />
                      {expandedEntityId === entity.id ? "Hide details" : "Show details"}
                    </button>
                  ) : null}
                </div>
              </div>
              {expandedEntityId === entity.id ? (
                <div className="story-entity-details">
                  {entity.summary ? <p>{entity.summary}</p> : null}
                  {entity.knownFacts.length > 0 ? (
                    <div className="story-knowledge-block">
                      <strong>Knows</strong>
                      <ul>
                        {entity.knownFacts.map((fact) => (
                          <li key={fact}>{fact}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {entity.doesNotKnow.length > 0 ? (
                    <div className="story-knowledge-block">
                      <strong>Does not know</strong>
                      <ul>
                        {entity.doesNotKnow.map((fact) => (
                          <li key={fact}>{fact}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <label className="field">
                    <span>Portrait prompt</span>
                    <textarea
                      aria-label={`Portrait prompt for ${entity.name}`}
                      rows={3}
                      value={portraitPromptDrafts[entity.id] ?? portrait?.prompt ?? props.buildPortraitPrompt(entity)}
                      onChange={(event) =>
                        setPortraitPromptDrafts((current) => ({ ...current, [entity.id]: event.target.value }))
                      }
                    />
                  </label>
                  <button
                    className="secondary-button compact-button"
                    type="button"
                    onClick={() =>
                      props.regeneratePortrait(
                        entity,
                        portraitPromptDrafts[entity.id] ?? portrait?.prompt ?? props.buildPortraitPrompt(entity),
                      )
                    }
                  >
                    <RotateCcw size={15} />
                    Regenerate portrait
                  </button>
                  {portrait?.status === "error" && portrait.error ? (
                    <p className="field-help">{portrait.error}</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CharacterPortrait(props: {
  entity: StoryEntity;
  portrait: GeneratedMapArtifact | null;
  openMediaPreview: (preview: MediaPreviewArtifact) => void;
}) {
  const label = `Character portrait for ${props.entity.name}`;
  const statusLabel = props.portrait
    ? props.portrait.status === "generated"
      ? "Portrait generated"
      : props.portrait.status === "error"
        ? "Portrait needs attention"
        : "Portrait prompt ready"
    : "Portrait pending";

  return (
    <div className="story-portrait" aria-label={label}>
      {props.portrait?.imageUrl ? (
        <div className="story-portrait-image-frame">
          <img
            className="story-portrait-image"
            src={toGeneratedImageSrc(props.portrait)}
            alt={`${props.entity.name} portrait`}
          />
          <button
            className="icon-button image-maximize-button story-portrait-maximize"
            type="button"
            onClick={() =>
              props.openMediaPreview({
                artifact: props.portrait as GeneratedMapArtifact,
                label: `${props.entity.name} portrait`,
              })
            }
            aria-label={`Maximize portrait for ${props.entity.name}`}
            title={`Maximize portrait for ${props.entity.name}`}
          >
            <Maximize2 size={15} />
          </button>
        </div>
      ) : (
        <div className="story-portrait-placeholder">
          <UserRound size={24} />
        </div>
      )}
      <span className={`story-portrait-status ${props.portrait?.status ?? "pending"}`}>
        {statusLabel}
      </span>
      {props.portrait?.error ? <span className="story-portrait-error">{props.portrait.error}</span> : null}
    </div>
  );
}


function MediaPreviewDialog(props: { preview: MediaPreviewArtifact; close: () => void }) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        props.close();
      }
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [props]);

  const previewName = `${props.preview.label} preview`;

  return (
    <div className="media-preview-backdrop" role="presentation" onMouseDown={props.close}>
      <section
        className="media-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={previewName}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="media-preview-header">
          <div>
            <p className="eyebrow">Preview</p>
            <h3>{props.preview.label}</h3>
          </div>
          <button className="icon-button" type="button" onClick={props.close} aria-label="Close media preview">
            <X size={18} />
          </button>
        </div>
        <div className="media-preview-image-wrap">
          <img
            className="media-preview-image"
            src={toGeneratedImageSrc(props.preview.artifact)}
            alt={previewName}
          />
        </div>
        <div className={`map-status ${props.preview.artifact.status}`}>
          <strong>{props.preview.artifact.status}</strong>
          <span>{props.preview.artifact.provider} / {props.preview.artifact.model}</span>
        </div>
      </section>
    </div>
  );
}

function MessageContent(props: { message: Message }) {
  if (props.message.role !== "assistant") {
    return <p className="message-paragraph">{props.message.content}</p>;
  }

  const display = parseAssistantMessageDisplay(props.message.content);

  return (
    <div className="message-content">
      <div className="message-prose">
        {display.paragraphs.map((paragraph, index) => (
          <p className="message-paragraph" key={`${paragraph}-${index}`}>
            {renderNarrativeMarkup(paragraph)}
          </p>
        ))}
      </div>
      {display.statusItems.length > 0 ? (
        <dl className="message-status-footer" aria-label="Scene status">
          {display.statusItems.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

export function getCardOpeningText(card: RuntimeCard): string {
  const greeting = card.greeting.trim();
  if (greeting) {
    return greeting;
  }

  const scenario = card.scenario.trim();
  if (scenario) {
    return scenario;
  }

  if (card.kind === "rpg") {
    return "Describe your character, their surroundings, and what they are doing. Or leave the message blank and press Send for a random opening.";
  }

  return card.summary.trim() || `${card.name} is ready.`;
}

function NoActiveCardRuntimePanel(props: { openCards: () => void }) {
  return (
    <section className="panel empty-chat no-active-card-panel" aria-label="No active card">
      <BookOpen size={30} />
      <h3>No card is open</h3>
      <p>Saved cards stay in the library until you open one for runtime chat.</p>
      <button className="primary-button compact-button" type="button" onClick={props.openCards}>
        <BookOpen size={16} />
        Open card library
      </button>
    </section>
  );
}

function RpgStatePanel(props: {
  rpg: RpgCardState;
  updateRpgState: (patch: Partial<RpgCardState>) => void;
}) {
  return (
    <section className="tab-panel" aria-label="RPG state">
      <div className="section-title">
        <Sparkles size={17} />
        <h3>RPG State</h3>
      </div>
      <dl className="compact-dl">
        <div>
          <dt>Location</dt>
          <dd>{props.rpg.location}</dd>
        </div>
        <div>
          <dt>Health</dt>
          <dd>{props.rpg.health}</dd>
        </div>
        <div>
          <dt>Inventory</dt>
          <dd>{props.rpg.inventory.join(", ") || "none"}</dd>
        </div>
      </dl>
      <div className="rpg-editor-grid">
        <label className="field">
          <span>Location</span>
          <input
            value={props.rpg.location}
            onChange={(event) => props.updateRpgState({ location: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Health or status</span>
          <input
            value={props.rpg.health}
            onChange={(event) => props.updateRpgState({ health: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Inventory</span>
          <textarea
            value={props.rpg.inventory.join("\n")}
            onChange={(event) => props.updateRpgState({ inventory: parseList(event.target.value) })}
            rows={4}
          />
        </label>
        <label className="field">
          <span>Quests</span>
          <textarea
            value={props.rpg.quests.join("\n")}
            onChange={(event) => props.updateRpgState({ quests: parseList(event.target.value) })}
            rows={4}
          />
        </label>
        <label className="field">
          <span>Known places</span>
          <textarea
            value={props.rpg.knownPlaces.join("\n")}
            onChange={(event) => props.updateRpgState({ knownPlaces: parseList(event.target.value) })}
            rows={4}
          />
        </label>
        <label className="field">
          <span>World flags</span>
          <textarea
            value={formatFlagsForInput(props.rpg.flags)}
            onChange={(event) => props.updateRpgState({ flags: parseFlags(event.target.value) })}
            rows={4}
            placeholder="gate_open=true"
          />
        </label>
      </div>
      <div className="pill-list">
        {props.rpg.quests.length === 0 ? <span>No quests configured</span> : null}
        {props.rpg.quests.map((quest) => (
          <span key={quest}>{quest}</span>
        ))}
      </div>
      <div className="flag-grid">
        {Object.keys(props.rpg.flags).length === 0 ? <span>No flags configured</span> : null}
        {Object.entries(props.rpg.flags).map(([flag, enabled]) => (
          <span className={enabled ? "flag-on" : "flag-off"} key={flag}>
            <CheckCircle2 size={14} />
            {flag}
          </span>
        ))}
      </div>
    </section>
  );
}

function formatTabLabel(tab: CardTab): string {
  if (tab === "rpg") {
    return "RPG";
  }

  return tab[0].toUpperCase() + tab.slice(1);
}

export function renderTabIcon(tab: CardTab) {
  switch (tab) {
    case "chat":
      return <MessageSquare size={15} />;
    case "instructions":
      return <BookOpen size={15} />;
    case "rules":
      return <ClipboardList size={15} />;
    case "lorebooks":
      return <Layers3 size={15} />;
    case "rpg":
      return <Sparkles size={15} />;
    case "map":
      return <Map size={15} />;
  }
}

function InstructionsPanel(props: {
  activeCard: RuntimeCard;
  updateActiveCard: (patch: Partial<RuntimeCard>) => void;
}) {
  return (
    <section className="tab-panel" aria-label="Card instructions">
      <div className="section-title">
        <BookOpen size={17} />
        <h3>Card Instructions</h3>
      </div>
      <div className="instruction-grid">
        <label className="field">
          <span>Name</span>
          <input
            value={props.activeCard.name}
            onChange={(event) => props.updateActiveCard({ name: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Summary</span>
          <input
            value={props.activeCard.summary}
            onChange={(event) => props.updateActiveCard({ summary: event.target.value })}
          />
        </label>
      </div>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={props.activeCard.mapEnabled}
          onChange={(event) => props.updateActiveCard({ mapEnabled: event.target.checked })}
        />
        <span>Show map/image panel in runtime</span>
      </label>
      <div className="instruction-grid">
        <label className="field">
          <span>Character name</span>
          <input
            value={props.activeCard.characterName}
            onChange={(event) => props.updateActiveCard({ characterName: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Greeting</span>
          <textarea
            value={props.activeCard.greeting}
            onChange={(event) => props.updateActiveCard({ greeting: event.target.value })}
            rows={3}
          />
        </label>
      </div>
      <label className="field">
        <span>Description</span>
        <textarea
          value={props.activeCard.characterDescription}
          onChange={(event) => props.updateActiveCard({ characterDescription: event.target.value })}
          rows={4}
        />
      </label>
      <label className="field">
        <span>Scenario</span>
        <textarea
          value={props.activeCard.scenario}
          onChange={(event) => props.updateActiveCard({ scenario: event.target.value })}
          rows={4}
        />
      </label>
      <label className="field">
        <span>Example dialogs</span>
        <textarea
          value={props.activeCard.exampleDialogs}
          onChange={(event) => props.updateActiveCard({ exampleDialogs: event.target.value })}
          rows={6}
        />
      </label>
      <label className="field">
        <span>In-depth character definition / system prompt</span>
        <textarea
          value={props.activeCard.systemPrompt}
          onChange={(event) => props.updateActiveCard({ systemPrompt: event.target.value })}
          rows={5}
        />
      </label>
      <div className="instruction-grid">
        <label className="field">
          <span>Pre-history instructions</span>
          <textarea
            value={props.activeCard.preHistoryInstructions}
            onChange={(event) => props.updateActiveCard({ preHistoryInstructions: event.target.value })}
            rows={6}
          />
        </label>
        <label className="field">
          <span>Post-history instructions</span>
          <textarea
            value={props.activeCard.postHistoryInstructions}
            onChange={(event) => props.updateActiveCard({ postHistoryInstructions: event.target.value })}
            rows={6}
          />
        </label>
      </div>
    </section>
  );
}

function RulesPanel(props: {
  activeCard: RuntimeCard;
  compiledPrompt: string;
  compiledPromptResult: CompiledPrompt;
  updateActiveCard: (patch: Partial<RuntimeCard>) => void;
}) {
  const [newRule, setNewRule] = useState<NewPlayerRule>(defaultNewPlayerRule);
  const enabledRuleCount = getEnabledPlayerRules(props.activeCard).length;

  function updateRule(ruleId: string, patch: Partial<PlayerRule>) {
    props.updateActiveCard({
      playerRules: props.activeCard.playerRules.map((rule) =>
        rule.id === ruleId ? { ...rule, ...patch } : rule,
      ),
    });
  }

  function addRule() {
    const title = newRule.title.trim();
    const description = newRule.description.trim();
    if (!title && !description) {
      return;
    }

    props.updateActiveCard({
      playerRules: [
        ...props.activeCard.playerRules,
        createCustomPlayerRule(description || title, title || "Custom player rule"),
      ],
    });
    setNewRule(defaultNewPlayerRule);
  }

  return (
    <section className="tab-panel" aria-label="Card rules">
      <div className="section-title">
        <ClipboardList size={17} />
        <h3>Rules for this card only</h3>
      </div>
      <div className="rule-summary">
        <strong>{enabledRuleCount}</strong>
        <span>enabled player rules</span>
      </div>
      <div className="rule-editor-list">
        {props.activeCard.playerRules.map((rule) => (
          <article className={`rule-editor ${rule.enabled ? "enabled" : "disabled"}`} key={rule.id}>
            <label className="toggle-row rule-toggle">
              <input
                type="checkbox"
                checked={rule.enabled}
                onChange={(event) => updateRule(rule.id, { enabled: event.target.checked })}
              />
              <span>{rule.enabled ? `${rule.title} enabled` : `${rule.title} disabled`}</span>
            </label>
            <label className="field">
              <span>Player rule title</span>
              <input
                value={rule.title}
                onChange={(event) => updateRule(rule.id, { title: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Card enforcement text</span>
              <textarea
                value={rule.description}
                onChange={(event) => updateRule(rule.id, { description: event.target.value })}
                rows={3}
              />
            </label>
            <span className="enforcement-chip">{formatEnforcementLabel(rule.enforcement)}</span>
          </article>
        ))}
      </div>
      <div className="rule-add-panel">
        <div className="section-title">
          <Plus size={17} />
          <h3>Add Player Rule</h3>
        </div>
        <label className="field">
          <span>Rule title</span>
          <input
            value={newRule.title}
            onChange={(event) => setNewRule({ ...newRule, title: event.target.value })}
            placeholder="No metagame shortcuts"
          />
        </label>
        <label className="field">
          <span>Card enforcement text</span>
          <textarea
            value={newRule.description}
            onChange={(event) => setNewRule({ ...newRule, description: event.target.value })}
            rows={3}
            placeholder="The player cannot use knowledge or actions their character could not plausibly access."
          />
        </label>
        <button className="secondary-button compact-button" type="button" onClick={addRule}>
          <Plus size={16} />
          Add player rule
        </button>
      </div>
      <div className="prompt-debugger" aria-label="Prompt debugger">
        <div className="section-title">
          <Layers3 size={17} />
          <h3>Prompt Debugger</h3>
        </div>
        <div className="prompt-layer-audit" aria-label="Prompt layer audit">
          <span>{props.compiledPromptResult.includedLayers.length} layers included</span>
          <span>{props.compiledPromptResult.omittedLayers.length} omitted</span>
          <span>{props.compiledPromptResult.tokenEstimate} estimated tokens</span>
        </div>
        <pre>{props.compiledPrompt}</pre>
      </div>
    </section>
  );
}

function LorebooksPanel(props: {
  activeCard: RuntimeCard;
  activeLorebookEntries: LorebookEntry[];
  updateActiveLorebook: (lorebookId: string, patch: Partial<Omit<Lorebook, "id" | "entries">>) => void;
  addLorebookEntry: (lorebookId: string, entry: NewLorebookEntry) => boolean;
  lorebookEntryError: string | null;
}) {
  const [entryDraft, setEntryDraft] = useState<NewLorebookEntry>(defaultNewLorebookEntry);
  const [lorebookSearch, setLorebookSearch] = useState("");
  const [lorebookSource, setLorebookSource] = useState("current-card");
  const [selectedLorebookId, setSelectedLorebookId] = useState("");
  const lorebooks = props.activeCard.lorebooks;
  const selectedLorebook = lorebooks.find((lorebook) => lorebook.id === selectedLorebookId) ?? lorebooks[0] ?? null;
  const filteredEntries = selectedLorebook ? filterLorebookEntries(selectedLorebook.entries, lorebookSearch) : [];

  useEffect(() => {
    if (!selectedLorebookId && lorebooks[0]) {
      setSelectedLorebookId(lorebooks[0].id);
      return;
    }
    if (selectedLorebookId && !lorebooks.some((lorebook) => lorebook.id === selectedLorebookId)) {
      setSelectedLorebookId(lorebooks[0]?.id ?? "");
    }
  }, [lorebooks, selectedLorebookId]);

  function submitEntry() {
    if (props.addLorebookEntry(selectedLorebook?.id ?? "", entryDraft)) {
      setEntryDraft(defaultNewLorebookEntry);
    }
  }

  return (
    <section className="tab-panel" aria-label="Lorebooks">
      <div className="section-title">
        <BookOpen size={17} />
        <h3>Lorebooks</h3>
      </div>

      <div className="lorebook-settings">
        <label className="field">
          <span>Lorebook</span>
          <select
            value={selectedLorebook?.id ?? ""}
            onChange={(event) => setSelectedLorebookId(event.target.value)}
          >
            {lorebooks.length === 0 ? <option value="">No Chub lorebook uploaded</option> : null}
            {lorebooks.map((lorebook) => (
              <option key={lorebook.id} value={lorebook.id}>
                {lorebook.name}
              </option>
            ))}
          </select>
        </label>
        {selectedLorebook ? (
          <>
            <label className="field">
              <span>Lorebook name</span>
              <input
                value={selectedLorebook.name}
                onChange={(event) => props.updateActiveLorebook(selectedLorebook.id, { name: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Scan depth</span>
              <input
                type="number"
                min={1}
                max={30}
                value={selectedLorebook.scanDepth}
                onChange={(event) =>
                  props.updateActiveLorebook(selectedLorebook.id, {
                    scanDepth: toBoundedNumber(event.target.value, 4, 1, 30),
                  })
                }
              />
            </label>
            <label className="field">
              <span>Token budget</span>
              <input
                type="number"
                min={100}
                max={12000}
                value={selectedLorebook.tokenBudget}
                onChange={(event) =>
                  props.updateActiveLorebook(selectedLorebook.id, {
                    tokenBudget: toBoundedNumber(event.target.value, 800, 100, 12_000),
                  })
                }
              />
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={selectedLorebook.enabled}
                onChange={(event) => props.updateActiveLorebook(selectedLorebook.id, { enabled: event.target.checked })}
              />
              <span>Enabled</span>
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={selectedLorebook.recursiveScanning}
                onChange={(event) =>
                  props.updateActiveLorebook(selectedLorebook.id, { recursiveScanning: event.target.checked })
                }
              />
              <span>Recursive scanning</span>
            </label>
          </>
        ) : null}
      </div>

      <div className="lorebook-toolbar" aria-label="Lorebook search and export">
        <label className="field">
          <span>Search lorebook entries</span>
          <div className="search-input">
            <Search size={16} />
            <input
              value={lorebookSearch}
              onChange={(event) => setLorebookSearch(event.target.value)}
              placeholder="Filter by title, key, or content"
              type="search"
            />
          </div>
        </label>
        <label className="field">
          <span>Lorebook source</span>
          <select value={lorebookSource} onChange={(event) => setLorebookSource(event.target.value)}>
            <option value="current-card">Current card lorebook</option>
            <option value="chub-compatible">Chub-compatible export</option>
          </select>
        </label>
        <button
          className="secondary-button export-button"
          type="button"
          onClick={() => selectedLorebook ? exportLorebookAsChubJson(selectedLorebook, props.activeCard) : undefined}
          disabled={!selectedLorebook}
        >
          <Download size={16} />
          Export Chub JSON
        </button>
      </div>

      <div className="lorebook-active" aria-label="Active lorebook entries">
        <strong>{props.activeLorebookEntries.length}</strong>
        <span>active entries for the current draft/history</span>
      </div>

      <div className="lorebook-entry-form">
        <div className="section-title">
          <Plus size={17} />
          <h3>Add Lorebook Entry</h3>
        </div>
        <label className="field">
          <span>Entry title</span>
          <input
            value={entryDraft.title}
            onChange={(event) => setEntryDraft({ ...entryDraft, title: event.target.value })}
          />
        </label>
        <div className="instruction-grid">
          <label className="field">
            <span>Primary keys</span>
            <input
              value={entryDraft.keys}
              onChange={(event) => setEntryDraft({ ...entryDraft, keys: event.target.value })}
              placeholder="comma or newline separated"
            />
          </label>
          <label className="field">
            <span>Secondary keys</span>
            <input
              value={entryDraft.secondaryKeys}
              onChange={(event) => setEntryDraft({ ...entryDraft, secondaryKeys: event.target.value })}
              placeholder="optional selective trigger"
            />
          </label>
        </div>
        <div className="instruction-grid compact-fields">
          <label className="field">
            <span>Insertion order</span>
            <input
              type="number"
              value={entryDraft.insertionOrder}
              onChange={(event) => setEntryDraft({ ...entryDraft, insertionOrder: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Priority</span>
            <input
              type="number"
              value={entryDraft.priority}
              onChange={(event) => setEntryDraft({ ...entryDraft, priority: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Probability</span>
            <input
              type="number"
              min={0}
              max={100}
              value={entryDraft.probability}
              onChange={(event) => setEntryDraft({ ...entryDraft, probability: event.target.value })}
            />
          </label>
        </div>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={entryDraft.constant}
            onChange={(event) => setEntryDraft({ ...entryDraft, constant: event.target.checked })}
          />
          <span>Constant entry</span>
        </label>
        <label className="field">
          <span>Entry content</span>
          <textarea
            value={entryDraft.content}
            onChange={(event) => setEntryDraft({ ...entryDraft, content: event.target.value })}
            rows={5}
          />
        </label>
        {props.lorebookEntryError ? (
          <p className="rule-warning" role="alert">
            {props.lorebookEntryError}
          </p>
        ) : null}
        <button className="primary-button compact-button" type="button" onClick={submitEntry}>
          <Plus size={16} />
          Add lorebook entry
        </button>
      </div>

      <div className="lorebook-entry-list">
        {!selectedLorebook ? <p>No Chub lorebook uploaded.</p> : null}
        {selectedLorebook && selectedLorebook.entries.length === 0 ? <p>No lorebook entries yet.</p> : null}
        {selectedLorebook && selectedLorebook.entries.length > 0 && filteredEntries.length === 0 ? <p>No lorebook entries match this search.</p> : null}
        {filteredEntries.map((entry) => (
          <article className="lorebook-entry" key={entry.id}>
            <header>
              <strong>{entry.title}</strong>
              <span>{entry.constant ? "constant" : entry.keys.join(", ") || "manual"}</span>
            </header>
            <p>{entry.content}</p>
            <div className="lorebook-meta">
              <span>order {entry.insertionOrder}</span>
              <span>priority {entry.priority}</span>
              <span>{entry.probability}%</span>
              {props.activeLorebookEntries.some((activeEntry) => activeEntry.id === entry.id) ? (
                <span className="flag-on">
                  <CheckCircle2 size={14} />
                  active
                </span>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function GlobalLorebooksSection(props: {
  cards: RuntimeCard[];
  activeCardId: string;
  selectCard: (card: RuntimeCard) => void;
  updateLorebook: (cardId: string, lorebookId: string, lorebook: Lorebook) => void;
  importLorebookToActiveCard: (lorebook: Lorebook) => void;
}) {
  const [query, setQuery] = useState("");
  const [importDraft, setImportDraft] = useState("");
  const [importStatus, setImportStatus] = useState("Paste a Chub-compatible lorebook JSON export to import it.");
  const activeCard = props.cards.find((card) => card.id === props.activeCardId) ?? null;
  const allLorebooks = props.cards.flatMap((card) =>
    card.lorebooks.map((lorebook) => ({
      card,
      lorebook,
    })),
  );
  const normalizedQuery = query.trim().toLowerCase();
  const filteredLorebooks = normalizedQuery
    ? allLorebooks.filter(({ card, lorebook }) =>
        [
          card.name,
          lorebook.name,
          lorebook.entries.map((entry) => `${entry.title} ${entry.keys.join(" ")} ${entry.content}`).join(" "),
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery),
      )
    : allLorebooks;
  const totalEntries = allLorebooks.reduce((total, item) => total + item.lorebook.entries.length, 0);

  function importChubJson() {
    if (!activeCard) {
      setImportStatus("Open a card before importing lorebooks.");
      return;
    }
    try {
      const lorebook = parseChubLorebookPayload(importDraft);
      props.importLorebookToActiveCard(lorebook);
      setImportDraft("");
      setImportStatus(`Imported ${lorebook.name} into ${activeCard.name}.`);
    } catch (error) {
      setImportStatus(getErrorMessage(error));
    }
  }

  async function importChubFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    try {
      const text = await readFileAsText(file);
      setImportDraft(text);
      setImportStatus(`Loaded ${file.name}.`);
    } catch (error) {
      setImportStatus(getErrorMessage(error));
    } finally {
      input.value = "";
    }
  }

  return (
    <div className="workspace-grid lorebook-grid">
      <section className="panel lorebook-library-panel" aria-label="Stored lorebooks">
        <div className="section-title">
          <Layers3 size={17} />
          <h3>Lorebook Library</h3>
        </div>
        <div className="card-library-stats" aria-label="Lorebook stats">
          <span>
            <strong>{allLorebooks.length}</strong>
            lorebooks
          </span>
          <span>
            <strong>{totalEntries}</strong>
            entries
          </span>
          <span>
            <strong>{props.cards.length}</strong>
            cards
          </span>
        </div>
        <label className="field">
          <span>Search stored lorebooks</span>
          <div className="search-input">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find by card, title, key, or content"
              type="search"
            />
          </div>
        </label>
        <div className="lorebook-entry-list">
          {filteredLorebooks.length === 0 ? (
            <p>
              {query.trim()
                ? "No stored lorebooks match this search."
                : "No lorebooks stored yet. Open a card and add lorebook entries to build its world."}
            </p>
          ) : null}
          {filteredLorebooks.map(({ card, lorebook }) => (
            <article className="lorebook-entry" key={`${card.id}:${lorebook.id}`}>
              <header>
                <strong>{lorebook.name}</strong>
                <span>{card.name}</span>
              </header>
              <div className="lorebook-meta">
                <span>{lorebook.entries.length} entries</span>
                <span>scan depth {lorebook.scanDepth}</span>
                <span>{lorebook.enabled ? "enabled" : "disabled"}</span>
                {lorebook.recursiveScanning ? <span>recursive</span> : null}
              </div>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={lorebook.enabled}
                  onChange={(event) =>
                    props.updateLorebook(card.id, lorebook.id, {
                      ...lorebook,
                      enabled: event.target.checked,
                    })
                  }
                />
                <span>Enabled for {card.name}</span>
              </label>
              <div className="lorebook-entry-preview">
                {lorebook.entries.slice(0, 4).map((entry) => (
                  <span key={entry.id}>{entry.title || entry.keys.join(", ") || "Untitled"}</span>
                ))}
                {lorebook.entries.length > 4 ? <span>+{lorebook.entries.length - 4} more</span> : null}
                {lorebook.entries.length === 0 ? <span>No entries yet</span> : null}
              </div>
              <div className="button-row">
                <button className="secondary-button compact-button" type="button" onClick={() => props.selectCard(card)}>
                  <BookOpen size={16} />
                  Open card
                </button>
                <button
                  className="secondary-button compact-button"
                  type="button"
                  onClick={() => exportLorebookAsChubJson(lorebook, card)}
                >
                  <Download size={16} />
                  Export Chub JSON
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel lorebook-import-panel" aria-label="Import Chub lorebook">
        <div className="section-title">
          <Upload size={17} />
          <h3>Import From Chub</h3>
        </div>
        <p>
          {activeCard
            ? (
                <>
                  Imported lorebooks are stored on the active card: <strong>{activeCard.name}</strong>.
                </>
              )
            : "Open a card from the library before importing a lorebook."}
        </p>
        <label className="field">
          <span>Upload Chub lorebook file</span>
          <input type="file" accept=".json,application/json" onChange={(event) => void importChubFile(event)} />
        </label>
        <label className="field">
          <span>Chub lorebook JSON</span>
          <textarea
            value={importDraft}
            onChange={(event) => setImportDraft(event.target.value)}
            rows={14}
            placeholder='{"name":"World Lore","entries":[{"keys":["gate"],"content":"The old gate remembers every oath."}]}'
          />
        </label>
        <button className="primary-button full-width" type="button" onClick={importChubJson} disabled={!activeCard}>
          <Upload size={16} />
          Import to active card
        </button>
        <p className="status-line">{importStatus}</p>
      </section>
    </div>
  );
}

function CardsSection(props: {
  cards: RuntimeCard[];
  activeCard: RuntimeCard | null;
  activeCardId: string;
  selectCard: (card: RuntimeCard) => void;
  editCard: (card: RuntimeCard) => void;
  deleteCard: (cardId: string) => void;
  pendingDeleteCardId: string | null;
  newCard: typeof defaultNewCard;
  setNewCard: (card: typeof defaultNewCard) => void;
  newCardError: string | null;
  createCard: () => boolean;
  cardTab: CardTab;
  setCardTab: (tab: CardTab) => void;
  compiledPrompt: string;
  compiledPromptResult: CompiledPrompt;
  activeLorebookEntries: LorebookEntry[];
  updateActiveCard: (patch: Partial<RuntimeCard>) => void;
  updateRpgState: (patch: Partial<RpgCardState>) => void;
  updateActiveLorebook: (lorebookId: string, patch: Partial<Omit<Lorebook, "id" | "entries">>) => void;
  addLorebookEntry: (lorebookId: string, entry: NewLorebookEntry) => boolean;
  lorebookEntryError: string | null;
}) {
  const [isCreatingCard, setIsCreatingCard] = useState(false);
  const totalRules = props.cards.reduce((total, card) => total + card.playerRules.length, 0);
  const totalLoreEntries = props.cards.reduce(
    (total, card) => total + card.lorebooks.reduce((entryTotal, lorebook) => entryTotal + lorebook.entries.length, 0),
    0,
  );

  function submitCreateCard() {
    if (props.createCard()) {
      setIsCreatingCard(false);
    }
  }

  return (
    <div className="workspace-grid cards-grid">
      <section className="panel card-library-panel" aria-label="Card library">
        <div className="section-title">
          <BookOpen size={17} />
          <h3>Card Library</h3>
        </div>
        <div className="card-library-hero" aria-label="Card library profile">
          <span className="brand-mark brand-mark-large" aria-hidden="true" />
          <div>
            <strong>Local-first runtime</strong>
            <span>Cards, rules, memory, lorebooks, and maps stay scoped to the active card.</span>
          </div>
        </div>
        <div className="card-library-stats" aria-label="Card library stats">
          <span>
            <strong>{props.cards.length}</strong>
            cards
          </span>
          <span>
            <strong>{totalRules}</strong>
            rules
          </span>
          <span>
            <strong>{totalLoreEntries}</strong>
            lore entries
          </span>
        </div>
        <div className="card-list compact-card-list">
          {props.cards.map((card) => (
            <article
              key={card.id}
              className={`card-row compact-card-row ${props.activeCardId === card.id ? "selected" : ""}`}
            >
              <header className="card-row-header">
                <strong>{card.name}</strong>
                <span className={`kind-pill ${card.kind}`}>{card.kind}</span>
              </header>
              <p>{card.summary}</p>
              <small>
                {getEnabledPlayerRules(card).length}/{card.playerRules.length} rules / {card.lorebooks.reduce((total, lorebook) => total + lorebook.entries.length, 0)} lore entries
              </small>
              <div className="button-row">
                <button className="secondary-button compact-button" type="button" onClick={() => props.selectCard(card)}>
                  <BookOpen size={16} />
                  Open
                </button>
                <button className="secondary-button compact-button" type="button" onClick={() => props.editCard(card)}>
                  <Settings2 size={16} />
                  Edit
                </button>
                <button
                  className="secondary-button danger-button compact-button"
                  type="button"
                  onClick={() => props.deleteCard(card.id)}
                  disabled={props.cards.length <= 1}
                >
                  <Trash2 size={16} />
                  {props.pendingDeleteCardId === card.id ? `Confirm delete ${card.name}` : "Delete"}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel create-card-panel" aria-label="Create card">
        <div className="section-title">
          <Plus size={17} />
          <h3>Create Card</h3>
        </div>
        {!isCreatingCard ? (
          <button className="primary-button full-width" type="button" onClick={() => setIsCreatingCard(true)}>
            <Plus size={16} />
            Start creating card
          </button>
        ) : (
          <>
        <label className="field">
          <span>Name</span>
          <input
            value={props.newCard.name}
            onChange={(event) => props.setNewCard({ ...props.newCard, name: event.target.value })}
            placeholder="New card name"
          />
        </label>
        {props.newCardError ? (
          <p className="rule-warning" role="alert">
            {props.newCardError}
          </p>
        ) : null}
        <label className="field">
          <span>Card type</span>
          <select
            value={props.newCard.kind}
            onChange={(event) =>
              props.setNewCard({
                ...props.newCard,
                kind: event.target.value as CardKind,
                mapEnabled: event.target.value === "rpg" ? true : props.newCard.mapEnabled,
              })
            }
          >
            <option value="character">Character</option>
            <option value="rpg">RPG</option>
          </select>
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={props.newCard.mapEnabled}
            onChange={(event) => props.setNewCard({ ...props.newCard, mapEnabled: event.target.checked })}
          />
          <span>Enable map/image panel for this card</span>
        </label>
        <label className="field">
          <span>Summary</span>
          <input
            value={props.newCard.summary}
            onChange={(event) => props.setNewCard({ ...props.newCard, summary: event.target.value })}
            placeholder="What this card is for"
          />
        </label>
        <label className="field">
          <span>Character name</span>
          <input
            value={props.newCard.characterName}
            onChange={(event) => props.setNewCard({ ...props.newCard, characterName: event.target.value })}
            placeholder="Name used inside the card"
          />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea
            value={props.newCard.characterDescription}
            onChange={(event) => props.setNewCard({ ...props.newCard, characterDescription: event.target.value })}
            rows={4}
          />
        </label>
        <label className="field">
          <span>Scenario</span>
          <textarea
            value={props.newCard.scenario}
            onChange={(event) => props.setNewCard({ ...props.newCard, scenario: event.target.value })}
            rows={4}
          />
        </label>
        <label className="field">
          <span>Greeting</span>
          <textarea
            value={props.newCard.greeting}
            onChange={(event) => props.setNewCard({ ...props.newCard, greeting: event.target.value })}
            rows={3}
          />
        </label>
        <label className="field">
          <span>Example dialogs</span>
          <textarea
            value={props.newCard.exampleDialogs}
            onChange={(event) => props.setNewCard({ ...props.newCard, exampleDialogs: event.target.value })}
            rows={5}
          />
        </label>
        <label className="field">
          <span>In-depth character definition / system prompt</span>
          <textarea
            value={props.newCard.systemPrompt}
            onChange={(event) => props.setNewCard({ ...props.newCard, systemPrompt: event.target.value })}
            rows={4}
          />
        </label>
        <label className="field">
          <span>Pre-history instructions</span>
          <textarea
            value={props.newCard.preHistoryInstructions}
            onChange={(event) =>
              props.setNewCard({ ...props.newCard, preHistoryInstructions: event.target.value })
            }
            rows={4}
          />
        </label>
        <label className="field">
          <span>Post-history instructions</span>
          <textarea
            value={props.newCard.postHistoryInstructions}
            onChange={(event) =>
              props.setNewCard({ ...props.newCard, postHistoryInstructions: event.target.value })
            }
            rows={4}
          />
        </label>
        <label className="field">
          <span>Additional player rules, one per line</span>
          <textarea
            value={props.newCard.playerRules}
            onChange={(event) => props.setNewCard({ ...props.newCard, playerRules: event.target.value })}
            rows={5}
          />
        </label>
        <label className="field">
          <span>Lorebook name</span>
          <input
            value={props.newCard.lorebookName}
            onChange={(event) => props.setNewCard({ ...props.newCard, lorebookName: event.target.value })}
          />
        </label>
        <button className="primary-button full-width" type="button" onClick={submitCreateCard}>
          <Plus size={16} />
          Create card
        </button>
          </>
        )}
      </section>

      {props.activeCard ? (
        <SelectedCardEditorPanel
          activeCard={props.activeCard}
          cardTab={props.cardTab}
          setCardTab={props.setCardTab}
          compiledPrompt={props.compiledPrompt}
          compiledPromptResult={props.compiledPromptResult}
          activeLorebookEntries={props.activeLorebookEntries}
          updateActiveCard={props.updateActiveCard}
          updateRpgState={props.updateRpgState}
          updateActiveLorebook={props.updateActiveLorebook}
          addLorebookEntry={props.addLorebookEntry}
          lorebookEntryError={props.lorebookEntryError}
        />
      ) : null}
    </div>
  );
}

function SelectedCardEditorPanel(props: {
  activeCard: RuntimeCard;
  cardTab: CardTab;
  setCardTab: (tab: CardTab) => void;
  compiledPrompt: string;
  compiledPromptResult: CompiledPrompt;
  activeLorebookEntries: LorebookEntry[];
  updateActiveCard: (patch: Partial<RuntimeCard>) => void;
  updateRpgState: (patch: Partial<RpgCardState>) => void;
  updateActiveLorebook: (lorebookId: string, patch: Partial<Omit<Lorebook, "id" | "entries">>) => void;
  addLorebookEntry: (lorebookId: string, entry: NewLorebookEntry) => boolean;
  lorebookEntryError: string | null;
}) {
  const editorTab = props.cardTab === "chat" || props.cardTab === "map" ? "instructions" : props.cardTab;
  const tabs: CardTab[] =
    props.activeCard.kind === "rpg" ? ["instructions", "rules", "lorebooks", "rpg"] : ["instructions", "rules", "lorebooks"];

  return (
    <section className="panel selected-card-panel" aria-label="Selected card editor">
      <div className="section-title">
        <Settings2 size={17} />
        <h3>Edit Selected Card</h3>
      </div>
      <div className="tab-strip" role="tablist" aria-label="Card editor tabs">
        {tabs.map((tab) => (
          <button
            key={tab}
            role="tab"
            type="button"
            aria-selected={editorTab === tab}
            className={editorTab === tab ? "active" : ""}
            onClick={() => props.setCardTab(tab)}
          >
            {renderTabIcon(tab)}
            <span>{formatTabLabel(tab)}</span>
          </button>
        ))}
      </div>

      {editorTab === "instructions" ? (
        <InstructionsPanel activeCard={props.activeCard} updateActiveCard={props.updateActiveCard} />
      ) : null}
      {editorTab === "rules" ? (
        <RulesPanel
          activeCard={props.activeCard}
          compiledPrompt={props.compiledPrompt}
          compiledPromptResult={props.compiledPromptResult}
          updateActiveCard={props.updateActiveCard}
        />
      ) : null}
      {editorTab === "lorebooks" ? (
        <LorebooksPanel
          activeCard={props.activeCard}
          activeLorebookEntries={props.activeLorebookEntries}
          updateActiveLorebook={props.updateActiveLorebook}
          addLorebookEntry={props.addLorebookEntry}
          lorebookEntryError={props.lorebookEntryError}
        />
      ) : null}
      {editorTab === "rpg" && props.activeCard.rpg ? (
        <RpgStatePanel rpg={props.activeCard.rpg} updateRpgState={props.updateRpgState} />
      ) : null}
    </section>
  );
}

function ProvidersSection(props: {
  providerKeyStatus: string;
  providerTestStatus: string;
  providerSettings: ProviderSettings;
  setProviderSettings: (settings: ProviderSettings) => void;
  imageProviderSettings: ImageProviderSettings;
  setImageProviderSettings: (settings: ImageProviderSettings) => void;
  comfyUiCheckpointModels: string[];
  imageProviderStatus: string;
  imageSessionApiKey: string;
  setImageSessionApiKey: (value: string) => void;
  secureStorageStatus: SecureStorageStatus;
  sessionApiKey: string;
  setSessionApiKey: (value: string) => void;
  saveProviderKey: () => Promise<void>;
  forgetProviderKey: () => Promise<void>;
  testTextProvider: () => Promise<void>;
  refreshComfyUICheckpoints: () => Promise<void>;
}) {
  const textModelChoices = getTextModelChoices(props.providerSettings);
  const imageModelChoices = getImageModelChoices(props.comfyUiCheckpointModels, props.imageProviderSettings.model);

  function updateSettings(patch: Partial<ProviderSettings>) {
    const next = { ...props.providerSettings, ...patch };
    const baseUrlChanged =
      typeof patch.baseUrl === "string" &&
      normalizeProviderBaseUrlOrNull(patch.baseUrl) !== normalizeProviderBaseUrlOrNull(props.providerSettings.baseUrl);
    if (
      (patch.providerId && patch.providerId !== props.providerSettings.providerId) ||
      baseUrlChanged ||
      patch.mode === "mock"
    ) {
      delete next.secretReference;
    }
    props.setProviderSettings(next);
  }

  return (
    <div className="workspace-grid providers-grid">
      <section className="panel" aria-label="LLM API keys">
        <div className="section-title">
          <KeyRound size={17} />
          <h3>LLM Provider</h3>
        </div>
        <p>
          Recommended: <strong>Qwen3.7-Max</strong> using model id <code className="inline-code">qwen3.7-max</code>.
          Stored desktop keys are used through the local backend; React keeps only a secret reference.
        </p>
        <label className="field">
          <span>Runtime mode</span>
          <select
            value={props.providerSettings.mode}
            onChange={(event) =>
              updateSettings(
                event.target.value === "mock"
                  ? {
                      mode: "mock",
                      providerId: "mock",
                      displayName: "Mock local runtime",
                      model: "mock-narrator",
                      secretReference: undefined,
                    }
                  : {
                      mode: "openai-compatible",
                      providerId: "alibaba-model-studio",
                      displayName: "Alibaba Cloud Model Studio / DashScope",
                      model: qwen37MaxReferencePreset.id,
                      secretReference: undefined,
                    },
              )
            }
          >
            <option value="mock">Mock local runtime</option>
            <option value="openai-compatible">OpenAI-compatible BYOK endpoint</option>
          </select>
        </label>
        <label className="field">
          <span>Provider</span>
          <select
            value={props.providerSettings.providerId}
            onChange={(event) => {
              const providerId = event.target.value;
              const presets: Record<string, Partial<ProviderSettings>> = {
                "alibaba-model-studio": {
                  displayName: "Alibaba Cloud Model Studio / DashScope",
                  baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
                  model: qwen37MaxReferencePreset.id,
                },
                openrouter: {
                  displayName: "OpenRouter BYOK",
                  baseUrl: "https://openrouter.ai/api/v1",
                  model: getDefaultTextModel("openrouter"),
                },
                local: {
                  displayName: "Local OpenAI-compatible endpoint",
                  baseUrl: "http://127.0.0.1:1234/v1",
                  model: "local-model",
                },
              };
              updateSettings({
                providerId,
                mode: providerId === "mock" ? "mock" : "openai-compatible",
                ...(presets[providerId] ?? {}),
              });
            }}
          >
            <option value="mock">Mock local runtime</option>
            <option value="alibaba-model-studio">Alibaba Cloud Model Studio / DashScope</option>
            <option value="openrouter">OpenRouter BYOK</option>
            <option value="local">Local OpenAI-compatible endpoint</option>
          </select>
        </label>
        <label className="field">
          <span>Base URL</span>
          <input
            value={props.providerSettings.baseUrl}
            onChange={(event) => updateSettings({ baseUrl: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Model</span>
          {props.providerSettings.providerId === "local" ? (
            <input
              value={props.providerSettings.model}
              onChange={(event) => updateSettings({ model: event.target.value })}
            />
          ) : (
            <select
              value={props.providerSettings.model}
              onChange={(event) => updateSettings({ model: event.target.value })}
            >
              {textModelChoices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.label}
                </option>
              ))}
            </select>
          )}
        </label>
        <label className="field">
          <span>Session API key</span>
          <input
            type="password"
            value={props.sessionApiKey}
            onChange={(event) => props.setSessionApiKey(event.target.value)}
            placeholder={
              props.secureStorageStatus.available
                ? "Stored in OS keychain when activated"
                : "Held in memory for this session only"
            }
          />
        </label>
        <button className="primary-button full-width" type="button" onClick={() => void props.saveProviderKey()}>
          <LockKeyhole size={16} />
          {props.secureStorageStatus.available ? "Store key securely" : "Activate provider for session"}
        </button>
        {props.providerSettings.secretReference ? (
          <button className="secondary-button full-width" type="button" onClick={() => void props.forgetProviderKey()}>
            <X size={16} />
            Forget stored key
          </button>
        ) : null}
        <button className="secondary-button full-width" type="button" onClick={() => void props.testTextProvider()}>
          <Play size={16} />
          Test text provider
        </button>
        <p className="status-line" role="status" aria-live="polite">
          {props.providerKeyStatus}
        </p>
        <p className="status-line" role="status" aria-live="polite">
          {props.providerTestStatus}
        </p>
        <p className="status-line" role="status" aria-live="polite">
          Secret storage:{" "}
          {props.secureStorageStatus.available
            ? `OS keychain available (${props.secureStorageStatus.storageKind}).`
            : `session-only (${props.secureStorageStatus.reason ?? "desktop secure storage unavailable"}).`}
        </p>
        {props.providerSettings.secretReference ? (
          <p className="status-line">
            Stored reference: {props.providerSettings.secretReference.storageKind} /{" "}
            {props.providerSettings.secretReference.storageKey}
          </p>
        ) : null}
      </section>

      <section className="panel" aria-label="Image provider">
        <div className="section-title">
          <Brush size={17} />
          <h3>Image Provider</h3>
        </div>
        <p>
          Recommended free local path: <strong>{recommendedLocalImageProvider.displayName}</strong>. Paste a ComfyUI
          API workflow that uses <code className="inline-code">{"{{prompt}}"}</code> and{" "}
          <code className="inline-code">{"{{negative_prompt}}"}</code> placeholders.
        </p>
        <label className="field">
          <span>Provider</span>
          <select
            value={props.imageProviderSettings.mode}
            onChange={(event) =>
              props.setImageProviderSettings({
                ...props.imageProviderSettings,
                mode: event.target.value as ImageProviderMode,
              })
            }
          >
            <option value="comfyui">ComfyUI local API</option>
            <option value="prompt-only">Prompt only</option>
          </select>
        </label>
        <label className="field">
          <span>Local endpoint</span>
          <input
            value={props.imageProviderSettings.endpoint}
            onChange={(event) =>
              props.setImageProviderSettings({
                ...props.imageProviderSettings,
                endpoint: event.target.value,
              })
            }
          />
        </label>
        <label className="field">
          <span>ComfyUI API key</span>
          <input
            type="password"
            value={props.imageSessionApiKey}
            onChange={(event) => props.setImageSessionApiKey(event.target.value)}
            placeholder="Optional; held in memory for this session only"
          />
          <p className="field-help">Leave this blank for a normal local ComfyUI server. Use it only if your ComfyUI endpoint is behind an auth proxy.</p>
        </label>
        <label className="field">
          <span>Default model</span>
          <select
            value={props.imageProviderSettings.model}
            onChange={(event) =>
              props.setImageProviderSettings({
                ...props.imageProviderSettings,
                model: event.target.value,
              })
            }
          >
            {imageModelChoices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary-button full-width" type="button" onClick={() => void props.refreshComfyUICheckpoints()}>
          <RotateCcw size={16} />
          Refresh installed image models
        </button>
        <p className="status-line" role="status" aria-live="polite">
          {props.imageProviderStatus}
        </p>
        <div className="instruction-grid compact-fields">
          <label className="field">
            <span>Width</span>
            <input
              type="number"
              min={localImageMinimumImageSize}
              max={2048}
              step={64}
              value={props.imageProviderSettings.width}
              onChange={(event) =>
                props.setImageProviderSettings({
                  ...props.imageProviderSettings,
                  width: toLocalImageQualityDimension(event.target.value),
                })
              }
            />
          </label>
          <label className="field">
            <span>Height</span>
            <input
              type="number"
              min={localImageMinimumImageSize}
              max={2048}
              step={64}
              value={props.imageProviderSettings.height}
              onChange={(event) =>
                props.setImageProviderSettings({
                  ...props.imageProviderSettings,
                  height: toLocalImageQualityDimension(event.target.value),
                })
              }
            />
          </label>
          <label className="field">
            <span>Timeout ms</span>
            <input
              type="number"
              min={localImageMinimumPollTimeoutMs}
              max={600_000}
              step={5_000}
              value={props.imageProviderSettings.pollTimeoutMs}
              onChange={(event) =>
                props.setImageProviderSettings({
                  ...props.imageProviderSettings,
                  pollTimeoutMs: toBoundedNumber(
                    event.target.value,
                    defaultImageProviderSettings.pollTimeoutMs,
                    localImageMinimumPollTimeoutMs,
                    600_000,
                  ),
                })
              }
            />
          </label>
        </div>
        <div className="instruction-grid compact-fields">
          <label className="field">
            <span>Seed</span>
            <input
              type="number"
              min={-1}
              max={2_147_483_647}
              value={props.imageProviderSettings.seed}
              onChange={(event) =>
                props.setImageProviderSettings({
                  ...props.imageProviderSettings,
                  seed: toBoundedNumber(event.target.value, -1, -1, 2_147_483_647),
                })
              }
            />
            <p className="field-help">Use 0 or -1 for a fresh random seed each generation; use a positive number to repeat.</p>
          </label>
          <label className="field">
            <span>Steps</span>
            <input
              type="number"
              min={1}
              max={150}
              value={props.imageProviderSettings.steps}
              onChange={(event) =>
                props.setImageProviderSettings({
                  ...props.imageProviderSettings,
                  steps: toBoundedNumber(event.target.value, localImageRecommendedSteps, 1, 150),
                })
              }
            />
          </label>
          <label className="field">
            <span>CFG</span>
            <input
              type="number"
              min={1}
              max={30}
              step={0.5}
              value={props.imageProviderSettings.cfg}
              onChange={(event) =>
                props.setImageProviderSettings({
                  ...props.imageProviderSettings,
                  cfg: toBoundedFloat(event.target.value, localImageRecommendedCfg, 1, 30),
                })
              }
            />
          </label>
        </div>
        <div className="instruction-grid">
          <label className="field">
            <span>Sampler</span>
            <input
              value={props.imageProviderSettings.samplerName}
              onChange={(event) =>
                props.setImageProviderSettings({
                  ...props.imageProviderSettings,
                  samplerName: event.target.value,
                })
              }
            />
          </label>
          <label className="field">
            <span>Scheduler</span>
            <input
              value={props.imageProviderSettings.scheduler}
              onChange={(event) =>
                props.setImageProviderSettings({
                  ...props.imageProviderSettings,
                  scheduler: event.target.value,
                })
              }
            />
          </label>
        </div>
        <label className="field">
          <span>ComfyUI API workflow JSON</span>
          <p className="field-help">
            Export a workflow from ComfyUI with Save (API Format), then paste the JSON here. The app fills
            placeholders such as <code className="inline-code">{"{{prompt}}"}</code>,
            <code className="inline-code">{"{{negative_prompt}}"}</code>, width, height, seed, and model
            before sending it to your local ComfyUI server.
          </p>
          <textarea
            value={props.imageProviderSettings.workflowJson}
            onChange={(event) =>
              props.setImageProviderSettings({
                ...props.imageProviderSettings,
                workflowJson: event.target.value,
              })
            }
            placeholder='{"1":{"class_type":"SaveImage","inputs":{"filename_prefix":"local_cards"}}}'
            rows={8}
          />
        </label>
        <p className="status-line">
          Endpoint is restricted to loopback URLs. The app stores workflow/settings only, never image API keys.
        </p>
      </section>
    </div>
  );
}

function MemoryDrawer(props: {
  card: RuntimeCard;
  close: () => void;
  consolidate: () => void;
  isConsolidating: boolean;
  status: string | null;
}) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        props.close();
      }
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [props]);

  return (
    <aside className="memory-drawer" role="dialog" aria-modal="true" aria-label="Memory inspector">
      <div className="drawer-header">
        <div>
          <p className="eyebrow">Hidden until opened</p>
          <h3>{props.card.name} Memory</h3>
        </div>
        <button className="icon-button" type="button" onClick={props.close} aria-label="Close memory inspector">
          <X size={18} />
        </button>
      </div>
      <div className="button-row">
        <button
          className="secondary-button compact-button"
          type="button"
          onClick={props.consolidate}
          disabled={props.isConsolidating || props.card.memory.length < 2}
        >
          <Layers3 size={15} />
          {props.isConsolidating ? "Consolidating..." : "Consolidate memory"}
        </button>
      </div>
      {props.status ? (
        <p className="field-help" role="status" aria-live="polite">
          {props.status}
        </p>
      ) : null}
      {props.card.memory.length === 0 ? <p>No saved memory for this card yet.</p> : null}
      <div className="memory-list">
        {props.card.memory.map((entry) => (
          <article className="memory-row" key={entry.id}>
            <strong>{entry.label}</strong>
            <p>{entry.detail}</p>
          </article>
        ))}
      </div>
    </aside>
  );
}


