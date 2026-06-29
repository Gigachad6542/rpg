import type { RepositoryOptions, SqlDriver, SqlRow } from "../types";
import { createRepositoryContext, fromSqlBoolean, parseJson, stringifyJson, type JsonObject } from "./shared";

export interface LorebookRecord {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LorebookEntryRecord {
  id: string;
  lorebookId: string;
  title: string;
  content: string;
  constant: boolean;
  triggers: JsonObject;
  tokenBudget: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertLorebookInput {
  id: string;
  name: string;
  description?: string | null;
}

export interface UpsertLorebookEntryInput {
  id: string;
  lorebookId: string;
  title: string;
  content: string;
  constant?: boolean;
  triggers?: JsonObject;
  tokenBudget?: number | null;
}

export class LorebookRepository {
  private readonly context;

  constructor(
    private readonly driver: SqlDriver,
    options: RepositoryOptions = {},
  ) {
    this.context = createRepositoryContext(options);
  }

  async upsert(input: UpsertLorebookInput): Promise<LorebookRecord> {
    const existing = await this.getById(input.id);
    const now = this.context.now();
    const createdAt = existing?.createdAt ?? now;

    await this.driver.execute(
      `INSERT OR REPLACE INTO lorebooks (
        id,
        name,
        description,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5)`,
      [input.id, input.name, input.description ?? null, createdAt, now],
    );

    const stored = await this.getById(input.id);
    if (!stored) {
      throw new Error(`Lorebook was not persisted: ${input.id}`);
    }

    return stored;
  }

  async getById(id: string): Promise<LorebookRecord | null> {
    const rows = await this.driver.select<LorebookRow>("SELECT * FROM lorebooks WHERE id = $1 LIMIT 1", [id]);
    return rows[0] ? mapLorebook(rows[0]) : null;
  }

  async list(): Promise<LorebookRecord[]> {
    const rows = await this.driver.select<LorebookRow>("SELECT * FROM lorebooks ORDER BY updated_at ASC");
    return rows.map(mapLorebook);
  }
}

export class LorebookEntryRepository {
  private readonly context;

  constructor(
    private readonly driver: SqlDriver,
    options: RepositoryOptions = {},
  ) {
    this.context = createRepositoryContext(options);
  }

  async upsert(input: UpsertLorebookEntryInput): Promise<LorebookEntryRecord> {
    const existing = await this.getById(input.id);
    const now = this.context.now();
    const createdAt = existing?.createdAt ?? now;

    await this.driver.execute(
      `INSERT OR REPLACE INTO lorebook_entries (
        id,
        lorebook_id,
        title,
        content,
        constant,
        triggers_json,
        token_budget,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        input.id,
        input.lorebookId,
        input.title,
        input.content,
        input.constant ? 1 : 0,
        stringifyJson(input.triggers, {}),
        input.tokenBudget ?? null,
        createdAt,
        now,
      ],
    );

    const stored = await this.getById(input.id);
    if (!stored) {
      throw new Error(`Lorebook entry was not persisted: ${input.id}`);
    }

    return stored;
  }

  async getById(id: string): Promise<LorebookEntryRecord | null> {
    const rows = await this.driver.select<LorebookEntryRow>(
      "SELECT * FROM lorebook_entries WHERE id = $1 LIMIT 1",
      [id],
    );
    return rows[0] ? mapLorebookEntry(rows[0]) : null;
  }

  async listByLorebook(lorebookId: string): Promise<LorebookEntryRecord[]> {
    const rows = await this.driver.select<LorebookEntryRow>(
      "SELECT * FROM lorebook_entries WHERE lorebook_id = $1 ORDER BY updated_at ASC",
      [lorebookId],
    );
    return rows.map(mapLorebookEntry);
  }

  async deleteByLorebook(lorebookId: string): Promise<void> {
    await this.driver.execute("DELETE FROM lorebook_entries WHERE lorebook_id = $1", [lorebookId]);
  }
}

type LorebookRow = SqlRow & {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

type LorebookEntryRow = SqlRow & {
  id: string;
  lorebook_id: string;
  title: string;
  content: string;
  constant: number;
  triggers_json: string;
  token_budget: number | null;
  created_at: string;
  updated_at: string;
};

function mapLorebook(row: LorebookRow): LorebookRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapLorebookEntry(row: LorebookEntryRow): LorebookEntryRecord {
  return {
    id: row.id,
    lorebookId: row.lorebook_id,
    title: row.title,
    content: row.content,
    constant: fromSqlBoolean(row.constant),
    triggers: parseJson<JsonObject>(row.triggers_json, {}),
    tokenBudget: row.token_budget,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
