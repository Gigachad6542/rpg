import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Brush,
  CheckCircle2,
  ClipboardList,
  Download,
  Eye,
  GitBranch,
  Image,
  KeyRound,
  Layers3,
  LockKeyhole,
  Map,
  MessageSquare,
  Moon,
  Plus,
  Power,
  Play,
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
import profileImageUrl from "../assets/local-cards-profile.png";
import { compileImagePrompt } from "../runtime/imagePromptCompiler";
import { selectActiveLorebookEntries } from "../runtime/loreTriggerEngine";
import { type CompiledPrompt } from "../runtime/promptCompiler";
import { compileTurnPrompt, runTurnPipeline, type RunTurnPipelineRequest } from "../runtime/turnPipeline";
import {
  validatePlayerAction as validatePlayerActionWithRules,
  type PlayerRuleDefinition,
  type PlayerRuleEnforcement,
} from "../runtime/playerRuleEngine";
import { ComfyUIImageProvider } from "../providers/comfyUIProvider";
import { MockTextProvider } from "../providers/mockTextProvider";
import { OpenAICompatibleTextProvider } from "../providers/openAICompatibleProvider";
import { qwen37MaxReferencePreset, recommendedLocalImageProvider } from "../providers/modelPresets";
import { TauriStoredSecretTextProvider } from "../providers/tauriStoredSecretTextProvider";
import {
  parseSecretReference,
  requireSecureKeyStorage,
  type KeyStorage,
  type SecretReference,
  type SecureStorageStatus,
} from "../security/keyStorage";
import {
  loadLocalRuntimeSnapshot,
  saveLocalRuntimeSnapshot,
  type LocalRuntimeSnapshot,
} from "./localRuntimeStore";
import { RuntimeRepositoryStore, type RuntimeRepository, type RepositoryRuntimeSnapshot } from "./runtimeRepositoryStore";
import {
  shouldPersistFullLocalSnapshot,
  shouldUseRepositorySnapshot,
} from "./startupPersistencePolicy";
import {
  applyValidatedTurnEffectsToCard,
  describeValidatedTurnEffects,
} from "./turnEffects";

type Theme = "light" | "dark";
type MainSection = "runtime" | "cards" | "lorebooks" | "providers" | "settings";
type CardKind = "character" | "rpg";
type CardTab = "chat" | "instructions" | "rules" | "lorebooks" | "rpg" | "map";
type TextProviderMode = "mock" | "openai-compatible";
type ImageProviderMode = "prompt-only" | "comfyui";

type RuntimeCard = {
  id: string;
  name: string;
  kind: CardKind;
  summary: string;
  characterName: string;
  characterDescription: string;
  scenario: string;
  greeting: string;
  exampleDialogs: string;
  systemPrompt: string;
  preHistoryInstructions: string;
  postHistoryInstructions: string;
  playerRules: PlayerRule[];
  lorebooks: Lorebook[];
  memory: MemoryEntry[];
  mapEnabled: boolean;
  rpg?: RpgCardState;
};

type PlayerRule = PlayerRuleDefinition;

type Lorebook = {
  id: string;
  name: string;
  enabled: boolean;
  scanDepth: number;
  tokenBudget: number;
  recursiveScanning: boolean;
  entries: LorebookEntry[];
};

type LorebookEntry = {
  id: string;
  title: string;
  keys: string[];
  secondaryKeys: string[];
  content: string;
  insertionOrder: number;
  priority: number;
  enabled: boolean;
  constant: boolean;
  probability: number;
  caseSensitive: boolean;
  wholeWord: boolean;
};

type NewLorebookEntry = {
  title: string;
  keys: string;
  secondaryKeys: string;
  content: string;
  insertionOrder: string;
  priority: string;
  constant: boolean;
  probability: string;
  caseSensitive: boolean;
  wholeWord: boolean;
};

type NewPlayerRule = {
  title: string;
  description: string;
};

type RpgCardState = {
  location: string;
  health: string;
  inventory: string[];
  quests: string[];
  flags: Record<string, boolean>;
  knownPlaces: string[];
  mapStyle: string;
};

type MemoryEntry = {
  id: string;
  label: string;
  detail: string;
};

type Message = {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
};

type ChatSession = {
  id: string;
  cardId: string;
  title: string;
  branchOfId?: string;
  branchedFromMessageId?: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
};

type PromptRun = {
  id: string;
  cardId: string;
  chatId: string;
  compiledPrompt: string;
  response: string;
  provider: string;
  model: string;
  tokenEstimate: number;
  includedLayerIds: string[];
  includedLoreEntryIds: string[];
  warnings: string[];
  stateChanges: string[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  blockedReason?: string;
};

type ProviderSettings = {
  mode: TextProviderMode;
  providerId: string;
  displayName: string;
  baseUrl: string;
  model: string;
  secretReference?: SecretReference;
};

type ImageProviderSettings = {
  mode: ImageProviderMode;
  providerId: string;
  displayName: string;
  endpoint: string;
  model: string;
  workflowJson: string;
  width: number;
  height: number;
  seed: number;
  steps: number;
  cfg: number;
  samplerName: string;
  scheduler: string;
  pollTimeoutMs: number;
};

type RuntimeSettings = {
  textStreaming: boolean;
  banEmojis: boolean;
  impersonationPrompt: string;
};

type ModelChoice = {
  id: string;
  label: string;
};

type GeneratedMapArtifact = {
  id: string;
  cardId: string;
  chatId: string;
  prompt: string;
  negativePrompt: string;
  provider: string;
  model: string;
  status: "prompt-only" | "generated" | "error";
  imageUrl?: string;
  error?: string;
  createdAt: string;
};

type AppRuntimeSnapshot = LocalRuntimeSnapshot<RuntimeCard, Message, PromptRun, ChatSession> & {
  providerSettings: ProviderSettings;
  imageProviderSettings: ImageProviderSettings;
  runtimeSettings: RuntimeSettings;
  generatedMaps: GeneratedMapArtifact[];
  chatSessions: ChatSession[];
  activeChatIds: Record<string, string>;
};

type TurnPromptRequest = Omit<RunTurnPipelineRequest, "modelAdapter" | "model">;

const initialCards: RuntimeCard[] = [
  {
    id: "card_blank_slate_rpg",
    name: "Blank Slate RPG",
    kind: "rpg",
    summary: "Empty RPG card for user-defined world rules, lore, state, and map generation.",
    characterName: "",
    characterDescription: "",
    scenario: "",
    greeting: "",
    exampleDialogs: "",
    systemPrompt:
      "Run only the RPG defined by this card. Do not invent permanent mechanics, lore, locations, rewards, or win conditions until they are established by the card, chat history, or active lorebook entries.",
    preHistoryInstructions: "",
    postHistoryInstructions: "",
    playerRules: createDefaultRpgPlayerRules(),
    mapEnabled: true,
    lorebooks: [],
    memory: [],
    rpg: {
      location: "Unmapped starting area",
      health: "not configured",
      inventory: [],
      quests: [],
      flags: {},
      knownPlaces: [],
      mapStyle: "birdseye map, readable labels, clean cartographic layout",
    },
  },
];

const starterMessages: Message[] = [];

const defaultNewCard = {
  name: "",
  kind: "character" as CardKind,
  summary: "",
  characterName: "",
  characterDescription: "",
  scenario: "",
  greeting: "",
  exampleDialogs: "",
  systemPrompt: "",
  preHistoryInstructions: "",
  postHistoryInstructions: "",
  playerRules: "",
  lorebookName: "",
  mapEnabled: false,
};

const defaultNewLorebookEntry: NewLorebookEntry = {
  title: "",
  keys: "",
  secondaryKeys: "",
  content: "",
  insertionOrder: "100",
  priority: "0",
  constant: false,
  probability: "100",
  caseSensitive: false,
  wholeWord: false,
};

const defaultNewPlayerRule: NewPlayerRule = {
  title: "",
  description: "",
};

const defaultProviderSettings: ProviderSettings = {
  mode: "mock",
  providerId: "mock",
  displayName: "Mock local runtime",
  baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  model: "mock-narrator",
};

const openRouterModelChoices: ModelChoice[] = [
  { id: "qwen/qwen3-235b-a22b", label: "Qwen3 235B A22B" },
  { id: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
  { id: "openai/gpt-4o-mini", label: "GPT-4o Mini" },
  { id: "google/gemini-2.0-flash-001", label: "Gemini 2.0 Flash" },
  { id: "meta-llama/llama-3.1-70b-instruct", label: "Llama 3.1 70B Instruct" },
];

const alibabaModelChoices: ModelChoice[] = [
  { id: qwen37MaxReferencePreset.id, label: qwen37MaxReferencePreset.displayName },
];

const defaultComfyWorkflowJson = JSON.stringify(
  {
    "3": {
      class_type: "KSampler",
      inputs: {
        seed: "{{seed}}",
        steps: "{{steps}}",
        cfg: "{{cfg}}",
        sampler_name: "{{sampler}}",
        scheduler: "{{scheduler}}",
        denoise: 1,
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0],
      },
    },
    "4": {
      class_type: "CheckpointLoaderSimple",
      inputs: {
        ckpt_name: "{{model}}",
      },
    },
    "5": {
      class_type: "EmptyLatentImage",
      inputs: {
        width: "{{width}}",
        height: "{{height}}",
        batch_size: 1,
      },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: "{{prompt}}",
        clip: ["4", 1],
      },
    },
    "7": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: "{{negative_prompt}}",
        clip: ["4", 1],
      },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["3", 0],
        vae: ["4", 2],
      },
    },
    "9": {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: "local_cards",
        images: ["8", 0],
      },
    },
  },
  null,
  2,
);

