import type {
  CharacterId,
  EntityTimestamps,
  JsonObject,
  MessageBranchId,
  MessageId,
  ProfileId,
  RelationshipId,
} from "./ids";

export const RELATIONSHIP_SUBJECT_TYPES = [
  "profile",
  "persona",
  "character",
  "faction",
  "location",
  "world",
] as const;

export type RelationshipSubjectType = (typeof RELATIONSHIP_SUBJECT_TYPES)[number];

export const RELATIONSHIP_KINDS = [
  "character_user",
  "character_character",
  "character_faction",
  "faction_user",
  "faction_faction",
  "profile_world",
] as const;

export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number];

export const RELATIONSHIP_STATUSES = [
  "unknown",
  "stranger",
  "acquaintance",
  "ally",
  "companion",
  "rival",
  "enemy",
  "family",
  "romantic",
  "professional",
] as const;

export type RelationshipStatus = (typeof RELATIONSHIP_STATUSES)[number];

export const RELATIONSHIP_METRICS = [
  "trust",
  "respect",
  "familiarity",
  "affection",
  "hostility",
  "resentment",
  "fear",
  "loyalty",
  "debt",
  "romance",
] as const;

export type RelationshipMetric = (typeof RELATIONSHIP_METRICS)[number];

export type RelationshipScoreVector = Partial<Record<RelationshipMetric, number>>;

export interface RelationshipSubjectRef {
  readonly type: RelationshipSubjectType;
  readonly id: string;
}

export interface RelationshipRecord extends EntityTimestamps {
  readonly id: RelationshipId;
  readonly kind: RelationshipKind;
  readonly source: RelationshipSubjectRef;
  readonly target: RelationshipSubjectRef;
  readonly status: RelationshipStatus;
  readonly scores: RelationshipScoreVector;
  readonly summary?: string;
  readonly publicSummary?: string;
  readonly privateNotes?: string;
  readonly knownByCharacterIds: readonly CharacterId[];
  readonly sourceMessageId?: MessageId;
  readonly branchId?: MessageBranchId;
  readonly profileId?: ProfileId;
  readonly tags: readonly string[];
  readonly metadata?: JsonObject;
}
