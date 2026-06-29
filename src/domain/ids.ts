export type EntityId = string;
export type ISODateTime = string;
export type TokenCount = number;

export type ProfileId = EntityId;
export type PersonaId = EntityId;
export type CharacterId = EntityId;
export type CharacterVersionId = EntityId;
export type ChatId = EntityId;
export type MessageId = EntityId;
export type MessageBranchId = EntityId;
export type EventId = EntityId;
export type CharacterKnowledgeId = EntityId;
export type RelationshipId = EntityId;
export type MemoryEntryId = EntityId;
export type MemoryArchiveId = EntityId;
export type LorebookId = EntityId;
export type LorebookEntryId = EntityId;
export type RpgWorldId = EntityId;
export type RpgStateSnapshotId = EntityId;
export type PromptRunId = EntityId;
export type ImagePromptRunId = EntityId;
export type ModelProviderConfigId = EntityId;
export type ModelPresetId = EntityId;
export type SecretRef = string;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface EntityTimestamps {
  readonly createdAt: ISODateTime;
  readonly updatedAt: ISODateTime;
}

export interface ArchivableEntity {
  readonly archivedAt?: ISODateTime;
  readonly archiveReason?: string;
}

export interface SourceReference {
  readonly chatId?: ChatId;
  readonly branchId?: MessageBranchId;
  readonly messageId?: MessageId;
  readonly eventId?: EventId;
  readonly promptRunId?: PromptRunId;
  readonly note?: string;
}
