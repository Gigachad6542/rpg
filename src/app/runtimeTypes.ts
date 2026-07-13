// Shared runtime domain types for the app shell.
//
// These were previously declared inline in App.tsx. They are extracted here so
// the App component, its presentational panels, and the pure helper modules can
// share one definition instead of a single 7k-line file owning everything.

import type { StoryEntity } from "../runtime/hiddenContinuity";
import type { HiddenContinuityMode } from "../runtime/hiddenContinuityPolicy";
import type {
  ModelCallCost,
  ModelCallFailure,
  ModelPricingSnapshot,
} from "../runtime/modelCallTelemetry";
import type { ModelCallBudgetSource } from "../runtime/modelCallBudget";
import type { AuthoritativeEventStream } from "../runtime/authoritativeEventStream";
import type { RollingSummary } from "../runtime/rollingSummary";
import type { HybridRetrievalVisibility, RetrievalProvenance } from "../runtime/hybridRetrieval";
import type { LoreMatchMode, LoreScanScope } from "../runtime/loreTriggerEngine";
import type { PlayerRuleDefinition } from "../runtime/playerRuleEngine";
import type { RunTurnPipelineRequest } from "../runtime/turnPipeline";
import type { RuntimeTurnLineage } from "../runtime/runtimeTurnLineage";
import type { SecretReference } from "../security/keyStorage";
import type { LocalRuntimeSnapshot } from "./localRuntimeStore";
import type { TurnEffectProposal } from "./turnEffects";

export type Theme = "light" | "dark";
export type MainSection = "runtime" | "cards" | "lorebooks" | "providers" | "settings";
export type CardKind = "character" | "rpg";
export type CardTab = "chat" | "instructions" | "rules" | "lorebooks" | "rpg" | "map";
export type TextProviderMode = "mock" | "openai-compatible";
export type ImageProviderMode = "prompt-only" | "comfyui";
export type PortraitGenerationMode = "auto" | "confirm-first" | "off";

/** Where an imported card originated, for provenance and round-tripping. */
export type CardImportSource = "manual" | "tavern-png" | "tavern-json" | "chub";

export type RuntimeCard = {
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
  storyEntities: StoryEntity[];
  mapEnabled: boolean;
  rpg?: RpgCardState;
  /** Tavern/Chub character-card metadata, populated on import. All optional for back-compat. */
  alternateGreetings?: string[];
  creatorNotes?: string;
  tags?: string[];
  creator?: string;
  characterVersion?: string;
  /** Card avatar embedded as a `data:image/png;base64,...` URL. */
  avatarDataUrl?: string;
  importSource?: CardImportSource;
};

export type PlayerRule = PlayerRuleDefinition;

/**
 * A saved profile for the player's side of a scene. Replaces the single
 * `impersonationPrompt` string that RuntimeSettings used to carry.
 */
export type Persona = {
  id: string;
  name: string;
  /** The impersonation/persona prompt the card should account for. */
  description: string;
  /** Persona avatar embedded as a `data:image/png;base64,...` URL. */
  avatarDataUrl?: string;
  /** Lorebooks that only fire while this persona is active. */
  lorebooks: Lorebook[];
  isDefault: boolean;
};

export type Lorebook = {
  id: string;
  name: string;
  enabled: boolean;
  scanDepth: number;
  tokenBudget: number;
  recursiveScanning: boolean;
  entries: LorebookEntry[];
};

export type { LoreMatchMode, LoreScanScope };

export type LorebookEntry = {
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
  /** Absent means `literal`, the only mode that existed before match modes. */
  matchMode?: LoreMatchMode;
  /** Absent or empty means `DEFAULT_LORE_SCAN_SCOPES`. */
  scanScopes?: LoreScanScope[];
};

export type NewLorebookEntry = {
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
  matchMode: LoreMatchMode;
  scanScopes: LoreScanScope[];
};

export type NewPlayerRule = {
  title: string;
  description: string;
};

export type RpgCardState = {
  location: string;
  health: string;
  inventory: string[];
  quests: string[];
  flags: Record<string, boolean>;
  knownPlaces: string[];
  mapStyle: string;
};

