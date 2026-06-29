import type { SqlDriver, SqlRow, RepositoryOptions } from "../types";
import { createRepositoryContext, parseJson, stringifyJson, type JsonObject } from "./shared";

export interface CharacterRecord {
  id: string;
  name: string;
  description: string | null;
  profile: JsonObject;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertCharacterInput {
  id?: string;
  name: string;
  description?: string | null;
  profile?: JsonObject;
  source?: string;
  createdAt?: string;
  updatedAt?: string;
}

export class CharacterRepository {
  private readonly context;

  constructor(
    private readonly driver: SqlDriver,
    options: RepositoryOptions = {},
  ) {
    this.context = createRepositoryContext(options);
  }

  async upsert(input: UpsertCharacterInput): Promise<CharacterRecord> {
    const id = input.id ?? this.context.idFactory("char");
    const existing = await this.getById(id);
    const now = this.context.now();
    const createdAt = input.createdAt ?? existing?.createdAt ?? now;
    const updatedAt = input.updatedAt ?? now;

    await this.driver.execute(
      `INSERT OR REPLACE INTO characters (
        id,
        name,
        description,
        profile_json,
        source,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        input.name,
        input.description ?? null,
        stringifyJson(input.profile, {}),
        input.source ?? existing?.source ?? "manual",
        createdAt,
        updatedAt,
      ],
    );

    const stored = await this.getById(id);
    if (!stored) {
      throw new Error(`Character was not persisted: ${id}`);
    }

    return stored;
  }

  async getById(id: string): Promise<CharacterRecord | null> {
    const rows = await this.driver.select<CharacterRow>("SELECT * FROM characters WHERE id = $1 LIMIT 1", [id]);
    return rows[0] ? mapCharacter(rows[0]) : null;
  }

  async list(): Promise<CharacterRecord[]> {
    const rows = await this.driver.select<CharacterRow>("SELECT * FROM characters ORDER BY updated_at DESC");
    return rows.map(mapCharacter);
  }
}

type CharacterRow = SqlRow & {
  id: string;
  name: string;
  description: string | null;
  profile_json: string;
  source: string;
  created_at: string;
  updated_at: string;
};

function mapCharacter(row: CharacterRow): CharacterRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    profile: parseJson<JsonObject>(row.profile_json, {}),
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
