import type { ExtractionResultPayload } from "./extraction";
import type {
  CharacterId,
  ChatId,
  ImagePromptRunId,
  ISODateTime,
  JsonObject,
  LorebookEntryId,
  MemoryEntryId,
  MessageBranchId,
  MessageId,
  ModelProviderConfigId,
  PromptRunId,
  RpgStateSnapshotId,
  TokenCount,
} from "./ids";

export const PROMPT_LAYER_KINDS = [
  "global_runtime_rules",
  "mode_rules",
  "character_definition",
  "user_persona",
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

export type PromptLayerKind = (typeof PROMPT_LAYER_KINDS)[number];

export const DEFAULT_PROMPT_LAYER_ORDER: readonly PromptLayerKind[] = PROMPT_LAYER_KINDS;

export interface PromptLayer {
  readonly id: string;
  readonly kind: PromptLayerKind;
  readonly order: number;
  readonly content: string;
  readonly tokenEstimate?: TokenCount;
  readonly sourceIds: readonly string[];
  readonly enabled: boolean;
  readonly excludedReason?: string;
}

export const PROMPT_RUN_STATUSES = ["pending", "succeeded", "failed", "cancelled"] as const;

export type PromptRunStatus = (typeof PROMPT_RUN_STATUSES)[number];

export interface PromptRun {
  readonly id: PromptRunId;
  readonly chatId: ChatId;
  readonly branchId?: MessageBranchId;
  readonly messageId?: MessageId;
  readonly providerConfigId?: ModelProviderConfigId;
  readonly provider: string;
  readonly model: string;
  readonly temperature?: number;
  readonly tokenBudget?: TokenCount;
  readonly compiledPrompt: string;
  readonly layers: readonly PromptLayer[];
  readonly includedMemoryIds: readonly MemoryEntryId[];
  readonly includedLoreEntryIds: readonly LorebookEntryId[];
  readonly includedStateSnapshotId?: RpgStateSnapshotId;
  readonly includedCharacterIds: readonly CharacterId[];
  readonly responseText?: string;
  readonly extractionJson?: ExtractionResultPayload | JsonObject;
  readonly stateChangeSummary?: string;
  readonly status: PromptRunStatus;
  readonly errorMessage?: string;
  readonly createdAt: ISODateTime;
  readonly completedAt?: ISODateTime;
  readonly metadata?: JsonObject;
}

export const IMAGE_PROMPT_LAYER_KINDS = [
  "current_scene_summary",
  "location_visuals",
  "active_characters",
  "character_poses",
  "current_action",
  "mood",
  "lighting",
  "camera",
  "style_preset",
  "continuity_locks",
  "negative_prompt",
  "provider_formatting",
] as const;

export type ImagePromptLayerKind = (typeof IMAGE_PROMPT_LAYER_KINDS)[number];

export interface ImagePromptVisualCharacter {
  readonly characterId?: CharacterId;
  readonly name: string;
  readonly appearance: string;
  readonly pose?: string;
  readonly continuityLocks: readonly string[];
}

export interface ImagePromptVisualState {
  readonly scene: string;
  readonly locationVisuals?: string;
  readonly characters: readonly ImagePromptVisualCharacter[];
  readonly currentAction?: string;
  readonly mood?: string;
  readonly lighting?: string;
  readonly camera?: string;
  readonly style?: string;
  readonly continuityLocks: readonly string[];
}

export interface ImagePromptLayer {
  readonly kind: ImagePromptLayerKind;
  readonly content: string;
  readonly sourceIds: readonly string[];
}

export interface ImagePromptRun {
  readonly id: ImagePromptRunId;
  readonly chatId: ChatId;
  readonly branchId?: MessageBranchId;
  readonly messageId?: MessageId;
  readonly sourceStateSnapshotId?: RpgStateSnapshotId;
  readonly providerConfigId?: ModelProviderConfigId;
  readonly provider?: string;
  readonly model?: string;
  readonly promptOnly: boolean;
  readonly status: PromptRunStatus;
  readonly visualState: ImagePromptVisualState;
  readonly layers: readonly ImagePromptLayer[];
  readonly compiledPrompt: string;
  readonly negativePrompt?: string;
  readonly sourceCharacterIds: readonly CharacterId[];
  readonly sourceLoreEntryIds: readonly LorebookEntryId[];
  readonly resultImageUris: readonly string[];
  readonly errorMessage?: string;
  readonly createdAt: ISODateTime;
  readonly completedAt?: ISODateTime;
  readonly metadata?: JsonObject;
}