const defaultImageProviderSettings: ImageProviderSettings = {
  mode: "comfyui",
  providerId: recommendedLocalImageProvider.providerId,
  displayName: "ComfyUI local API",
  endpoint: recommendedLocalImageProvider.endpoint,
  model: recommendedLocalImageProvider.model,
  workflowJson: defaultComfyWorkflowJson,
  width: 1024,
  height: 1024,
  seed: -1,
  steps: 20,
  cfg: 7,
  samplerName: "euler",
  scheduler: "normal",
  pollTimeoutMs: 120_000,
};

const comfyUiModelChoices: ModelChoice[] = [
  { id: recommendedLocalImageProvider.model, label: "Juggernaut XL v9" },
  { id: "sd_xl_base_1.0.safetensors", label: "SDXL Base 1.0" },
  { id: "dreamshaperXL_v21TurboDPMSDE.safetensors", label: "DreamShaper XL Turbo" },
];

const defaultRuntimeSettings: RuntimeSettings = {
  textStreaming: false,
  banEmojis: false,
  impersonationPrompt: "",
};

const emptyCompiledPrompt: CompiledPrompt = {
  prompt: "",
  includedLayers: [],
  omittedLayers: [],
  truncatedLayerIds: [],
  tokenEstimate: 0,
};

function createDefaultRpgPlayerRules(): PlayerRule[] {
  return [
    {
      id: "rule_ignore_boundaries",
      title: "Respect card boundaries",
      description: "The player cannot ask the model to ignore this card, bypass its rules, or overwrite its continuity.",
      enabled: true,
      enforcement: "ignore_rules",
    },
    {
      id: "rule_validated_state",
      title: "State changes require validation",
      description: "Permanent health, item, quest, location, and flag changes are proposals until this card validates them.",
      enabled: true,
      enforcement: "validated_state",
    },
    {
      id: "rule_health_matters",
      title: "Health must matter",
      description: "Damage, healing, exhaustion, injury, and survival must respect the configured health or status state.",
      enabled: true,
      enforcement: "health_matters",
    },
    {
      id: "rule_inventory_matters",
      title: "Inventory must matter",
      description: "The player can only use, equip, spend, trade, drink, unlock with, or consume items established in card state.",
      enabled: true,
      enforcement: "inventory_matters",
    },
    {
      id: "rule_capability_limits",
      title: "Character capability limits",
      description: "The player cannot perform impossible abilities outside their character's established capabilities.",
      enabled: true,
      enforcement: "capability_limits",
    },
    {
      id: "rule_movement_plausibility",
      title: "Movement stays plausible",
      description: "The player cannot teleport, phase, walk through walls, or access exits that the card has not established.",
      enabled: true,
      enforcement: "movement_plausibility",
    },
    {
      id: "rule_no_free_creation",
      title: "No free items, allies, or exits",
      description: "The player cannot create money, keys, weapons, allies, exits, powers, or rewards without established cause.",
      enabled: true,
      enforcement: "no_free_creation",
    },
  ];
}

function createDefaultCharacterPlayerRules(): PlayerRule[] {
  return [
    {
      id: "rule_ignore_boundaries",
      title: "Respect card boundaries",
      description: "The player cannot ask the model to ignore this card, bypass its rules, or overwrite its continuity.",
      enabled: true,
      enforcement: "ignore_rules",
    },
    {
      id: "rule_character_knowledge",
      title: "Respect character limits",
      description: "The player cannot force knowledge, memories, abilities, or outcomes outside the card's established scope.",
      enabled: true,
      enforcement: "prompt_only",
    },
  ];
}

