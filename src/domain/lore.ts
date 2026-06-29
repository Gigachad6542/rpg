import type {
  CharacterId,
  EntityTimestamps,
  JsonObject,
  LorebookEntryId,
  LorebookId,
  ProfileId,
  RpgWorldId,
} from "./ids";
import type { KnowledgeType } from "./events";
import type { RelationshipMetric } from "./relationships";

export const LOREBOOK_SCOPES = ["global", "profile", "world", "chat", "character"] as const;

export type LorebookScope = (typeof LOREBOOK_SCOPES)[number];

export const LORE_ENTRY_STATUSES = ["enabled", "disabled", "archived"] as const;

export type LoreEntryStatus = (typeof LORE_ENTRY_STATUSES)[number];

export const LORE_TRIGGER_KINDS = [
  "keyword",
  "semantic_similarity",
  "current_location",
  "active_quest",
  "inventory_item",
  "character_knowledge",
  "relationship_threshold",
  "world_flag",
  "constant",
] as const;

export type LoreTriggerKind = (typeof LORE_TRIGGER_KINDS)[number];

export interface Lorebook extends EntityTimestamps {
  readonly id: LorebookId;
  readonly name: string;
  readonly scope: LorebookScope;
  readonly profileId?: ProfileId;
  readonly worldId?: RpgWorldId;
  readonly description?: string;
  readonly enabled: boolean;
  readonly entryCount?: number;
  readonly tags: readonly string[];
  readonly metadata?: JsonObject;
}

export interface KeywordLoreTrigger {
  readonly kind: "keyword";
  readonly terms: readonly string[];
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly scanDepth?: number;
  readonly secondaryRequiredTerms: readonly string[];
}

export interface SemanticLoreTrigger {
  readonly kind: "semantic_similarity";
  readonly query: string;
  readonly threshold: number;
}

export interface LocationLoreTrigger {
  readonly kind: "current_location";
  readonly location: string;
}

export interface ActiveQuestLoreTrigger {
  readonly kind: "active_quest";
  readonly questId: string;
}

export interface InventoryItemLoreTrigger {
  readonly kind: "inventory_item";
  readonly itemIdOrName: string;
}

export interface CharacterKnowledgeLoreTrigger {
  readonly kind: "character_knowledge";
  readonly characterId: CharacterId;
  readonly knowledgeType?: KnowledgeType;
  readonly requiredText?: string;
}

export interface RelationshipThresholdLoreTrigger {
  readonly kind: "relationship_threshold";
  readonly subjectId: string;
  readonly targetId: string;
  readonly metric: RelationshipMetric;
  readonly operator: "lt" | "lte" | "eq" | "gte" | "gt";
  readonly value: number;
}

export interface WorldFlagLoreTrigger {
  readonly kind: "world_flag";
  readonly flag: string;
  readonly expectedValue: string | number | boolean | null;
}

export interface ConstantLoreTrigger {
  readonly kind: "constant";
}

export type LoreTrigger =
  | KeywordLoreTrigger
  | SemanticLoreTrigger
  | LocationLoreTrigger
  | ActiveQuestLoreTrigger
  | InventoryItemLoreTrigger
  | CharacterKnowledgeLoreTrigger
  | RelationshipThresholdLoreTrigger
  | WorldFlagLoreTrigger
  | ConstantLoreTrigger;

export interface LorebookEntry extends EntityTimestamps {
  readonly id: LorebookEntryId;
  readonly lorebookId: LorebookId;
  readonly title: string;
  readonly status: LoreEntryStatus;
  readonly content: string;
  readonly triggers: readonly LoreTrigger[];
  readonly priority: number;
  readonly tokenBudget?: number;
  readonly probability: number;
  readonly recursiveScanning: boolean;
  readonly constant: boolean;
  readonly insertionPosition?: "before_history" | "after_history" | "author_note";
  readonly tags: readonly string[];
  readonly metadata?: JsonObject;
}
