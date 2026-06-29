import type { RepositoryOptions, SqlDriver, SqlRow } from "../types";
import { createRepositoryContext, parseJson, stringifyJson, type JsonObject } from "./shared";

export interface ModelProviderConfigRecord {
  id: string;
  providerId: string;
  displayName: string;
  baseUrl: string | null;
  defaultModelId: string | null;
  secretRef: string | null;
  nonSecretSettings: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertModelProviderConfigInput {
  id: string;
  providerId: string;
  displayName: string;
  baseUrl?: string | null;
  defaultModelId?: string | null;
  secretRef?: string | null;
  nonSecretSettings?: JsonObject;
}

export class ModelProviderConfigRepository {
  private readonly context;

  constructor(
    private readonly driver: SqlDriver,
    options: RepositoryOptions = {},
  ) {
    this.context = createRepositoryContext(options);
  }

  async upsert(input: UpsertModelProviderConfigInput): Promise<ModelProviderConfigRecord> {
    const existing = await this.getById(input.id);
    const now = this.context.now();
    const createdAt = existing?.createdAt ?? now;

    await this.driver.execute(
      `INSERT OR REPLACE INTO model_provider_configs (
        id,
        provider_id,
        display_name,
        base_url,
        default_model_id,
        secret_ref,
        non_secret_settings_json,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        input.id,
        input.providerId,
        input.displayName,
        input.baseUrl ?? null,
        input.defaultModelId ?? null,
        input.secretRef ?? null,
        stringifyJson(input.nonSecretSettings, {}),
        createdAt,
        now,
      ],
    );

    const stored = await this.getById(input.id);
    if (!stored) {
      throw new Error(`Model provider config was not persisted: ${input.id}`);
    }

    return stored;
  }

  async getById(id: string): Promise<ModelProviderConfigRecord | null> {
    const rows = await this.driver.select<ModelProviderConfigRow>(
      "SELECT * FROM model_provider_configs WHERE id = $1 LIMIT 1",
      [id],
    );
    return rows[0] ? mapModelProviderConfig(rows[0]) : null;
  }

  async list(): Promise<ModelProviderConfigRecord[]> {
    const rows = await this.driver.select<ModelProviderConfigRow>("SELECT * FROM model_provider_configs");
    return rows.map(mapModelProviderConfig);
  }
}

type ModelProviderConfigRow = SqlRow & {
  id: string;
  provider_id: string;
  display_name: string;
  base_url: string | null;
  default_model_id: string | null;
  secret_ref: string | null;
  non_secret_settings_json: string;
  created_at: string;
  updated_at: string;
};

function mapModelProviderConfig(row: ModelProviderConfigRow): ModelProviderConfigRecord {
  return {
    id: row.id,
    providerId: row.provider_id,
    displayName: row.display_name,
    baseUrl: row.base_url,
    defaultModelId: row.default_model_id,
    secretRef: row.secret_ref,
    nonSecretSettings: parseJson<JsonObject>(row.non_secret_settings_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
