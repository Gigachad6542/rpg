import type {
  CharacterId,
  ChatId,
  EntityTimestamps,
  ISODateTime,
  JsonObject,
  MessageBranchId,
  MessageId,
  RpgStateSnapshotId,
  RpgWorldId,
} from "./ids";

export const RPG_RULESET_STYLES = [
  "narrative_light",
  "dice_based",
  "stat_block",
  "custom",
] as const;

export type RpgRulesetStyle = (typeof RPG_RULESET_STYLES)[number];

export interface RpgWorld extends EntityTimestamps {
  readonly id: RpgWorldId;
  readonly name: string;
  readonly description?: string;
  readonly rulesetStyle: RpgRulesetStyle;
  readonly systemPrompt?: string;
  readonly startingLocation?: string;
  readonly lorebookIds: readonly string[];
  readonly defaultCharacterIds: readonly CharacterId[];
  readonly worldFlags: Record<string, string | number | boolean | null>;
  readonly settings?: JsonObject;
  readonly tags: readonly string[];
}

export interface RpgHealthState {
  readonly current: number;
  readonly max: number;
}

export interface RpgPlayerState {
  readonly name: string;
  readonly level?: number;
  readonly health?: RpgHealthState;
  readonly className?: string;
  readonly stats?: Record<string, number>;
  readonly resources?: Record<string, number>;
}

export interface RpgInventoryItem {
  readonly id?: string;
  readonly name: string;
  readonly quantity: number;
  readonly description?: string;
  readonly equipped?: boolean;
  readonly tags: readonly string[];
}

export const RPG_QUEST_STATUSES = ["inactive", "active", "completed", "failed"] as const;

export type RpgQuestStatus = (typeof RPG_QUEST_STATUSES)[number];

export interface RpgQuestState {
  readonly id: string;
  readonly title: string;
  readonly status: RpgQuestStatus;
  readonly summary?: string;
  readonly objectives: readonly string[];
}

export interface RpgStateSnapshot {
  readonly id: RpgStateSnapshotId;
  readonly worldId: RpgWorldId;
  readonly chatId: ChatId;
  readonly branchId: MessageBranchId;
  readonly messageId?: MessageId;
  readonly parentSnapshotId?: RpgStateSnapshotId;
  readonly createdAt: ISODateTime;
  readonly player: RpgPlayerState;
  readonly location: string;
  readonly sceneSummary?: string;
  readonly activeQuestIds: readonly string[];
  readonly quests: readonly RpgQuestState[];
  readonly inventory: readonly RpgInventoryItem[];
  readonly companionCharacterIds: readonly CharacterId[];
  readonly worldFlags: Record<string, string | number | boolean | null>;
  readonly statusEffects: readonly string[];
  readonly injuries: readonly string[];
  readonly money?: number;
  readonly metadata?: JsonObject;
}

export interface CreateRpgStateSnapshotInput {
  readonly id: RpgStateSnapshotId;
  readonly worldId: RpgWorldId;
  readonly chatId: ChatId;
  readonly branchId: MessageBranchId;
  readonly createdAt: ISODateTime;
  readonly player: RpgPlayerState;
  readonly location: string;
  readonly messageId?: MessageId;
  readonly parentSnapshotId?: RpgStateSnapshotId;
  readonly sceneSummary?: string;
  readonly activeQuestIds?: readonly string[];
  readonly quests?: readonly RpgQuestState[];
  readonly inventory?: readonly RpgInventoryItem[];
  readonly companionCharacterIds?: readonly CharacterId[];
  readonly worldFlags?: Record<string, string | number | boolean | null>;
  readonly statusEffects?: readonly string[];
  readonly injuries?: readonly string[];
  readonly money?: number;
  readonly metadata?: JsonObject;
}

export function createRpgStateSnapshot(input: CreateRpgStateSnapshotInput): RpgStateSnapshot {
  return {
    id: input.id,
    worldId: input.worldId,
    chatId: input.chatId,
    branchId: input.branchId,
    messageId: input.messageId,
    parentSnapshotId: input.parentSnapshotId,
    createdAt: input.createdAt,
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
  };
}
