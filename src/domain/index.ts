export const KNOWLEDGE_TYPES = [
  "witnessed",
  "participated",
  "was_told",
  "inferred",
  "rumor",
  "secret",
  "false_belief",
  "suspicion",
  "forbidden_knowledge",
] as const;

export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];

export const MEMORY_CATEGORIES = [
  "short_term",
  "rolling_summary",
  "pinned",
  "relationship",
  "world",
  "rpg_state",
  "style",
  "contradiction_log",
] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export const DEFAULT_PROMPT_LAYER_ORDER = [
  "global_runtime_rules",
  "mode_rules",
  "character_definition",
  "user_persona",
  "pre_history_directive",
  "long_term_memory",
  "active_lore",
  "rpg_state",
  "character_knowledge_boundaries",
  "social_expectation",
  "recent_chat_history",
  "latest_user_message",
  "post_history_directive",
  "assistant_prefill",
] as const;

export type PromptLayerId = (typeof DEFAULT_PROMPT_LAYER_ORDER)[number];

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type Id = string;
export type IsoDateString = string;
export type ChatMode = "chat" | "rpg" | "narrator" | "group_scene" | "image_prompt";
export const MESSAGE_ROLES = ["system", "user", "assistant", "tool", "narrator"] as const;

export type MessageRole = (typeof MESSAGE_ROLES)[number];
export type RelationshipSubjectType = "user" | "character" | "faction";
export type LoreTriggerType =
  | "keyword"
  | "semantic_similarity"
  | "location"
  | "active_quest"
  | "inventory_item"
  | "character_knowledge"
  | "relationship_threshold"
  | "world_flag";