export function App() {
  const [initialSnapshot] = useState(() => loadLocalRuntimeSnapshot<RuntimeCard, Message, PromptRun, ChatSession>());
  const normalizedInitialCards = normalizeRuntimeCards(initialSnapshot?.cards ?? initialCards);
  const initialActiveCardId = getStartupActiveCardId(initialSnapshot, normalizedInitialCards);
  const initialChatSessions = parseChatSessions(
    initialSnapshot?.chatSessions,
    normalizedInitialCards,
    initialSnapshot?.messages ?? starterMessages,
    initialActiveCardId,
  );
  const repositoryStoreRef = useRef<RuntimeRepository | null>(null);
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
  const [promptRuns, setPromptRuns] = useState<PromptRun[]>(() => initialSnapshot?.promptRuns ?? []);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [ruleWarning, setRuleWarning] = useState<string | null>(null);
  const [mapPrompt, setMapPrompt] = useState<string | null>(null);
  const [imagePromptDraft, setImagePromptDraft] = useState("");
  const [imageNegativePromptDraft, setImageNegativePromptDraft] = useState("");
  const [mapArtifact, setMapArtifact] = useState<GeneratedMapArtifact | null>(() =>
    parseGeneratedMaps(initialSnapshot?.generatedMaps).find((artifact) => artifact.cardId === initialSnapshot?.activeCardId) ??
    null,
  );
  const [generatedMaps, setGeneratedMaps] = useState<GeneratedMapArtifact[]>(() =>
    parseGeneratedMaps(initialSnapshot?.generatedMaps),
  );
  const [isGeneratingMap, setIsGeneratingMap] = useState(false);
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
  const [runtimeSettings, setRuntimeSettings] = useState<RuntimeSettings>(() =>
    parseRuntimeSettings(initialSnapshot?.runtimeSettings),
  );
  const [sessionApiKey, setSessionApiKey] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [saveStatus, setSaveStatus] = useState(initialSnapshot ? "Loaded local runtime snapshot." : "Ready for local save.");
  const [repositoryStatus, setRepositoryStatus] = useState("Repository store initializing.");
  const [repositoryHydrated, setRepositoryHydrated] = useState(false);
  const [pendingDeleteChatId, setPendingDeleteChatId] = useState<string | null>(null);
  const [pendingDeleteCardId, setPendingDeleteCardId] = useState<string | null>(null);
  const [newCardError, setNewCardError] = useState<string | null>(null);
  const [lorebookEntryError, setLorebookEntryError] = useState<string | null>(null);
  const [secureStorageStatus, setSecureStorageStatus] = useState<SecureStorageStatus>({
    available: false,
    storageKind: "memory-only",
    reason: "Secure storage status has not been checked yet.",
  });

  const activeCard = cards.find((card) => card.id === activeCardId) ?? null;
  const activeChat = activeCard ? getActiveChatForCard(activeCard.id, chatSessions, activeChatIds) : undefined;
  const messages = useMemo(() => activeChat?.messages ?? [], [activeChat?.messages]);
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

  const compiledPromptResult = useMemo(
    () => {
      if (!activeCard) {
        return emptyCompiledPrompt;
      }
      return compileTurnPrompt({
        ...buildTurnPromptRequest(activeCard, activeLorebookEntries, messages, draft, runtimeSettings),
        includeLayerLabels: true,
      });
    },
    [activeCard, activeLorebookEntries, draft, messages, runtimeSettings],
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
    setMapArtifact(activeCard ? findGeneratedMapForChat(generatedMaps, activeCard.id, activeChat?.id) : null);
  }, [activeCard, activeChat?.id, generatedMaps]);

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
      void store
        .saveSnapshot(toRepositorySnapshot(currentSnapshot))
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

  function hydrateFromSnapshot(snapshot: RepositoryRuntimeSnapshot) {
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
    setPromptRuns(snapshot.promptRuns as PromptRun[]);
    setProviderKeyStatus(snapshot.providerKeyStatus);
    setProviderSettings(parseProviderSettings(snapshot.providerSettings));
    setImageProviderSettings(parseImageProviderSettings(snapshot.imageProviderSettings));
    setRuntimeSettings(parseRuntimeSettings(snapshot.runtimeSettings));
    const hydratedMaps = parseGeneratedMaps(snapshot.generatedMaps);
    setGeneratedMaps(hydratedMaps);
    setMapArtifact(hydratedActiveCardId ? findGeneratedMapForChat(hydratedMaps, hydratedActiveCardId, undefined) : null);
    setSaveStatus("Loaded repository runtime snapshot.");
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
    setMapArtifact(findGeneratedMapForChat(generatedMaps, card.id, activeChatIds[card.id]));
    setRuntimeRunning(true);
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
    setMapArtifact(findGeneratedMapForChat(generatedMaps, activeCard.id, chat.id));
    setMapPrompt(null);
    setImagePromptDraft("");
    setImageNegativePromptDraft("");
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
    setMapPrompt(null);
    setImagePromptDraft("");
    setImageNegativePromptDraft("");
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
      setMapArtifact(findGeneratedMapForChat(generatedMaps, fallback.id, activeChatIds[fallback.id]));
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

  async function generateMockTurn() {
    if (!activeCard) {
      setRuleWarning("Open a card before starting the runtime.");
      return;
    }
    if (!runtimeRunning) {
      setRuleWarning("Runtime is shut down. Start the runtime before generating another turn.");
      return;
    }
    if (!draft.trim()) {
      return;
    }

    const validation = validatePlayerActionWithRules({
      cardKind: activeCard.kind,
      rules: activeCard.playerRules,
      action: draft,
      rpgState: activeCard.rpg,
    });
    setRuleWarning(validation.warning);
    if (!validation.allowed) {
      return;
    }

    setIsGenerating(true);
    const runId = createRuntimeEntityId("run");
    const chat = activeChat ?? createChatSession(activeCard.id, `${activeCard.name} chat`);
    if (!activeChat) {
      setChatSessions((current) => [...current, chat]);
      setActiveChatIds((current) => ({ ...current, [activeCard.id]: chat.id }));
    }
    const userMessage: Message = {
      id: `user-${runId}`,
      role: "user",
      content: draft.trim(),
    };
    try {
      const provider = createTextProvider(providerSettings, sessionApiKey, activeCard, draft, activeLorebookEntries.length);
      const pipelineResult = await runTurnPipeline({
        ...buildTurnPromptRequest(activeCard, activeLorebookEntries, [...chat.messages, userMessage], draft, runtimeSettings, {
          latestUserMessage: userMessage,
          promptRunId: runId,
          metadata: {
            cardKind: activeCard.kind,
            includedLoreEntryIds: activeLorebookEntries.map((entry) => entry.id),
            providerMode: providerSettings.mode,
            textStreaming: runtimeSettings.textStreaming,
            chatId: chat.id,
          },
        }),
        modelAdapter: provider,
        model: providerSettings.mode === "mock" ? "mock-narrator" : providerSettings.model,
        temperature: 0.6,
      });
      const warnings = pipelineResult.warnings.map((warning) => warning.message);
      const stateChanges = describeValidatedTurnEffects(pipelineResult.stateProposals.extraction);
      const assistantMessage: Message = {
        id: `assistant-${runId}`,
        role: "assistant",
        content: pipelineResult.assistantMessageText,
      };

      setChatSessions((current) =>
        upsertChatSession(current, {
          ...chat,
          messages: [...chat.messages, userMessage, assistantMessage],
          title: chat.title || deriveChatTitle(userMessage.content),
          updatedAt: new Date().toISOString(),
        }),
      );
      setCards((current) =>
        current.map((card) =>
          card.id === activeCard.id
            ? applyValidatedTurnEffectsToCard(card, pipelineResult.stateProposals.extraction)
            : card,
        ),
      );
      setPromptRuns((current) => [
        ...current,
        {
          id: runId,
          cardId: activeCard.id,
          chatId: chat.id,
          compiledPrompt: pipelineResult.promptRun.compiledPrompt,
          response: assistantMessage.content,
          provider: pipelineResult.promptRun.providerId,
          model: pipelineResult.promptRun.model,
          tokenEstimate: pipelineResult.promptRun.tokenEstimate,
          includedLayerIds: [...pipelineResult.promptRun.includedLayerIds],
          includedLoreEntryIds: [...pipelineResult.promptRun.includedLoreEntryIds],
          warnings,
          stateChanges,
          usage: pipelineResult.promptRun.usage,
        },
      ]);
      setDraft("");
    } catch (error) {
      setRuleWarning(getErrorMessage(error));
    } finally {
      setIsGenerating(false);
    }
  }

  function prepareImagePrompt() {
    if (!activeCard) {
      return;
    }
    if (!activeCard.mapEnabled) {
      return;
    }

    const compiled = compileImagePrompt(buildImagePromptRequest(activeCard, messages));
    setMapPrompt(compiled.prompt);
    setImagePromptDraft(compiled.prompt);
    setImageNegativePromptDraft(compiled.negativePrompt);
  }

  async function generateImageFromPrompt() {
    if (!activeCard) {
      return;
    }
    if (!activeCard.mapEnabled || !imagePromptDraft.trim()) {
      return;
    }

    setIsGeneratingMap(true);
    const baseArtifact: GeneratedMapArtifact = {
      id: createRuntimeEntityId("map"),
      cardId: activeCard.id,
      chatId: activeChat?.id ?? `chat_${activeCard.id}`,
      prompt: imagePromptDraft.trim(),
      negativePrompt: imageNegativePromptDraft.trim(),
      provider: imageProviderSettings.mode === "comfyui" ? "comfyui" : "prompt-only",
      model: imageProviderSettings.model,
      status: "prompt-only",
      createdAt: new Date().toISOString(),
    };

    try {
      if (imageProviderSettings.mode === "prompt-only" || !imageProviderSettings.workflowJson.trim()) {
        const artifact: GeneratedMapArtifact = {
          ...baseArtifact,
          error:
            imageProviderSettings.mode === "comfyui"
              ? "Paste a ComfyUI API workflow in Image Provider settings to generate an image."
              : undefined,
        };
        setMapArtifact(artifact);
        setGeneratedMaps((current) => upsertGeneratedMap(current, artifact));
        return;
      }

      const provider = new ComfyUIImageProvider({
        endpoint: imageProviderSettings.endpoint,
        workflowJson: imageProviderSettings.workflowJson,
        model: imageProviderSettings.model,
        pollTimeoutMs: imageProviderSettings.pollTimeoutMs,
      });
      const result = await provider.generateImage({
        model: imageProviderSettings.model,
        prompt: imagePromptDraft.trim(),
        negativePrompt: imageNegativePromptDraft.trim(),
        width: imageProviderSettings.width,
        height: imageProviderSettings.height,
        seed: imageProviderSettings.seed,
        steps: imageProviderSettings.steps,
        cfg: imageProviderSettings.cfg,
        samplerName: imageProviderSettings.samplerName,
        scheduler: imageProviderSettings.scheduler,
        metadata: {
          cardId: activeCard.id,
          chatId: activeChat?.id,
          cardName: activeCard.name,
        },
      });
      const artifact: GeneratedMapArtifact = {
        ...baseArtifact,
        provider: result.providerId,
        status: "generated",
        imageUrl: result.images[0]?.url,
      };
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
      setIsGeneratingMap(false);
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

  return (
    <main className={`app-shell ${theme}`} data-theme={theme}>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand-lockup">
          <img className="brand-image" src={profileImageUrl} alt="" />
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
              <dd>{activeCard?.name ?? "No card open"}</dd>
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
              draft={draft}
              setDraft={setDraft}
              sendMessage={generateMockTurn}
              writeForMe={writeForMe}
              runtimeRunning={runtimeRunning}
              startRuntime={startRuntime}
              isGenerating={isGenerating}
              promptRuns={promptRuns.filter((run) => run.cardId === activeCard.id && (!activeChat || run.chatId === activeChat.id))}
              ruleWarning={ruleWarning}
              mapPrompt={mapPrompt}
              mapArtifact={mapArtifact}
              imagePromptDraft={imagePromptDraft}
              setImagePromptDraft={setImagePromptDraft}
              imageNegativePromptDraft={imageNegativePromptDraft}
              setImageNegativePromptDraft={setImageNegativePromptDraft}
              isGeneratingMap={isGeneratingMap}
              prepareImagePrompt={prepareImagePrompt}
              generateImageFromPrompt={generateImageFromPrompt}
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
            secureStorageStatus={secureStorageStatus}
            sessionApiKey={sessionApiKey}
            setSessionApiKey={setSessionApiKey}
            saveProviderKey={saveProviderKey}
            forgetProviderKey={forgetProviderKey}
            testTextProvider={testTextProvider}
          />
        ) : null}

        {section === "settings" ? (
          <SettingsSection runtimeSettings={runtimeSettings} setRuntimeSettings={setRuntimeSettings} />
        ) : null}
      </section>

      {memoryOpen && activeCard ? <MemoryDrawer card={activeCard} close={() => setMemoryOpen(false)} /> : null}
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
  draft: string;
  setDraft: (draft: string) => void;
  sendMessage: () => Promise<void>;
  writeForMe: () => void;
  runtimeRunning: boolean;
  startRuntime: () => void;
  isGenerating: boolean;
  promptRuns: PromptRun[];
  ruleWarning: string | null;
  mapPrompt: string | null;
  mapArtifact: GeneratedMapArtifact | null;
  imagePromptDraft: string;
  setImagePromptDraft: (value: string) => void;
  imageNegativePromptDraft: string;
  setImageNegativePromptDraft: (value: string) => void;
  isGeneratingMap: boolean;
  prepareImagePrompt: () => void;
  generateImageFromPrompt: () => Promise<void>;
}) {
  const showMapPanel = props.activeCard.mapEnabled;
  const promptButtonLabel = props.activeCard.kind === "rpg" ? "Generate birdseye view" : "Generate image prompt";

  return (
    <div className={`runtime-chat-layout ${showMapPanel ? "" : "no-map"}`}>
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

        <div className="message-stream chat-transcript" role="log" aria-label="Chat transcript">
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
          {props.messages.length === 0 && props.runtimeRunning ? (
            <section className="empty-chat" aria-label="Empty chat">
              <MessageSquare size={28} />
              <h3>{props.activeCard.greeting || "Start the chat when you are ready."}</h3>
              <p>{props.activeCard.scenario || props.activeCard.summary}</p>
            </section>
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
              </header>
              <p>{message.content}</p>
            </article>
          ))}
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
              disabled={!props.runtimeRunning}
              rows={4}
              placeholder="Type what you want to say or do..."
            />
          </label>
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
              disabled={!props.draft.trim() || !props.runtimeRunning || props.isGenerating}
            >
              <Send size={16} />
              {props.isGenerating ? "Sending..." : "Send"}
            </button>
          </div>
        </form>
      </section>

      {showMapPanel ? (
        <section className="map-side-panel" aria-label="Map and image generator">
          <div className="section-title">
            <Map size={17} />
            <h3>{props.activeCard.kind === "rpg" ? "Map" : "Image"}</h3>
          </div>
          <button
            className="primary-button compact-button"
            type="button"
            onClick={props.prepareImagePrompt}
            disabled={!props.runtimeRunning}
          >
            <Image size={16} />
            {promptButtonLabel}
          </button>
          <label className="field">
            <span>Image prompt</span>
            <textarea
              value={props.imagePromptDraft}
              onChange={(event) => props.setImagePromptDraft(event.target.value)}
              rows={8}
              placeholder="Generate a prompt from the latest chat, then edit it before sending."
            />
          </label>
          <label className="field">
            <span>Negative prompt</span>
            <textarea
              value={props.imageNegativePromptDraft}
              onChange={(event) => props.setImageNegativePromptDraft(event.target.value)}
              rows={4}
              placeholder="Things to avoid in the image"
            />
          </label>
          <button
            className="secondary-button compact-button"
            type="button"
            onClick={() => void props.generateImageFromPrompt()}
            disabled={!props.imagePromptDraft.trim() || props.isGeneratingMap}
          >
            <Play size={16} />
            {props.isGeneratingMap ? "Generating..." : "Send to image provider"}
          </button>
          {props.mapArtifact ? (
            <div className="map-output" role="region" aria-label="Generated image">
              {props.mapArtifact.imageUrl ? (
                <img className="generated-map-image" src={props.mapArtifact.imageUrl} alt="Generated scene" />
              ) : (
                <div className="map-placeholder">
                  <Map size={42} />
                  <span>
                    {props.mapArtifact.status === "error"
                      ? "Image generation needs attention"
                      : "Prompt ready for image provider"}
                  </span>
                </div>
              )}
              <div className={`map-status ${props.mapArtifact.status}`}>
                <strong>{props.mapArtifact.status}</strong>
                <span>{props.mapArtifact.provider} / {props.mapArtifact.model}</span>
              </div>
              {props.mapArtifact.error ? <p className="rule-warning">{props.mapArtifact.error}</p> : null}
            </div>
          ) : props.mapPrompt ? (
            <div className="map-output" role="region" aria-label="Generated image prompt">
              <div className="map-placeholder">
                <Map size={42} />
                <span>Prompt ready to edit</span>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function NoActiveCardRuntimePanel(props: { openCards: () => void }) {
  return (
    <section className="panel empty-chat" aria-label="No active card">
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

function renderTabIcon(tab: CardTab) {
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
          {filteredLorebooks.length === 0 ? <p>No stored lorebooks match this search.</p> : null}
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
          Imported lorebooks are stored on the active card: <strong>{activeCard?.name ?? "No card open"}</strong>.
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
          <img src={profileImageUrl} alt="" />
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
      ) : (
        <section className="panel selected-card-panel" aria-label="Selected card editor">
          <div className="section-title">
            <Settings2 size={17} />
            <h3>No Card Open</h3>
          </div>
          <p>Choose Open on a saved card to edit it or run it.</p>
        </section>
      )}
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
  secureStorageStatus: SecureStorageStatus;
  sessionApiKey: string;
  setSessionApiKey: (value: string) => void;
  saveProviderKey: () => Promise<void>;
  forgetProviderKey: () => Promise<void>;
  testTextProvider: () => Promise<void>;
}) {
  const textModelChoices = getTextModelChoices(props.providerSettings);
  const imageModelChoices = withCurrentModelChoice(comfyUiModelChoices, props.imageProviderSettings.model);

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
        <div className="instruction-grid compact-fields">
          <label className="field">
            <span>Width</span>
            <input
              type="number"
              min={256}
              max={2048}
              step={64}
              value={props.imageProviderSettings.width}
              onChange={(event) =>
                props.setImageProviderSettings({
                  ...props.imageProviderSettings,
                  width: toBoundedNumber(event.target.value, 1024, 256, 2048),
                })
              }
            />
          </label>
          <label className="field">
            <span>Height</span>
            <input
              type="number"
              min={256}
              max={2048}
              step={64}
              value={props.imageProviderSettings.height}
              onChange={(event) =>
                props.setImageProviderSettings({
                  ...props.imageProviderSettings,
                  height: toBoundedNumber(event.target.value, 1024, 256, 2048),
                })
              }
            />
          </label>
          <label className="field">
            <span>Timeout ms</span>
            <input
              type="number"
              min={15_000}
              max={600_000}
              step={5_000}
              value={props.imageProviderSettings.pollTimeoutMs}
              onChange={(event) =>
                props.setImageProviderSettings({
                  ...props.imageProviderSettings,
                  pollTimeoutMs: toBoundedNumber(event.target.value, 120_000, 15_000, 600_000),
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
                  steps: toBoundedNumber(event.target.value, 20, 1, 150),
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
                  cfg: toBoundedFloat(event.target.value, 7, 1, 30),
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

function SettingsSection(props: {
  runtimeSettings: RuntimeSettings;
  setRuntimeSettings: (settings: RuntimeSettings) => void;
}) {
  return (
    <div className="workspace-grid settings-grid">
      <section className="panel" aria-label="Runtime settings">
        <div className="section-title">
          <Settings2 size={17} />
          <h3>Runtime Settings</h3>
        </div>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={props.runtimeSettings.textStreaming}
            onChange={(event) =>
              props.setRuntimeSettings({
                ...props.runtimeSettings,
                textStreaming: event.target.checked,
              })
            }
          />
          <span>Text streaming</span>
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={props.runtimeSettings.banEmojis}
            onChange={(event) =>
              props.setRuntimeSettings({
                ...props.runtimeSettings,
                banEmojis: event.target.checked,
              })
            }
          />
          <span>Ban emojis in model replies</span>
        </label>
        <label className="field">
          <span>Impersonation prompt</span>
          <textarea
            value={props.runtimeSettings.impersonationPrompt}
            onChange={(event) =>
              props.setRuntimeSettings({
                ...props.runtimeSettings,
                impersonationPrompt: event.target.value,
              })
            }
            rows={8}
            placeholder="Describe the user's persona, point of view, boundaries, or roleplay voice the card should account for."
          />
        </label>
      </section>
      <section className="panel" aria-label="Settings prompt preview">
        <div className="section-title">
          <Layers3 size={17} />
          <h3>Prompt Preview</h3>
        </div>
        <pre>{formatRuntimeSettingsForPrompt(props.runtimeSettings) || "(no runtime settings enabled)"}</pre>
      </section>
    </div>
  );
}

function MemoryDrawer(props: { card: RuntimeCard; close: () => void }) {
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

function parseChatSessions(
  value: unknown,
  cards: RuntimeCard[],
  flatMessages: Message[],
  activeCardId: string,
): ChatSession[] {
  const cardIds = new Set(cards.map((card) => card.id));
  const parsed = Array.isArray(value)
    ? value
        .filter(isRecord)
        .map((session): ChatSession | null => {
          const cardId = typeof session.cardId === "string" && cardIds.has(session.cardId) ? session.cardId : null;
          if (!cardId || typeof session.id !== "string") {
            return null;
          }
          const messages = sanitizeMessages(session.messages);
          return {
            id: session.id,
            cardId,
            title: typeof session.title === "string" && session.title.trim() ? session.title : deriveChatTitle(messages[0]?.content),
            branchOfId: typeof session.branchOfId === "string" ? session.branchOfId : undefined,
            branchedFromMessageId:
              typeof session.branchedFromMessageId === "string" ? session.branchedFromMessageId : undefined,
            createdAt: typeof session.createdAt === "string" ? session.createdAt : new Date().toISOString(),
            updatedAt: typeof session.updatedAt === "string" ? session.updatedAt : new Date().toISOString(),
            messages,
          };
        })
        .filter((session): session is ChatSession => Boolean(session))
    : [];

  const sessions = [...parsed];
  const migratedMessages = sanitizeMessages(flatMessages);
  for (const card of cards) {
    if (sessions.some((session) => session.cardId === card.id)) {
      continue;
    }
    sessions.push(
      createChatSession(card.id, `${card.name} chat`, {
        messages: card.id === activeCardId ? migratedMessages : [],
      }),
    );
  }

  return sessions;
}

function getStartupActiveCardId(
  snapshot: LocalRuntimeSnapshot<RuntimeCard, Message, PromptRun, ChatSession> | null,
  cards: RuntimeCard[],
): string {
  if (!snapshot || !cards.some((card) => card.id === snapshot.activeCardId)) {
    return "";
  }
  return snapshot.activeCardId === "card_blank_slate_rpg" ? "" : snapshot.activeCardId;
}

function parseActiveChatIds(
  value: unknown,
  cards: RuntimeCard[],
  chatSessions: ChatSession[],
  activeCardId: string,
): Record<string, string> {
  const parsed = isRecord(value) ? value : {};
  const activeIds: Record<string, string> = {};
  for (const card of cards) {
    const stored = typeof parsed[card.id] === "string" ? parsed[card.id] : "";
    const storedSession = chatSessions.find((session) => session.id === stored && session.cardId === card.id);
    const fallback = getCardChats(card.id, chatSessions)[0];
    if (storedSession || fallback) {
      activeIds[card.id] = storedSession?.id ?? fallback.id;
    }
  }
  if (!activeIds[activeCardId]) {
    const fallback = getCardChats(activeCardId, chatSessions)[0];
    if (fallback) {
      activeIds[activeCardId] = fallback.id;
    }
  }
  return activeIds;
}

function sanitizeMessages(value: unknown): Message[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isRecord)
    .map((message): Message | null => {
      if (
        typeof message.id !== "string" ||
        typeof message.content !== "string" ||
        (message.role !== "user" && message.role !== "assistant")
      ) {
        return null;
      }
      return {
        id: message.id,
        role: message.role,
        content: message.content,
      };
    })
    .filter((message): message is Message => Boolean(message));
}

function createChatSession(
  cardId: string,
  title: string,
  options: Partial<Pick<ChatSession, "id" | "branchOfId" | "branchedFromMessageId" | "messages">> = {},
): ChatSession {
  const now = new Date().toISOString();
  const messages = sanitizeMessages(options.messages ?? []);
  return {
    id: options.id ?? createRuntimeEntityId("chat"),
    cardId,
    title: title.trim() || deriveChatTitle(messages[0]?.content),
    branchOfId: options.branchOfId,
    branchedFromMessageId: options.branchedFromMessageId,
    createdAt: now,
    updatedAt: now,
    messages,
  };
}

function cloneMessagesForBranch(messages: Message[], branchId: string): Message[] {
  return messages.map((message, index) => ({
    ...message,
    id: `${message.id}__branch_${branchId}_${index}`,
  }));
}

function createRuntimeEntityId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${random.replace(/[^A-Za-z0-9_-]/g, "")}`;
}

function getCardChats(cardId: string, chatSessions: ChatSession[]): ChatSession[] {
  return chatSessions
    .filter((chat) => chat.cardId === cardId)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function getActiveChatForCard(
  cardId: string,
  chatSessions: ChatSession[],
  activeChatIds: Record<string, string>,
): ChatSession | undefined {
  const activeId = activeChatIds[cardId];
  return (
    chatSessions.find((chat) => chat.id === activeId && chat.cardId === cardId) ??
    getCardChats(cardId, chatSessions)[0]
  );
}

function upsertChatSession(current: ChatSession[], next: ChatSession): ChatSession[] {
  const found = current.some((chat) => chat.id === next.id);
  return found ? current.map((chat) => (chat.id === next.id ? next : chat)) : [...current, next];
}

function deriveChatTitle(value?: string): string {
  const cleaned = value?.trim();
  if (!cleaned) {
    return "New chat";
  }
  return cleaned.length > 48 ? `${cleaned.slice(0, 45)}...` : cleaned;
}

function buildWriteForMeDraft(card: RuntimeCard, messages: Message[]): string {
  const lastResponse = [...messages].reverse().find((message) => message.role === "assistant")?.content;
  if (card.kind === "rpg" && card.rpg) {
    const location = card.rpg.location || "the current area";
    const inventory = card.rpg.inventory.length > 0 ? ` using ${card.rpg.inventory[0]}` : "";
    return lastResponse
      ? `I study what just happened and take a careful next step in ${location}${inventory}.`
      : `I look around ${location}, checking for exits, threats, useful details, and anything my character can realistically do.`;
  }

  return lastResponse
    ? "I respond in a way that fits the relationship, the scenario, and what was just said."
    : "I start the conversation naturally, staying within this card's scenario and boundaries.";
}

function buildImagePromptRequest(card: RuntimeCard, messages: Message[]): Parameters<typeof compileImagePrompt>[0] {
  const recentStory = messages
    .filter((message) => message.role !== "system")
    .slice(-8)
    .map((message) => `${message.role === "user" ? "Player" : card.name}: ${message.content}`)
    .join(" | ");

  if (card.kind === "rpg" && card.rpg) {
    return {
      scene: `Birdseye view map for ${card.name}`,
      locationVisuals: [
        `current location: ${card.rpg.location || "unmapped area"}`,
        `known places: ${card.rpg.knownPlaces.join(", ") || "none established"}`,
        recentStory ? `story so far: ${recentStory}` : "",
      ]
        .filter(Boolean)
        .join("; "),
      currentAction: recentStory ? `latest exchange perspective: ${recentStory}` : undefined,
      mood: "clear tabletop reference, useful for navigation and play",
      camera: "top-down birdseye view",
      stylePreset: card.rpg.mapStyle,
      continuityLocks: [
        `health/status: ${card.rpg.health || "not configured"}`,
        `inventory: ${card.rpg.inventory.join(", ") || "none"}`,
        ...Object.entries(card.rpg.flags).map(([flag, value]) => `${flag}=${value}`),
      ],
      negativePrompt: ["first-person view", "unreadable labels", "random extra buildings", "cropped map", "blurry"],
      providerFormatting: "generic",
    };
  }

  return {
    scene: `Story image for ${card.name}`,
    locationVisuals: card.scenario || card.summary,
    characters: [
      {
        name: card.characterName || card.name,
        appearance: card.characterDescription || card.summary,
      },
    ],
    currentAction: recentStory ? `latest exchange perspective: ${recentStory}` : undefined,
    mood: "coherent in-world illustration, grounded in the established card",
    camera: "cinematic medium shot",
    stylePreset: "detailed story illustration, consistent character design",
    continuityLocks: [card.systemPrompt, card.preHistoryInstructions, card.postHistoryInstructions].filter(Boolean),
    negativePrompt: ["off-model character", "random extra characters", "unrelated setting", "blurry", "watermark"],
    providerFormatting: "generic",
  };
}

function normalizeRuntimeCards(cards: RuntimeCard[]): RuntimeCard[] {
  return cards.map((card) => ({
    ...card,
    characterName: card.characterName ?? card.name ?? "",
    characterDescription: card.characterDescription ?? "",
    scenario: card.scenario ?? "",
    greeting: card.greeting ?? "",
    exampleDialogs: card.exampleDialogs ?? "",
    mapEnabled: typeof card.mapEnabled === "boolean" ? card.mapEnabled : card.kind === "rpg",
    playerRules:
      card.playerRules.length > 0
        ? card.playerRules
        : card.kind === "rpg"
          ? createDefaultRpgPlayerRules()
          : createDefaultCharacterPlayerRules(),
    lorebooks: normalizeCardLorebooks(card),
    memory: card.memory ?? [],
    rpg:
      card.kind === "rpg"
        ? card.rpg ?? {
            location: "Unmapped starting area",
            health: "not configured",
            inventory: [],
            quests: [],
            flags: {},
            knownPlaces: [],
            mapStyle: "birdseye map, readable labels, clean cartographic layout",
          }
        : undefined,
  }));
}

function normalizeCardLorebooks(card: RuntimeCard): Lorebook[] {
  const lorebooks = Array.isArray(card.lorebooks) ? card.lorebooks : [];
  return lorebooks
    .filter((lorebook) => !isLegacyEmptyStarterLorebook(card, lorebook))
    .map((lorebook) => ({
      ...lorebook,
      entries: Array.isArray(lorebook.entries)
        ? lorebook.entries.map((entry) => ({
            ...entry,
            caseSensitive: entry.caseSensitive ?? false,
            wholeWord: entry.wholeWord ?? false,
            probability: entry.probability ?? 100,
          }))
        : [],
    }));
}

function isLegacyEmptyStarterLorebook(card: RuntimeCard, lorebook: Lorebook): boolean {
  return card.id === "card_blank_slate_rpg" && lorebook.entries.length === 0;
}

function parseProviderSettings(value?: Record<string, unknown>): ProviderSettings {
  const mode = value?.mode === "openai-compatible" ? "openai-compatible" : "mock";
  const providerId =
    typeof value?.providerId === "string" ? value.providerId : mode === "mock" ? "mock" : "alibaba-model-studio";
  const secretReference = parseSecretReference(value?.secretReference);
  const baseUrl = typeof value?.baseUrl === "string" ? value.baseUrl : defaultProviderSettings.baseUrl;
  const normalizedBaseUrl = normalizeProviderBaseUrlOrNull(baseUrl);
  return {
    mode,
    providerId,
    displayName:
      typeof value?.displayName === "string"
        ? value.displayName
        : mode === "mock"
          ? "Mock local runtime"
          : "Alibaba Cloud Model Studio / DashScope",
    baseUrl,
    model:
      typeof value?.model === "string"
        ? value.model
        : mode === "mock"
          ? "mock-narrator"
          : getDefaultTextModel(providerId),
    secretReference:
      secretReference?.providerId === providerId && secretReference.providerBaseUrl === normalizedBaseUrl
        ? secretReference
        : undefined,
  };
}

function getDefaultTextModel(providerId: string): string {
  if (providerId === "openrouter") {
    return openRouterModelChoices[0].id;
  }
  if (providerId === "mock") {
    return "mock-narrator";
  }
  return qwen37MaxReferencePreset.id;
}

function getTextModelChoices(settings: ProviderSettings): ModelChoice[] {
  if (settings.providerId === "openrouter") {
    return withCurrentModelChoice(openRouterModelChoices, settings.model);
  }
  if (settings.providerId === "mock") {
    return [{ id: "mock-narrator", label: "Mock Narrator" }];
  }
  return withCurrentModelChoice(alibabaModelChoices, settings.model);
}

function withCurrentModelChoice(choices: ModelChoice[], currentModel: string): ModelChoice[] {
  if (!currentModel || choices.some((choice) => choice.id === currentModel)) {
    return choices;
  }
  return [{ id: currentModel, label: currentModel }, ...choices];
}

function parseImageProviderSettings(value?: Record<string, unknown>): ImageProviderSettings {
  const mode = value?.mode === "prompt-only" ? "prompt-only" : "comfyui";
  return {
    mode,
    providerId: "comfyui",
    displayName: "ComfyUI local API",
    endpoint: typeof value?.endpoint === "string" ? value.endpoint : defaultImageProviderSettings.endpoint,
    model: typeof value?.model === "string" ? value.model : defaultImageProviderSettings.model,
    workflowJson: typeof value?.workflowJson === "string" ? value.workflowJson : defaultImageProviderSettings.workflowJson,
    width: toBoundedNumber(typeof value?.width === "number" ? value.width : "", 1024, 256, 2048),
    height: toBoundedNumber(typeof value?.height === "number" ? value.height : "", 1024, 256, 2048),
    seed: toBoundedNumber(typeof value?.seed === "number" ? value.seed : "", -1, -1, 2_147_483_647),
    steps: toBoundedNumber(typeof value?.steps === "number" ? value.steps : "", 20, 1, 150),
    cfg: toBoundedFloat(typeof value?.cfg === "number" ? value.cfg : "", 7, 1, 30),
    samplerName: typeof value?.samplerName === "string" ? value.samplerName : defaultImageProviderSettings.samplerName,
    scheduler: typeof value?.scheduler === "string" ? value.scheduler : defaultImageProviderSettings.scheduler,
    pollTimeoutMs: toBoundedNumber(
      typeof value?.pollTimeoutMs === "number" ? value.pollTimeoutMs : "",
      120_000,
      15_000,
      600_000,
    ),
  };
}

function parseRuntimeSettings(value?: Record<string, unknown>): RuntimeSettings {
  return {
    textStreaming: typeof value?.textStreaming === "boolean" ? value.textStreaming : defaultRuntimeSettings.textStreaming,
    banEmojis: typeof value?.banEmojis === "boolean" ? value.banEmojis : defaultRuntimeSettings.banEmojis,
    impersonationPrompt:
      typeof value?.impersonationPrompt === "string"
        ? value.impersonationPrompt
        : defaultRuntimeSettings.impersonationPrompt,
  };
}

function parseGeneratedMaps(value: unknown): GeneratedMapArtifact[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isRecord)
    .map((artifact) => ({
      ...artifact,
      chatId:
        typeof artifact.chatId === "string"
          ? artifact.chatId
          : typeof artifact.cardId === "string"
            ? `chat_${artifact.cardId}`
            : "",
    }))
    .filter(isGeneratedMapArtifact);
}

function isGeneratedMapArtifact(value: unknown): value is GeneratedMapArtifact {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.cardId === "string" &&
    typeof value.chatId === "string" &&
    typeof value.prompt === "string" &&
    typeof value.negativePrompt === "string" &&
    typeof value.provider === "string" &&
    typeof value.model === "string" &&
    (value.status === "prompt-only" || value.status === "generated" || value.status === "error") &&
    typeof value.createdAt === "string" &&
    (value.imageUrl === undefined || typeof value.imageUrl === "string") &&
    (value.error === undefined || typeof value.error === "string")
  );
}

function upsertGeneratedMap(current: GeneratedMapArtifact[], artifact: GeneratedMapArtifact): GeneratedMapArtifact[] {
  const withoutSameChat = current.filter(
    (candidate) => candidate.cardId !== artifact.cardId || candidate.chatId !== artifact.chatId,
  );
  return [...withoutSameChat, artifact].slice(-20);
}

function findGeneratedMapForChat(
  artifacts: GeneratedMapArtifact[],
  cardId: string,
  chatId: string | undefined,
): GeneratedMapArtifact | null {
  return (
    (chatId ? artifacts.find((artifact) => artifact.cardId === cardId && artifact.chatId === chatId) : undefined) ??
    artifacts.find((artifact) => artifact.cardId === cardId && artifact.chatId.startsWith(`chat_${cardId}`)) ??
    null
  );
}

function getAllowedProviderBaseUrl(settings: ProviderSettings): string | null {
  const normalized = normalizeProviderBaseUrlOrNull(settings.baseUrl);
  if (!normalized) {
    return null;
  }
  if (settings.providerId === "local") {
    return isLoopbackBaseUrl(normalized) ? normalized : null;
  }

  const knownHostedBaseUrls: Record<string, string> = {
    "alibaba-model-studio": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    openrouter: "https://openrouter.ai/api/v1",
  };
  const knownBaseUrl = knownHostedBaseUrls[settings.providerId];
  if (knownBaseUrl) {
    return normalized === knownBaseUrl ? normalized : null;
  }

  return null;
}

function normalizeProviderBaseUrlOrNull(value: string): string | null {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function isLoopbackBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function isHostedDesktopProvider(settings: ProviderSettings): boolean {
  return isTauriRuntime() && settings.providerId !== "local" && settings.mode !== "mock";
}

function createTextProvider(
  settings: ProviderSettings,
  sessionApiKey: string,
  card: RuntimeCard,
  draft: string,
  activeLoreCount: number,
) {
  if (settings.mode === "mock") {
    return new MockTextProvider({
      responses: [
        JSON.stringify({
          assistant_message: buildLocalProviderResponse(card, draft, activeLoreCount),
          extraction: buildMockExtractionProposal(card, draft),
        }),
      ],
    });
  }

  const baseUrl = getAllowedProviderBaseUrl(settings);
  if (!baseUrl) {
    throw new Error("Provider endpoint must be the known hosted URL or a loopback local endpoint.");
  }
  if (settings.providerId !== "local" && settings.secretReference) {
    return new TauriStoredSecretTextProvider({
      id: settings.providerId,
      displayName: settings.displayName,
      baseUrl,
      secretReference: settings.secretReference,
      models: [
        {
          ...qwen37MaxReferencePreset,
          id: settings.model,
          providerId: settings.providerId,
        },
      ],
    });
  }
  if (isHostedDesktopProvider(settings)) {
    throw new Error("Store this hosted provider key in the OS keychain before generation.");
  }

  return new OpenAICompatibleTextProvider({
    id: settings.providerId,
    displayName: settings.displayName,
    baseUrl,
    apiKey: sessionApiKey,
    allowUnauthenticated: settings.providerId === "local",
    models: [
      {
        ...qwen37MaxReferencePreset,
        id: settings.model,
        providerId: settings.providerId,
      },
    ],
  });
}

function toRepositorySnapshot(snapshot: AppRuntimeSnapshot): RepositoryRuntimeSnapshot {
  return snapshot as unknown as RepositoryRuntimeSnapshot;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatDetailedCharacterDefinition(card: RuntimeCard): string {
  return [
    card.characterName ? `Character name: ${card.characterName}` : "",
    card.characterDescription ? `Description:\n${card.characterDescription}` : "",
    card.scenario ? `Scenario:\n${card.scenario}` : "",
    card.greeting ? `Greeting:\n${card.greeting}` : "",
    card.exampleDialogs ? `Example dialogs:\n${card.exampleDialogs}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function formatRuntimeSettingsForPrompt(settings: RuntimeSettings): string {
  return [
    settings.banEmojis ? "Do not use emojis, emoticons, kaomoji, or decorative unicode faces in replies." : "",
    settings.impersonationPrompt.trim()
      ? `User impersonation/persona prompt:\n${settings.impersonationPrompt.trim()}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildResponseContract(settings: RuntimeSettings): string {
  return [
    "Write the in-card response.",
    "If state should change, imply only plausible proposals; the local app validates extraction before saving.",
    settings.banEmojis ? "Do not include emojis or emoticons in the response." : "",
    settings.impersonationPrompt.trim()
      ? `Account for this user impersonation/persona prompt without speaking as the user:\n${settings.impersonationPrompt.trim()}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildTurnPromptRequest(
  card: RuntimeCard,
  activeLorebookEntries: LorebookEntry[],
  messages: Message[],
  draft: string,
  runtimeSettings: RuntimeSettings,
  overrides: Partial<TurnPromptRequest> = {},
): TurnPromptRequest {
  return {
    session: {
      id: `session_${card.id}`,
      title: card.name,
      mode: card.kind,
      summary: card.summary,
    },
    card: {
      id: card.id,
      name: card.name,
      kind: card.kind,
      summary: card.summary,
      systemPrompt: card.systemPrompt,
      characterDefinition: formatDetailedCharacterDefinition(card),
      preHistoryInstructions: card.preHistoryInstructions,
      postHistoryInstructions: card.postHistoryInstructions,
    },
    messages,
    latestUserMessage: draft.trim() || "(empty)",
    rules: card.playerRules,
    memoryEntries: card.memory.map((entry) => ({
      id: entry.id,
      label: entry.label,
      detail: entry.detail,
    })),
    loreEntries: activeLorebookEntries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      content: entry.content,
      priority: entry.priority,
      enabled: entry.enabled,
    })),
    rpgState: card.rpg
      ? {
          id: `state_${card.id}`,
          location: card.rpg.location,
          health: card.rpg.health,
          inventory: card.rpg.inventory,
          quests: card.rpg.quests,
          knownPlaces: card.rpg.knownPlaces,
          flags: card.rpg.flags,
        }
      : null,
    knowledgeBoundaries:
      "Characters should only know what the card, active lore, memory, or current scene gives them reason to know.",
    tokenBudget: { maxInputTokens: 6_000, reservedOutputTokens: 900 },
    responseContract: buildResponseContract(runtimeSettings),
    preferStreaming: runtimeSettings.textStreaming,
    ...overrides,
  };
}

function buildLocalProviderResponse(card: RuntimeCard, draft: string, activeLoreCount: number): string {
  const cleanedDraft = draft.trim() || "The player hesitates.";
  if (card.kind === "rpg") {
    return [
      `The action is checked against ${card.name}'s active RPG rules before the scene moves.`,
      `Player action: ${cleanedDraft}`,
      activeLoreCount > 0
        ? `${activeLoreCount} lore entry applies, so the response keeps that continuity in view.`
        : "No lore entry fires, so the scene stays close to established state.",
      "Any location, item, health, or flag change is saved only after local validation.",
    ].join(" ");
  }

  return `${card.name} answers within this character card's scope: ${cleanedDraft}`;
}

function buildMockExtractionProposal(card: RuntimeCard, draft: string): unknown {
  const lower = draft.toLowerCase();
  const locationMatch = lower.match(/\b(?:go|move|travel|walk|head|enter)\s+(?:to|into|toward|through)\s+(?:the\s+)?([a-z0-9][a-z0-9 '-]{1,42})/i);
  const itemMatch = lower.match(/\b(?:take|pick up|collect|grab|loot)\s+(?:the\s+)?([a-z0-9][a-z0-9 '-]{1,36})/i);
  const location = locationMatch ? cleanExtractedPhrase(locationMatch[1]) : null;
  const item = itemMatch ? cleanExtractedPhrase(itemMatch[1]) : null;
  const worldFlags: Record<string, boolean | number | string> = {};

  if (/\b(open|unlock)\b.*\bgate\b/.test(lower)) {
    worldFlags.gate_open = true;
  }

  return {
    new_characters: [],
    updated_characters: [],
    new_events: [],
    character_knowledge_updates: [],
    relationship_updates: [],
    memory_updates: [],
    rpg_state_updates: {
      location: card.kind === "rpg" && location ? titleCase(location) : null,
      health_delta: 0,
      inventory_add: card.kind === "rpg" && item ? [item] : [],
      inventory_remove: [],
      quest_updates: [],
      world_flags: card.kind === "rpg" ? worldFlags : {},
    },
    image_prompt_opportunity: {
      should_generate: false,
      reason: null,
      visual_scene_summary: null,
    },
    continuity_warnings: [],
  };
}

function cleanExtractedPhrase(value: string): string {
  return value
    .split(/\s+(?:and|then|before|after)\s+|[.,;]/)[0]
    .trim();
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function createCustomPlayerRule(description: string, title = "Custom player rule"): PlayerRule {
  return {
    id: `rule_custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title,
    description,
    enabled: true,
    enforcement: "prompt_only",
  };
}

function getEnabledPlayerRules(card: RuntimeCard): PlayerRule[] {
  return card.playerRules.filter((rule) => rule.enabled);
}

function formatEnforcementLabel(enforcement: PlayerRuleEnforcement): string {
  switch (enforcement) {
    case "ignore_rules":
      return "Runtime guard: card boundaries";
    case "validated_state":
      return "Prompt guard: validated state";
    case "health_matters":
      return "Runtime guard: health";
    case "inventory_matters":
      return "Runtime guard: inventory";
    case "capability_limits":
      return "Runtime guard: capabilities";
    case "movement_plausibility":
      return "Runtime guard: movement";
    case "no_free_creation":
      return "Runtime guard: free state";
    case "prompt_only":
      return "Prompt guard";
  }
}

function ensureLorebooks(card: RuntimeCard): Lorebook[] {
  return card.lorebooks;
}

function createInitialLorebooks(cardId: string, requestedName: string): Lorebook[] {
  const name = requestedName.trim();
  return name ? [createEmptyLorebook(cardId, name)] : [];
}

function createEmptyLorebook(cardId: string, name: string): Lorebook {
  return {
    id: `lore_${cardId}_${Date.now()}`,
    name: name.trim() || "Card Lorebook",
    enabled: true,
    scanDepth: 4,
    tokenBudget: 800,
    recursiveScanning: false,
    entries: [],
  };
}

function filterLorebookEntries(entries: LorebookEntry[], query: string): LorebookEntry[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return entries;
  }

  return entries.filter((entry) => {
    const searchable = [
      entry.title,
      entry.content,
      entry.keys.join(" "),
      entry.secondaryKeys.join(" "),
      String(entry.priority),
      String(entry.insertionOrder),
    ]
      .join(" ")
      .toLowerCase();

    return searchable.includes(normalizedQuery);
  });
}

function exportLorebookAsChubJson(lorebook: Lorebook, card: RuntimeCard) {
  const payload = buildChubLorebookPayload(lorebook, card);
  const filename = `${slugify(lorebook.name || card.name)}-chub-lorebook.json`;
  downloadJson(filename, payload);
}

function buildChubLorebookPayload(lorebook: Lorebook, card: RuntimeCard) {
  return {
    name: lorebook.name,
    description: `Exported from Local Cards for ${card.name}.`,
    scan_depth: lorebook.scanDepth,
    token_budget: lorebook.tokenBudget,
    recursive_scanning: lorebook.recursiveScanning,
    extensions: {
      source: "local-cards",
      card_id: card.id,
      card_name: card.name,
      chub_compatible: true,
    },
    entries: lorebook.entries.map((entry) => ({
      name: entry.title,
      comment: entry.title,
      content: entry.content,
      keys: entry.keys,
      secondary_keys: entry.secondaryKeys,
      enabled: entry.enabled,
      constant: entry.constant,
      selective: entry.secondaryKeys.length > 0,
      selectiveLogic: 0,
      insertion_order: entry.insertionOrder,
      priority: entry.priority,
      probability: entry.probability,
      extensions: {
        source_entry_id: entry.id,
      },
    })),
  };
}

function parseChubLorebookPayload(rawJson: string): Lorebook {
  const payload = parseJsonRecordOrThrow(rawJson, "Chub lorebook JSON is invalid.");
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  const name = getPayloadString(payload.name) || getPayloadString(payload.title) || "Imported Chub Lorebook";

  return {
    id: `lore_import_${Date.now()}`,
    name,
    enabled: getPayloadBoolean(payload.enabled, true),
    scanDepth: getPayloadNumber(payload.scan_depth ?? payload.scanDepth, 4, 1, 30),
    tokenBudget: getPayloadNumber(payload.token_budget ?? payload.tokenBudget, 800, 100, 12_000),
    recursiveScanning: getPayloadBoolean(payload.recursive_scanning ?? payload.recursiveScanning, false),
    entries: entries
      .filter(isRecord)
      .map((entry, index): LorebookEntry => ({
        id: `lore_entry_import_${Date.now()}_${index}`,
        title: getPayloadString(entry.name) || getPayloadString(entry.title) || getPayloadString(entry.comment) || "Imported entry",
        keys: getPayloadStringArray(entry.keys),
        secondaryKeys: getPayloadStringArray(entry.secondary_keys ?? entry.secondaryKeys),
        content: getPayloadString(entry.content),
        insertionOrder: getPayloadNumber(entry.insertion_order ?? entry.insertionOrder, 100, 0, 10_000),
        priority: getPayloadNumber(entry.priority, 0, -100, 100),
        enabled: getPayloadBoolean(entry.enabled, true),
        constant: getPayloadBoolean(entry.constant, false),
        probability: getPayloadNumber(entry.probability, 100, 0, 100),
        caseSensitive: getPayloadBoolean(entry.case_sensitive ?? entry.caseSensitive, false),
        wholeWord: getPayloadBoolean(entry.whole_word ?? entry.wholeWord, false),
      }))
      .filter((entry) => entry.content.trim().length > 0),
  };
}

function readFileAsText(file: File): Promise<string> {
  if (typeof file.text === "function") {
    return file.text();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(new Error("Could not read Chub lorebook file.")));
    reader.readAsText(file);
  });
}

function parseJsonRecordOrThrow(value: string, message: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (isRecord(parsed)) {
      return parsed;
    }
  } catch {
    // fall through to shared error
  }
  throw new Error(message);
}

function getPayloadString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getPayloadNumber(value: unknown, fallback: number, min: number, max: number): number {
  return toBoundedNumber(typeof value === "number" || typeof value === "string" ? value : "", fallback, min, max);
}

function getPayloadBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function getPayloadStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return parseList(value);
  }
  return [];
}

function downloadJson(filename: string, payload: unknown) {
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "lorebook";
}

function parseList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatFlagsForInput(flags: Record<string, boolean>): string {
  return Object.entries(flags)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("\n");
}

function parseFlags(value: string): Record<string, boolean> {
  const flags: Record<string, boolean> = {};
  for (const line of value.split(/\n|,/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const [rawKey, rawValue = "true"] = trimmed.split("=");
    const key = rawKey.trim();
    if (!key) {
      continue;
    }

    flags[key] = rawValue.trim().toLowerCase() !== "false";
  }
  return flags;
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function toBoundedNumber(value: string | number, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function toBoundedFloat(value: string | number, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}
