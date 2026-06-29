import type { RepositoryOptions, SqlDriver, SqlRow } from "../types";
import {
  createRepositoryContext,
  fromSqlBoolean,
  parseJson,
  stringifyJson,
  toSqlBoolean,
} from "./shared";

export interface MemoryEntryRecord {
  id: string;
  chatId: string | null;
  category: string;
  text: string;
  importance: number;
  pinned: boolean;
  relatedCharacterIds: string[];
  relatedEventIds: string[];
  lastAccessedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertMemoryEntryInput {
  id: string;
  chatId?: string | null;
  category: string;
  text: string;
  importance?: number;
  pinned?: boolean;
  relatedCharacterIds?: string[];
  relatedEventIds?: string[];
  lastAccessedAt?: string | null;
}

export class MemoryEntryRepository {
  private readonly context;

  constructor(
    private readonly driver: SqlDriver,
    options: RepositoryOptions = {},
  ) {
    this.context = createRepositoryContext(options);
  }

  async upsert(input: UpsertMemoryEntryInput): Promise<MemoryEntryRecord> {
    const existing = await this.getById(input.id);
    const now = this.context.now();
    const createdAt = existing?.createdAt ?? now;

    await this.driver.execute(
      `INSERT OR REPLACE INTO memory_entries (
        id,
        chat_id,
        category,
        text,
        importance,
        pinned,
        related_character_ids_json,
        related_event_ids_json,
        last_accessed_at,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        input.id,
        input.chatId ?? null,
        input.category,
        input.text,
        input.importance ?? 1,
        toSqlBoolean(input.pinned ?? false),
        stringifyJson(input.relatedCharacterIds, []),
        stringifyJson(input.relatedEventIds, []),
        input.lastAccessedAt ?? null,
        createdAt,
        now,
      ],
    );

    const stored = await this.getById(input.id);
    if (!stored) {
      throw new Error(`Memory entry was not persisted: ${input.id}`);
    }

    return stored;
  }

  async getById(id: string): Promise<MemoryEntryRecord | null> {
    const rows = await this.driver.select<MemoryEntryRow>("SELECT * FROM memory_entries WHERE id = $1 LIMIT 1", [id]);
    return rows[0] ? mapMemoryEntry(rows[0]) : null;
  }

  async listByChat(chatId: string): Promise<MemoryEntryRecord[]> {
    const rows = await this.driver.select<MemoryEntryRow>(
      "SELECT * FROM memory_entries WHERE chat_id = $1 ORDER BY updated_at ASC",
      [chatId],
    );
    return rows.map(mapMemoryEntry);
  }

  async deleteByChat(chatId: string): Promise<void> {
    await this.driver.execute("DELETE FROM memory_entries WHERE chat_id = $1", [chatId]);
  }
}

type MemoryEntryRow = SqlRow & {
  id: string;
  chat_id: string | null;
  category: string;
  text: string;
  importance: number;
  pinned: number;
  related_character_ids_json: string;
  related_event_ids_json: string;
  last_accessed_at: string | null;
  created_at: string;
  updated_at: string;
};

function mapMemoryEntry(row: MemoryEntryRow): MemoryEntryRecord {
  return {
    id: row.id,
    chatId: row.chat_id,
    category: row.category,
    text: row.text,
    importance: row.importance,
    pinned: fromSqlBoolean(row.pinned),
    relatedCharacterIds: parseJson<string[]>(row.related_character_ids_json, []),
    relatedEventIds: parseJson<string[]>(row.related_event_ids_json, []),
    lastAccessedAt: row.last_accessed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
