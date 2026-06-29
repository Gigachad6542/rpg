import type { RepositoryOptions, SqlDriver, SqlRow } from "../types";
import { createRepositoryContext, parseJson, stringifyJson, type JsonObject } from "./shared";

export type MessageRole = "system" | "user" | "assistant" | "tool" | "narrator";

export interface MessageRecord {
  id: string;
  chatId: string;
  parentMessageId: string | null;
  branchId: string;
  role: MessageRole;
  content: string;
  stateSnapshotId: string | null;
  metadata: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMessageInput {
  id?: string;
  chatId: string;
  parentMessageId?: string | null;
  branchId: string;
  role: MessageRole;
  content: string;
  stateSnapshotId?: string | null;
  metadata?: JsonObject;
  createdAt?: string;
  updatedAt?: string;
}

export class MessageRepository {
  private readonly context;

  constructor(
    private readonly driver: SqlDriver,
    options: RepositoryOptions = {},
  ) {
    this.context = createRepositoryContext(options);
  }

  async create(input: CreateMessageInput): Promise<MessageRecord> {
    const id = input.id ?? this.context.idFactory("msg");
    const now = this.context.now();
    const createdAt = input.createdAt ?? now;
    const updatedAt = input.updatedAt ?? now;

    await this.driver.execute(
      `INSERT INTO messages (
        id,
        chat_id,
        parent_message_id,
        branch_id,
        role,
        content,
        state_snapshot_id,
        metadata_json,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        input.chatId,
        input.parentMessageId ?? null,
        input.branchId,
        input.role,
        input.content,
        input.stateSnapshotId ?? null,
        stringifyJson(input.metadata, {}),
        createdAt,
        updatedAt,
      ],
    );

    const stored = await this.getById(id);
    if (!stored) {
      throw new Error(`Message was not persisted: ${id}`);
    }

    return stored;
  }

  async getById(id: string): Promise<MessageRecord | null> {
    const rows = await this.driver.select<MessageRow>("SELECT * FROM messages WHERE id = $1 LIMIT 1", [id]);
    return rows[0] ? mapMessage(rows[0]) : null;
  }

  async listByBranch(chatId: string, branchId: string): Promise<MessageRecord[]> {
    const rows = await this.driver.select<MessageRow>(
      "SELECT * FROM messages WHERE chat_id = $1 AND branch_id = $2 ORDER BY created_at ASC",
      [chatId, branchId],
    );
    return rows.map(mapMessage);
  }

  async listChildren(parentMessageId: string): Promise<MessageRecord[]> {
    const rows = await this.driver.select<MessageRow>(
      "SELECT * FROM messages WHERE parent_message_id = $1 ORDER BY created_at ASC",
      [parentMessageId],
    );
    return rows.map(mapMessage);
  }

  async getLineage(messageId: string): Promise<MessageRecord[]> {
    const lineage: MessageRecord[] = [];
    let current = await this.getById(messageId);

    while (current) {
      lineage.unshift(current);
      current = current.parentMessageId ? await this.getById(current.parentMessageId) : null;
    }

    return lineage;
  }
}

type MessageRow = SqlRow & {
  id: string;
  chat_id: string;
  parent_message_id: string | null;
  branch_id: string;
  role: MessageRole;
  content: string;
  state_snapshot_id: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

function mapMessage(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    chatId: row.chat_id,
    parentMessageId: row.parent_message_id,
    branchId: row.branch_id,
    role: row.role,
    content: row.content,
    stateSnapshotId: row.state_snapshot_id,
    metadata: parseJson<JsonObject>(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
