import type { CharacterProfile, CharacterVersion } from "./characters";
import type { CharacterKnowledgeRecord, EventRecord } from "./events";
import type {
  CharacterId,
  EventId,
  JsonObject,
  MemoryEntryId,
  MessageId,
  PromptRunId,
} from "./ids";
import type { MemoryEntry } from "./memory";
import type { RelationshipRecord } from "./relationships";

export const EXTRACTION_WARNING_TYPES = [
  "possible_contradiction",
  "low_confidence",
  "state_update_rejected",
  "knowledge_boundary_risk",
  "ambiguous_character",
] as const;

export type ExtractionWarningType = (typeof EXTRACTION_WARNING_TYPES)[number];

export interface ExtractedCharacterUpdate {
  readonly characterId: CharacterId;
  readonly version?: CharacterVersion;
  readonly patch: Partial<
    Pick<
      CharacterProfile,
      | "name"
      | "aliases"
      | "roleToUser"
      | "socialRole"
      | "appearance"
      | "abilities"
      | "personality"
      | "currentLocation"
      | "relationshipToUser"
      | "tags"
    >
  >;
  readonly reason?: string;
  readonly sourceMessageId?: MessageId;
}

export interface RpgQuestUpdatePayload {
  readonly questId?: string;
  readonly title?: string;
  readonly status?: "inactive" | "active" | "completed" | "failed";
  readonly objectiveAdd?: readonly string[];
  readonly objectiveComplete?: readonly string[];
  readonly summary?: string;
}

export interface RpgStateUpdatePayload {
  readonly location: string | null;
  readonly healthDelta: number;
  readonly inventoryAdd: readonly string[];
  readonly inventoryRemove: readonly string[];
  readonly questUpdates: readonly RpgQuestUpdatePayload[];
  readonly worldFlags: Record<string, string | number | boolean | null>;
  readonly proposedEventIds?: readonly EventId[];
  readonly notes?: string;
}

export interface ImagePromptOpportunity {
  readonly shouldGenerate: boolean;
  readonly reason: string | null;
  readonly visualSceneSummary: string | null;
}

export interface ContinuityWarning {
  readonly type: ExtractionWarningType;
  readonly message: string;
  readonly relatedMessageIds?: readonly MessageId[];
  readonly relatedMemoryIds?: readonly MemoryEntryId[];
  readonly severity: "info" | "warning" | "error";
}

export interface ExtractionResultPayload {
  readonly schemaVersion: 1;
  readonly promptRunId?: PromptRunId;
  readonly newCharacters: readonly CharacterProfile[];
  readonly updatedCharacters: readonly ExtractedCharacterUpdate[];
  readonly newEvents: readonly EventRecord[];
  readonly characterKnowledgeUpdates: readonly CharacterKnowledgeRecord[];
  readonly relationshipUpdates: readonly RelationshipRecord[];
  readonly memoryUpdates: readonly MemoryEntry[];
  readonly rpgStateUpdates: RpgStateUpdatePayload;
  readonly imagePromptOpportunity: ImagePromptOpportunity;
  readonly continuityWarnings: readonly ContinuityWarning[];
  readonly raw?: JsonObject;
}
