// Shared runtime domain types for the app shell.
//
// These were previously declared inline in App.tsx. They are extracted here so
// the App component, its presentational panels, and the pure helper modules can
// share one definition instead of a single 7k-line file owning everything.

import type { StoryEntity } from "../runtime/hiddenContinuity";
import type { PlayerRuleDefinition } from "../runtime/playerRuleEngine";
import type { RunTurnPipelineRequest } from "../runtime/turnPipeline";
import type { SecretReference } from "../security/keyStorage";
import type { LocalRuntimeSnapshot } from "./localRuntimeStore";

export type Theme = "light" | "dark";
export type MainSection = "runtime" | "cards" | "lorebooks" | "providers" | "settings";
export type CardKind = "character" | "rpg";
export type CardTab = "chat" | "instructions" | "rules" | "lorebooks" | "rpg" | "map";
export type TextProviderMode = "mock" | "openai-compatible";
export type ImageProviderMode = "prompt-only" | "comfyui";

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
};

export type Message = {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  /** Alternate generations for this message; content mirrors variants[activeVariantIndex]. */
  variants?: string[];
  activeVariantIndex?: number;
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
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  blockedReason?: string;
};

export type ProviderSettings = {
  mode: TextProviderMode;
  providerId: string;
  displayName: string;
  baseUrl: string;
  model: string;
  secretReference?: SecretReference;
};

export type ImageProviderSettings = {
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

export type RuntimeSettings = {
  textStreaming: boolean;
  banEmojis: boolean;
  promptDebugLogs: boolean;
  diceRollsEnabled: boolean;
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