export interface Profile {
  id: Id;
  displayName: string;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

export interface Persona {
  id: Id;
  profileId: Id;
  name: string;
  description: string;
  knownByCharacterIds: Id[];
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

export interface CharacterAppearance {
  age?: string;
  build?: string;
  hair?: string;
  clothing?: string;
  description?: string;
}

export interface CharacterRelationshipToUser {
  trust?: number;
  respect?: number;
  familiarity?: number;
  resentment?: number;
  affection?: number;
  hostility?: number;
}

export interface CharacterProfile {
  socialRole?: string;
  roleToUser?: string;
  appearance?: CharacterAppearance;
  abilities?: string[];
  personality?: {
    baseline?: string[];
    speechStyle?: string;
  };
  relationshipToUser?: CharacterRelationshipToUser;
  currentLocation?: string;
  obligations?: string[];
}

export interface Character {
  id: Id;
  name: string;
  description?: string;
  profile: CharacterProfile;
  introducedAt?: {
    messageId: Id;
    scene?: string;
    timeIndex?: number;
  };
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

export interface CharacterVersion {
  id: Id;
  characterId: Id;
  version: number;
  cardJson: JsonValue;
  changeReason?: string;
  createdAt: IsoDateString;
}

export interface Chat {
  id: Id;
  title: string;
  mode: ChatMode;
  activeBranchId: Id;
  profileId?: Id;
  worldId?: Id;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

export interface MessageBranch {
  id: Id;
  chatId: Id;
  rootMessageId: Id;
  headMessageId: Id;
  baseMessageId?: Id;
  label: string;
  isActive: boolean;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

export interface MessageNode {
  id: Id;
  chatId: Id;
  branchId: Id;
  parentMessageId?: Id;
  role: MessageRole;
  content: string;
  stateSnapshotId?: Id;
  promptRunId?: Id;
  authorCharacterId?: Id;
  tokenEstimate?: number;
  timeIndex?: number;
  createdAt: IsoDateString;
  updatedAt?: IsoDateString;
  metadata?: JsonValue;
}

export interface EventRecord {
  id: Id;
  chatId: Id;
  branchId?: Id;
  messageId?: Id;
  summary: string;
  occurredAt?: IsoDateString;
  location?: string;
  participantCharacterIds?: Id[];
  worldTruth: boolean;
  metadata?: JsonValue;
  createdAt: IsoDateString;
}

export interface CharacterKnowledgeRecord {
  id: Id;
  characterId: Id;
  eventId: Id;
  chatId?: Id;
  knowledgeType: KnowledgeType;
  certainty: number;
  interpretation: string;
  emotionalReaction?: string;
  canDiscussWith: string[];
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

export interface RelationshipRecord {
  id: Id;
  subjectType: RelationshipSubjectType;
  subjectId: Id;
  objectType: RelationshipSubjectType;
  objectId: Id;
  trust?: number;
  respect?: number;
  affection?: number;
  hostility?: number;
  debt?: string;
  secret?: string;
  notes?: string;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

export interface MemoryEntry {
  id: Id;
  chatId?: Id;
  category: MemoryCategory;
  text: string;
  importance: number;
  pinned: boolean;
  relatedCharacterIds: Id[];
  relatedEventIds: Id[];
  lastAccessedAt?: IsoDateString;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

export interface MemoryArchiveEntry extends MemoryEntry {
  archivedAt: IsoDateString;
  archiveReason: "decayed" | "consolidated" | "pruned" | "manual";
}

export interface Lorebook {
  id: Id;
  name: string;
  description?: string;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

export interface LorebookTrigger {
  type: LoreTriggerType;
  value: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  priority?: number;
  probability?: number;
  secondaryRequiredTerms?: string[];
}

export interface LorebookEntry {
  id: Id;
  lorebookId: Id;
  title: string;
  content: string;
  constant: boolean;
  tokenBudget?: number;
  scanDepth?: number;
  recursiveScanning?: boolean;
  triggers: LorebookTrigger[];
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

export const RPG_RULESET_STYLES = [
  "narrative_light",
  "dice_based",
  "stat_block",
  "custom",
] as const;

export type RpgRulesetStyle = (typeof RPG_RULESET_STYLES)[number];

export interface RpgWorld {
  id: Id;
  name: string;
  description?: string;
  ruleset?: "narrative_light" | "dice_stat" | "custom";
  rulesetStyle?: RpgRulesetStyle;
  systemPrompt?: string;
  startingLocation?: string;
  lorebookIds?: Id[];
  defaultCharacterIds?: Id[];
  worldFlags?: Record<string, string | number | boolean | null>;
  settings?: JsonValue;
  tags?: string[];
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

export interface RpgHealthState {
  current: number;
  max: number;
}

export interface RpgPlayerState {
  name: string;
  level?: number;
  health?: RpgHealthState;
  className?: string;
  stats?: Record<string, number>;
  resources?: Record<string, number>;
}

export interface RpgInventoryItem {
  id?: string;
  name: string;
  quantity: number;
  description?: string;
  equipped?: boolean;
  tags: string[];
}

export const RPG_QUEST_STATUSES = ["inactive", "active", "completed", "failed"] as const;

export type RpgQuestStatus = (typeof RPG_QUEST_STATUSES)[number];

export interface RpgQuestState {
  id: string;
  title: string;
  status: RpgQuestStatus;
  summary?: string;
  objectives: string[];
}

export interface RpgStateSnapshot {
  id: Id;
  worldId: Id;
  chatId: Id;
  branchId: Id;
  messageId?: Id;
  parentSnapshotId?: Id;
  player: RpgPlayerState;
  location: string;
  sceneSummary?: string;
  activeQuestIds: Id[];
  quests: RpgQuestState[];
  inventory: RpgInventoryItem[];
  companionCharacterIds: Id[];
  worldFlags: Record<string, boolean | number | string | null>;
  statusEffects: string[];
  injuries: string[];
  money?: number;
  metadata?: JsonValue;
  createdAt: IsoDateString;
}

export interface ImagePromptRun {
  id: Id;
  chatId: Id;
  messageId?: Id;
  provider?: string;
  compiledPrompt: string;
  negativePrompt?: string;
  stylePreset?: string;
  resultUri?: string;
  createdAt: IsoDateString;
}

export interface PromptRun {
  id: Id;
  chatId: Id;
  messageId?: Id;
  provider: string;
  model: string;
  temperature?: number;
  tokenBudget?: number;
  compiledPrompt: string;
  includedMemoryIds: Id[];
  includedLoreEntryIds: Id[];
  includedStateSnapshotId?: Id | null;
  responseText?: string;
  extractionJson?: JsonValue;
  stateChanges?: JsonValue;
  createdAt: IsoDateString;
}

export interface ModelInfo {
  id: string;
  displayName: string;
  providerId: string;
  contextWindow?: number;
  supportsStreaming?: boolean;
  supportsImages?: boolean;
  notes?: string;
}

export interface ModelProviderConfig {
  id: Id;
  providerId: string;
  displayName: string;
  baseUrl?: string;
  defaultModelId?: string;
  secretRef?: string;
  nonSecretSettings?: Record<string, JsonValue>;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

export interface RpgStateUpdates {
  location: string | null;
  healthDelta: number;
  inventoryAdd: string[];
  inventoryRemove: string[];
  questUpdates: JsonValue[];
  worldFlags: Record<string, boolean | number | string>;
}

export interface ImagePromptOpportunity {
  shouldGenerate: boolean;
  reason: string | null;
  visualSceneSummary: string | null;
}

export interface ExtractionResultPayload {
  schemaVersion: number;
  newCharacters: Character[];
  updatedCharacters: Partial<Character>[];
  newEvents: EventRecord[];
  characterKnowledgeUpdates: CharacterKnowledgeRecord[];
  relationshipUpdates: RelationshipRecord[];
  memoryUpdates: MemoryEntry[];
  rpgStateUpdates: RpgStateUpdates;
  imagePromptOpportunity: ImagePromptOpportunity;
  continuityWarnings: string[];
}

export function createMessageBranch(input: {
  id: Id;
  chatId: Id;
  rootMessageId: Id;
  headMessageId?: Id;
  baseMessageId?: Id;
  label?: string;
  isActive?: boolean;
  createdAt: IsoDateString;
  updatedAt?: IsoDateString;
}): MessageBranch {
  return {
    id: input.id,
    chatId: input.chatId,
    rootMessageId: input.rootMessageId,
    headMessageId: input.headMessageId ?? input.rootMessageId,
    baseMessageId: input.baseMessageId,
    label: input.label ?? "Main",
    isActive: input.isActive ?? true,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt ?? input.createdAt,
  };
}

export function createRpgStateSnapshot(input: {
  id: Id;
  worldId: Id;
  chatId: Id;
  branchId: Id;
  messageId?: Id;
  parentSnapshotId?: Id;
  player: RpgPlayerState;
  location: string;
  sceneSummary?: string;
  activeQuestIds?: Id[];
  quests?: RpgQuestState[];
  inventory?: RpgInventoryItem[];
  companionCharacterIds?: Id[];
  worldFlags?: Record<string, boolean | number | string | null>;
  statusEffects?: string[];
  injuries?: string[];
  money?: number;
  metadata?: JsonValue;
  createdAt: IsoDateString;
}): RpgStateSnapshot {
  return {
    id: input.id,
    worldId: input.worldId,
    chatId: input.chatId,
    branchId: input.branchId,
    messageId: input.messageId,
    parentSnapshotId: input.parentSnapshotId,
    player: input.player,
    location: input.location,
    sceneSummary: input.sceneSummary,
    activeQuestIds: input.activeQuestIds ?? [],
    quests: input.quests ?? [],
    inventory: input.inventory ?? [],
    companionCharacterIds: input.companionCharacterIds ?? [],
    worldFlags: input.worldFlags ?? {},
    statusEffects: input.statusEffects ?? [],
    injuries: input.injuries ?? [],
    money: input.money,
    metadata: input.metadata,
    createdAt: input.createdAt,
  };
}
