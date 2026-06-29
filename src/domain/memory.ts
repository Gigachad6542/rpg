import type {
  CharacterId,
  ChatId,
  EntityTimestamps,
  EventId,
  ISODateTime,
  JsonObject,
  MemoryArchiveId,
  MemoryEntryId,
  MessageBranchId,
  MessageId,
  ProfileId,
  RpgWorldId,
} from "./ids";

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

export const MEMORY_STATUSES = ["active", "archived", "pruned", "superseded"] as const;

export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export const MEMORY_IMPORTANCE_LEVELS = ["low", "medium", "high", "critical"] as const;

export type MemoryImportance = (typeof MEMORY_IMPORTANCE_LEVELS)[number];

export interface MemoryEntryBase extends EntityTimestamps {
  readonly id: MemoryEntryId;
  readonly category: MemoryCategory;
  readonly status: MemoryStatus;
  readonly profileId?: ProfileId;
  readonly chatId?: ChatId;
  readonly branchId?: MessageBranchId;
  readonly worldId?: RpgWorldId;
  readonly characterId?: CharacterId;
  readonly eventIds: readonly EventId[];
  readonly sourceMessageIds: readonly MessageId[];
  readonly text: string;
  readonly importance: MemoryImportance;
  readonly priority: number;
  readonly confidence: number;
  readonly lastAccessedAt?: ISODateTime;
  readonly expiresAt?: ISODateTime;
  readonly pinned: boolean;
  readonly tags: readonly string[];
  readonly metadata?: JsonObject;
}

export interface ShortTermMemoryEntry extends MemoryEntryBase {
  readonly category: "short_term";
  readonly turnWindow?: number;
}

export interface RollingSummaryMemoryEntry extends MemoryEntryBase {
  readonly category: "rolling_summary";
  readonly coveredMessageIds: readonly MessageId[];
}

export interface PinnedMemoryEntry extends MemoryEntryBase {
  readonly category: "pinned";
  readonly pinned: true;
  readonly protectedReason?: string;
}

export interface RelationshipMemoryEntry extends MemoryEntryBase {
  readonly category: "relationship";
  readonly relationshipId?: string;
}

export interface WorldMemoryEntry extends MemoryEntryBase {
  readonly category: "world";
}

export interface RpgStateMemoryEntry extends MemoryEntryBase {
  readonly category: "rpg_state";
  readonly statePath?: string;
}

export interface StyleMemoryEntry extends MemoryEntryBase {
  readonly category: "style";
  readonly appliesToCharacterId?: CharacterId;
}

export interface ContradictionLogMemoryEntry extends MemoryEntryBase {
  readonly category: "contradiction_log";
  readonly correctedMemoryId?: MemoryEntryId;
  readonly correction?: string;
}

export type MemoryEntry =
  | ShortTermMemoryEntry
  | RollingSummaryMemoryEntry
  | PinnedMemoryEntry
  | RelationshipMemoryEntry
  | WorldMemoryEntry
  | RpgStateMemoryEntry
  | StyleMemoryEntry
  | ContradictionLogMemoryEntry;

export const MEMORY_ARCHIVE_REASONS = [
  "decayed",
  "consolidated",
  "pruned",
  "user_archived",
  "superseded",
] as const;

export type MemoryArchiveReason = (typeof MEMORY_ARCHIVE_REASONS)[number];

export interface MemoryArchiveEntry extends EntityTimestamps {
  readonly id: MemoryArchiveId;
  readonly memoryEntryId: MemoryEntryId;
  readonly reason: MemoryArchiveReason;
  readonly archivedText: string;
  readonly compressedSummary?: string;
  readonly retainedFactIds: readonly string[];
  readonly archivedAt: ISODateTime;
  readonly metadata?: JsonObject;
}

export type MemoryArchive = MemoryArchiveEntry;
