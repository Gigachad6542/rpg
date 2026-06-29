import type {
  CharacterId,
  CharacterKnowledgeId,
  ChatId,
  EntityTimestamps,
  EventId,
  JsonObject,
  MessageBranchId,
  MessageId,
  RpgWorldId,
} from "./ids";

export const EVENT_KINDS = [
  "scene",
  "dialogue",
  "character_introduced",
  "relationship_change",
  "knowledge_change",
  "memory_update",
  "rpg_state_change",
  "lore_triggered",
  "image_prompt",
  "system",
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

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

export const KNOWLEDGE_AUDIENCES = [
  "user",
  "self",
  "party",
  "household_staff",
  "public",
  "private",
  "faction",
  "none",
] as const;

export type KnowledgeAudience = (typeof KNOWLEDGE_AUDIENCES)[number] | (string & {});

export interface EventFact {
  readonly subject: string;
  readonly predicate: string;
  readonly object?: string;
  readonly certainty?: number;
}

export interface EventRecordBase extends EntityTimestamps {
  readonly id: EventId;
  readonly chatId?: ChatId;
  readonly branchId?: MessageBranchId;
  readonly messageId?: MessageId;
  readonly worldId?: RpgWorldId;
  readonly timeIndex?: number;
  readonly title: string;
  readonly summary: string;
  readonly location?: string;
  readonly actorCharacterIds: readonly CharacterId[];
  readonly participantCharacterIds: readonly CharacterId[];
  readonly facts: readonly EventFact[];
  readonly tags: readonly string[];
  readonly metadata?: JsonObject;
}

export interface NarrativeEventRecord extends EventRecordBase {
  readonly kind: "scene" | "dialogue" | "system";
  readonly payload?: JsonObject;
}

export interface CharacterIntroducedEventRecord extends EventRecordBase {
  readonly kind: "character_introduced";
  readonly introducedCharacterId: CharacterId;
}

export interface RelationshipChangeEventRecord extends EventRecordBase {
  readonly kind: "relationship_change";
  readonly relationshipId: string;
  readonly previousScores?: JsonObject;
  readonly newScores?: JsonObject;
}

export interface KnowledgeChangeEventRecord extends EventRecordBase {
  readonly kind: "knowledge_change";
  readonly knowledgeRecordIds: readonly CharacterKnowledgeId[];
}

export interface ContinuityEventRecord extends EventRecordBase {
  readonly kind: "memory_update" | "rpg_state_change" | "lore_triggered" | "image_prompt";
  readonly payload?: JsonObject;
}

export type EventRecord =
  | NarrativeEventRecord
  | CharacterIntroducedEventRecord
  | RelationshipChangeEventRecord
  | KnowledgeChangeEventRecord
  | ContinuityEventRecord;

export interface CharacterKnowledgeRecord extends EntityTimestamps {
  readonly id: CharacterKnowledgeId;
  readonly characterId: CharacterId;
  readonly eventId?: EventId;
  readonly chatId?: ChatId;
  readonly branchId?: MessageBranchId;
  readonly worldId?: RpgWorldId;
  readonly knowledgeType: KnowledgeType;
  readonly certainty: number;
  readonly interpretation: string;
  readonly emotionalReaction?: string;
  readonly canDiscussWith: readonly KnowledgeAudience[];
  readonly sourceMessageId?: MessageId;
  readonly contradictoryKnowledgeId?: CharacterKnowledgeId;
  readonly expiresAt?: string;
  readonly metadata?: JsonObject;
}
