import type {
  CharacterId,
  CharacterVersionId,
  EntityTimestamps,
  ISODateTime,
  JsonObject,
  MessageId,
  ModelPresetId,
  ProfileId,
} from "./ids";
import type { RelationshipScoreVector } from "./relationships";

export const CHARACTER_ORIGINS = [
  "user_created",
  "auto_extracted",
  "imported",
  "system",
] as const;

export type CharacterOrigin = (typeof CHARACTER_ORIGINS)[number];

export const CHARACTER_VISIBILITIES = ["active", "hidden", "archived"] as const;

export type CharacterVisibility = (typeof CHARACTER_VISIBILITIES)[number];

export interface CharacterIntroduction {
  readonly messageId: MessageId;
  readonly scene?: string;
  readonly timeIndex?: number;
  readonly introducedAt?: ISODateTime;
}

export interface CharacterAppearance {
  readonly age?: string;
  readonly build?: string;
  readonly hair?: string;
  readonly eyes?: string;
  readonly clothing?: string;
  readonly distinguishingFeatures?: readonly string[];
  readonly visualPrompt?: string;
  readonly metadata?: JsonObject;
}

export interface CharacterPersonality {
  readonly baseline: readonly string[];
  readonly speechStyle?: string;
  readonly values?: readonly string[];
  readonly fears?: readonly string[];
  readonly habits?: readonly string[];
  readonly dislikes?: readonly string[];
}

export interface CharacterProfile extends EntityTimestamps {
  readonly id: CharacterId;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly origin: CharacterOrigin;
  readonly visibility: CharacterVisibility;
  readonly currentVersionId?: CharacterVersionId;
  readonly ownerProfileId?: ProfileId;
  readonly introducedAt?: CharacterIntroduction;
  readonly roleToUser?: string;
  readonly socialRole?: string;
  readonly appearance?: CharacterAppearance;
  readonly abilities: readonly string[];
  readonly personality?: CharacterPersonality;
  readonly currentLocation?: string;
  readonly relationshipToUser?: RelationshipScoreVector;
  readonly tags: readonly string[];
  readonly metadata?: JsonObject;
}

export type Character = CharacterProfile;

export interface CharacterDialogueExample {
  readonly user?: string;
  readonly character: string;
  readonly context?: string;
}

export interface CharacterVersion extends EntityTimestamps {
  readonly id: CharacterVersionId;
  readonly characterId: CharacterId;
  readonly versionNumber: number;
  readonly name: string;
  readonly summary?: string;
  readonly definitionPrompt: string;
  readonly preHistoryDirective?: string;
  readonly postHistoryDirective?: string;
  readonly firstMessage?: string;
  readonly exampleDialogues: readonly CharacterDialogueExample[];
  readonly appearance?: CharacterAppearance;
  readonly personality?: CharacterPersonality;
  readonly modelPresetId?: ModelPresetId;
  readonly createdFromMessageId?: MessageId;
  readonly changeReason?: string;
  readonly metadata?: JsonObject;
}