export type MemoryEntry = {
  id: string;
  label: string;
  detail: string;
  /** Persisted retrieval provenance; legacy/manual entries default to card-global. */
  retrievalScope?: RetrievalProvenance;
  visibility?: HybridRetrievalVisibility;
};

export type Message = {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  /** Alternate generations for this message; content mirrors variants[activeVariantIndex]. */
  variants?: string[];
  activeVariantIndex?: number;
  /** Prompt-run IDs parallel to variants, or the sole generation for this message. */
  promptRunId?: string;
  variantRunIds?: string[];
  /** Variant indices whose state effects were explicitly undone in this branch. */
  undoneVariantIndices?: number[];
};

export type ChatSession = {
  id: string;
  cardId: string;
  title: string;
  branchOfId?: string;
  branchedFromMessageId?: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
  /** Immutable chat root plus per-assistant-variant state effects. */
  turnLineage?: RuntimeTurnLineage;
  /** Append-only typed authority log for deterministic actions, tools, and committed state. */
  authoritativeEvents?: AuthoritativeEventStream;
  /** Local branch-scoped summary of history outside the recent-message window. */
  rollingSummary?: RollingSummary;
};

export type ModelCallRecord = {
  phase: "hidden-continuity" | "visible-response";
  provider: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  /** Maximum input-token allowance for this phase; absent on legacy prompt runs. */
  inputBudgetTokens?: number;
  /** Effective provider/model context envelope used to derive the phase budget. */
  effectiveContextWindowTokens?: number;
  budgetSource?: ModelCallBudgetSource;
  durationMs: number;
  status: "success" | "error";
  /** Provider when returned by the adapter; unavailable for failed attempts. */
  usageSource?: "provider" | "estimated" | "unavailable";
  cost?: ModelCallCost;
  failure?: ModelCallFailure;
  /** Validated state proposals attributed to this phase. */
  stateProposalCount?: number;
};

export type PromptRun = {
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
  stateProposals?: TurnEffectProposal[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  /** The intentional hidden-continuity and visible-response calls for this turn. */
  modelCalls?: ModelCallRecord[];
  blockedReason?: string;
};

export type ProviderSettings = {
  mode: TextProviderMode;
  providerId: string;
  displayName: string;
  baseUrl: string;
  model: string;
  /** Exact selected-model metadata supplied by a preset, local server, or user. */
  contextWindowTokens?: number;
  maxOutputTokens?: number;
  /** User-supplied immutable price snapshot for the exact selected model. */
  pricing?: ModelPricingSnapshot;
  secretReference?: SecretReference;
};

export type ImageProviderSettings = {
  mode: ImageProviderMode;
  portraitGenerationMode: PortraitGenerationMode;
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

export type RuntimeSettings = {
  textStreaming: boolean;
  banEmojis: boolean;
  promptDebugLogs: boolean;
  diceRollsEnabled: boolean;
  /** Optional only for legacy in-memory callers; persisted settings normalize it to `full`. */
  hiddenContinuityMode?: HiddenContinuityMode;
  economicalModel?: string;
  onboardingCompleted: boolean;
  accentColor: string;
};

export type ModelChoice = {
  id: string;
  label: string;
};

export type GeneratedImageKind = "map" | "photo" | "character";

export type GeneratedMapArtifact = {
  id: string;
  imageKind: GeneratedImageKind;
  cardId: string;
  chatId: string;
  subjectId?: string;
  subjectName?: string;
  prompt: string;
  negativePrompt: string;
  provider: string;
  model: string;
  status: "prompt-only" | "generated" | "error";
  imageUrl?: string;
  error?: string;
  userInput?: string;
  createdAt: string;
};

export type MediaPreviewArtifact = {
  artifact: GeneratedMapArtifact;
  label: string;
};

export type AppRuntimeSnapshot = LocalRuntimeSnapshot<RuntimeCard, Message, PromptRun, ChatSession> & {
  providerSettings: ProviderSettings;
  imageProviderSettings: ImageProviderSettings;
  runtimeSettings: RuntimeSettings;
  personas: Persona[];
  activePersonaId: string;
  generatedMaps: GeneratedMapArtifact[];
  chatSessions: ChatSession[];
  activeChatIds: Record<string, string>;
};

export type TurnPromptRequest = Omit<RunTurnPipelineRequest, "modelAdapter" | "model">;
