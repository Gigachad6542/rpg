import type { RepositoryOptions, SqlDriver, SqlRow } from "../types";
import { createRepositoryContext, parseJson, stringifyJson, type JsonObject } from "./shared";

export interface RpgStateSnapshotRecord {
  id: string;
  worldId: string;
  chatId: string;
  branchId: string;
  messageId: string;
  payload: JsonObject;
  createdAt: string;
}

export interface UpsertRpgStateSnapshotInput {
  id: string;
  worldId: string;
  chatId: string;
  branchId: string;
  messageId: string;
  payload: JsonObject;
  createdAt?: string;
}

export class RpgStateSnapshotRepository {
  private readonly context;

  constructor(
    private readonly driver: SqlDriver,
    options: RepositoryOptions = {},
  ) {
    this.context = createRepositoryContext(options);
  }

  async upsert(input: UpsertRpgStateSnapshotInput): Promise<RpgStateSnapshotRecord> {
    const createdAt = input.createdAt ?? this.context.now();

    await this.driver.execute(
      `INSERT OR REPLACE INTO rpg_state_snapshots (
        id,
        world_id,
        chat_id,
        branch_id,
        message_id,
        payload_json,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.id,
        input.worldId,
        input.chatId,
        input.branchId,
        input.messageId,
        stringifyJson(input.payload, {}),
        createdAt,
      ],
    );

    const stored = await this.getById(input.id);
    if (!stored) {
      throw new Error(`RPG state snapshot was not persisted: ${input.id}`);
    }

    return stored;
  }

  async getById(id: string): Promise<RpgStateSnapshotRecord | null> {
    const rows = await this.driver.select<RpgStateSnapshotRow>(
      "SELECT * FROM rpg_state_snapshots WHERE id = $1 LIMIT 1",
      [id],
    );
    return rows[0] ? mapRpgStateSnapshot(rows[0]) : null;
  }

  async listByChat(chatId: string): Promise<RpgStateSnapshotRecord[]> {
    const rows = await this.driver.select<RpgStateSnapshotRow>(
      "SELECT * FROM rpg_state_snapshots WHERE chat_id = $1 ORDER BY created_at ASC",
      [chatId],
    );
    return rows.map(mapRpgStateSnapshot);
  }
}

type RpgStateSnapshotRow = SqlRow & {
  id: string;
  world_id: string;
  chat_id: string;
  branch_id: string;
  message_id: string;
  payload_json: string;
  created_at: string;
};

function mapRpgStateSnapshot(row: RpgStateSnapshotRow): RpgStateSnapshotRecord {
  return {
    id: row.id,
    worldId: row.world_id,
    chatId: row.chat_id,
    branchId: row.branch_id,
    messageId: row.message_id,
    payload: parseJson<JsonObject>(row.payload_json, {}),
    createdAt: row.created_at,
  };
}
