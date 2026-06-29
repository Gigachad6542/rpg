import type { Chat } from "../../domain/index";
import { runInTransaction } from "../transaction";
import type { RepositoryOptions, SqlDriver, SqlRow } from "../types";
import {
  createRepositoryContext,
  fromSqlBoolean,
  parseJson,
  stringifyJson,
  toSqlBoolean,
  type JsonObject,
} from "./shared";

export interface ChatRecord {
  id: string;
  title: string;
  mode: string;
  activeBranchId: string | null;
  rootStateSnapshotId: string | null;
  metadata: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export interface MessageBranchRecord {
  id: string;
  chatId: string;
  name: string;
  baseMessageId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateChatInput {
  id?: string;
  title: string;
  mode?: string;
  branchId?: string;
  rootStateSnapshotId?: string | null;
  metadata?: JsonObject;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateBranchInput {
  id?: string;
  chatId: string;
  name?: string;
  baseMessageId?: string | null;
  activate?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export class ChatRepository {
  private readonly context;

  constructor(
    private readonly driver: SqlDriver,
    options: RepositoryOptions = {},
  ) {
    this.context = createRepositoryContext(options);
  }

  async create(input: CreateChatInput): Promise<ChatRecord> {
    const id = input.id ?? this.context.idFactory("chat");
    const branchId = input.branchId ?? this.context.idFactory("branch");
    const now = this.context.now();
    const createdAt = input.createdAt ?? now;
    const updatedAt = input.updatedAt ?? now;

    await runInTransaction(this.driver, async (transactionDriver) => {
      await transactionDriver.execute(
        `INSERT INTO chats (
          id,
          title,
          mode,
          active_branch_id,
          root_state_snapshot_id,
          metadata_json,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          input.title,
          input.mode ?? "chat",
          branchId,
          input.rootStateSnapshotId ?? null,
          stringifyJson(input.metadata, {}),
          createdAt,
          updatedAt,
        ],
      );

      await transactionDriver.execute(
        `INSERT INTO message_branches (
          id,
          chat_id,
          name,
          label,
          base_message_id,
          is_active,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [branchId, id, "Main", "Main", null, 1, createdAt, updatedAt],
      );
    });

    const stored = await this.getById(id);
    if (!stored) {
      throw new Error(`Chat was not persisted: ${id}`);
    }

    return stored;
  }

  async createBranch(input: CreateBranchInput): Promise<MessageBranchRecord> {
    const id = input.id ?? this.context.idFactory("branch");
    const now = this.context.now();
    const createdAt = input.createdAt ?? now;
    const updatedAt = input.updatedAt ?? now;
    const shouldActivate = input.activate ?? false;

    await runInTransaction(this.driver, async (transactionDriver) => {
      if (shouldActivate) {
        await transactionDriver.execute(
          "UPDATE message_branches SET is_active = $1, updated_at = $2 WHERE chat_id = $3",
          [0, updatedAt, input.chatId],
        );
      }

      await transactionDriver.execute(
        `INSERT INTO message_branches (
          id,
          chat_id,
          name,
          label,
          base_message_id,
          is_active,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          input.chatId,
          input.name ?? "Branch",
          input.name ?? "Branch",
          input.baseMessageId ?? null,
          toSqlBoolean(shouldActivate),
          createdAt,
          updatedAt,
        ],
      );

      if (shouldActivate) {
        await transactionDriver.execute("UPDATE chats SET active_branch_id = $1, updated_at = $2 WHERE id = $3", [
          id,
          updatedAt,
          input.chatId,
        ]);
      }
    });

    const stored = await this.getBranchById(id);
    if (!stored) {
      throw new Error(`Message branch was not persisted: ${id}`);
    }

    return stored;
  }

  async getById(id: string): Promise<ChatRecord | null> {
    const rows = await this.driver.select<ChatRow>("SELECT * FROM chats WHERE id = $1 LIMIT 1", [id]);
    return rows[0] ? mapChat(rows[0]) : null;
  }

  async list(): Promise<ChatRecord[]> {
    const rows = await this.driver.select<ChatRow>("SELECT * FROM chats ORDER BY updated_at DESC");
    return rows.map(mapChat);
  }

  async getActiveBranch(chatId: string): Promise<MessageBranchRecord | null> {
    const rows = await this.driver.select<MessageBranchRow>(
      "SELECT * FROM message_branches WHERE chat_id = $1 AND is_active = 1 LIMIT 1",
      [chatId],
    );
    return rows[0] ? mapBranch(rows[0]) : null;
  }

  async getBranchById(id: string): Promise<MessageBranchRecord | null> {
    const rows = await this.driver.select<MessageBranchRow>("SELECT * FROM message_branches WHERE id = $1 LIMIT 1", [
      id,
    ]);
    return rows[0] ? mapBranch(rows[0]) : null;
  }
}

type ChatRow = SqlRow & {
  id: string;
  title: string;
  mode: string;
  active_branch_id: string | null;
  root_state_snapshot_id: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

type MessageBranchRow = SqlRow & {
  id: string;
  chat_id: string;
  name: string;
  base_message_id: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
};

function mapChat(row: ChatRow): ChatRecord {
  return {
    id: row.id,
    title: row.title,
    mode: row.mode,
    activeBranchId: row.active_branch_id,
    rootStateSnapshotId: row.root_state_snapshot_id,
    metadata: parseJson<JsonObject>(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBranch(row: MessageBranchRow): MessageBranchRecord {
  return {
    id: row.id,
    chatId: row.chat_id,
    name: row.name,
    baseMessageId: row.base_message_id,
    isActive: fromSqlBoolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
