import type {
  ChatId,
  CharacterId,
  EntityTimestamps,
  ISODateTime,
  JsonObject,
  MessageBranchId,
  MessageId,
  ModelPresetId,
  PersonaId,
  ProfileId,
  PromptRunId,
  RpgStateSnapshotId,
  RpgWorldId,
} from "./ids";

export const CHAT_MODES = ["chat", "rpg", "narrator", "group_scene", "image_prompt"] as const;

export type ChatMode = (typeof CHAT_MODES)[number];

export const MESSAGE_ROLES = ["system", "user", "assistant", "tool", "narrator"] as const;

export type MessageRole = (typeof MESSAGE_ROLES)[number];

export interface ChatSession extends EntityTimestamps {
  readonly id: ChatId;
  readonly title: string;
  readonly mode: ChatMode;
  readonly profileId: ProfileId;
  readonly personaId?: PersonaId;
  readonly worldId?: RpgWorldId;
  readonly activeBranchId?: MessageBranchId;
  readonly activeCharacterIds: readonly CharacterId[];
  readonly defaultModelPresetId?: ModelPresetId;
  readonly summary?: string;
  readonly tags: readonly string[];
  readonly metadata?: JsonObject;
}

export type Chat = ChatSession;

export interface MessageNode {
  readonly id: MessageId;
  readonly chatId: ChatId;
  readonly branchId: MessageBranchId;
  readonly parentMessageId?: MessageId;
  readonly role: MessageRole;
  readonly content: string;
  readonly stateSnapshotId?: RpgStateSnapshotId;
  readonly promptRunId?: PromptRunId;
  readonly authorCharacterId?: CharacterId;
  readonly tokenEstimate?: number;
  readonly timeIndex?: number;
  readonly createdAt: ISODateTime;
  readonly updatedAt?: ISODateTime;
  readonly metadata?: JsonObject;
}

export interface MessageBranch extends EntityTimestamps {
  readonly id: MessageBranchId;
  readonly chatId: ChatId;
  readonly label: string;
  readonly rootMessageId: MessageId;
  readonly parentBranchId?: MessageBranchId;
  readonly forkedFromMessageId?: MessageId;
  readonly headMessageId: MessageId;
  readonly isActive: boolean;
  readonly stateSnapshotId?: RpgStateSnapshotId;
  readonly archivedAt?: ISODateTime;
  readonly metadata?: JsonObject;
}

export interface CreateMessageBranchInput {
  readonly id: MessageBranchId;
  readonly chatId: ChatId;
  readonly rootMessageId: MessageId;
  readonly createdAt: ISODateTime;
  readonly updatedAt?: ISODateTime;
  readonly label?: string;
  readonly parentBranchId?: MessageBranchId;
  readonly forkedFromMessageId?: MessageId;
  readonly headMessageId?: MessageId;
  readonly isActive?: boolean;
  readonly stateSnapshotId?: RpgStateSnapshotId;
  readonly metadata?: JsonObject;
}

export function createMessageBranch(input: CreateMessageBranchInput): MessageBranch {
  return {
    id: input.id,
    chatId: input.chatId,
    label: input.label ?? "Main",
    rootMessageId: input.rootMessageId,
    parentBranchId: input.parentBranchId,
    forkedFromMessageId: input.forkedFromMessageId,
    headMessageId: input.headMessageId ?? input.rootMessageId,
    isActive: input.isActive ?? true,
    stateSnapshotId: input.stateSnapshotId,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt ?? input.createdAt,
    metadata: input.metadata,
  };
}
