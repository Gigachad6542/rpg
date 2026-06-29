import type { RepositoryOptions, SqlDriver, SqlRow } from "../types";
import { createRepositoryContext, parseJson, stringifyJson, type JsonObject } from "./shared";

export interface PromptRunRecord {
  id: string;
  chatId: string;
  messageId: string | null;
  provider: string;
  model: string;
  temperature: number | null;
  tokenBudget: number | null;
  compiledPrompt: string;
  includedMemoryIds: string[];
  includedLoreEntryIds: string[];
  includedStateSnapshotId: string | null;
  responseText: string | null;
  extractionJson: JsonObject;
  stateChanges: JsonObject;
  request: JsonObject;
  modelSettings: JsonObject;
  createdAt: string;
}

export interface CreatePromptRunInput {
  id?: string;
  chatId: string;
  messageId?: string | null;
  provider: string;
  model: string;
  temperature?: number | null;
  tokenBudget?: number | null;
  compiledPrompt: string;
  includedMemoryIds?: string[];
  includedLoreEntryIds?: string[];
  includedStateSnapshotId?: string | null;
  responseText?: string | null;
  extractionJson?: JsonObject;
  stateChanges?: JsonObject;
  request?: JsonObject;
  modelSettings?: JsonObject;
  createdAt?: string;
}

export class PromptRunRepository {
  private readonly context;

  constructor(
    private readonly driver: SqlDriver,
    options: RepositoryOptions = {},
  ) {
    this.context = createRepositoryContext(options);
  }

  async create(input: CreatePromptRunInput): Promise<PromptRunRecord> {
    const id = input.id ?? this.context.idFactory("prompt");
    const createdAt = input.createdAt ?? this.context.now();

    await this.driver.execute(
      `INSERT INTO prompt_runs (
        id,
        chat_id,
        message_id,
        provider,
        model,
        temperature,
        token_budget,
        compiled_prompt,
        included_memory_ids_json,
        included_lore_entry_ids_json,
        included_state_snapshot_id,
        response_text,
        extraction_json,
        state_changes_json,
        request_json,
        model_settings_json,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        id,
        input.chatId,
        input.messageId ?? null,
        input.provider,
        input.model,
        input.temperature ?? null,
        input.tokenBudget ?? null,
        input.compiledPrompt,
        stringifyJson(input.includedMemoryIds, []),
        stringifyJson(input.includedLoreEntryIds, []),
        input.includedStateSnapshotId ?? null,
        input.responseText ?? null,
        stringifyJson(input.extractionJson, {}),
        stringifyJson(input.stateChanges, {}),
        stringifyJson(input.request, {}),
        stringifyJson(input.modelSettings, {}),
        createdAt,
      ],
    );

    const stored = await this.getById(id);
    if (!stored) {
      throw new Error(`Prompt run was not persisted: ${id}`);
    }

    return stored;
  }

  async getById(id: string): Promise<PromptRunRecord | null> {
    const rows = await this.driver.select<PromptRunRow>("SELECT * FROM prompt_runs WHERE id = $1 LIMIT 1", [id]);
    return rows[0] ? mapPromptRun(rows[0]) : null;
  }

  async listByChat(chatId: string): Promise<PromptRunRecord[]> {
    const rows = await this.driver.select<PromptRunRow>(
      "SELECT * FROM prompt_runs WHERE chat_id = $1 ORDER BY created_at ASC",
      [chatId],
    );
    return rows.map(mapPromptRun);
  }
}

type PromptRunRow = SqlRow & {
  id: string;
  chat_id: string;
  message_id: string | null;
  provider: string;
  model: string;
  temperature: number | null;
  token_budget: number | null;
  compiled_prompt: string;
  included_memory_ids_json: string;
  included_lore_entry_ids_json: string;
  included_state_snapshot_id: string | null;
  response_text: string | null;
  extraction_json: string;
  state_changes_json: string;
  request_json: string;
  model_settings_json: string;
  created_at: string;
};

function mapPromptRun(row: PromptRunRow): PromptRunRecord {
  return {
    id: row.id,
    chatId: row.chat_id,
    messageId: row.message_id,
    provider: row.provider,
    model: row.model,
    temperature: row.temperature,
    tokenBudget: row.token_budget,
    compiledPrompt: row.compiled_prompt,
    includedMemoryIds: parseJson<string[]>(row.included_memory_ids_json, []),
    includedLoreEntryIds: parseJson<string[]>(row.included_lore_entry_ids_json, []),
    includedStateSnapshotId: row.included_state_snapshot_id,
    responseText: row.response_text,
    extractionJson: parseJson<JsonObject>(row.extraction_json, {}),
    stateChanges: parseJson<JsonObject>(row.state_changes_json, {}),
    request: parseJson<JsonObject>(row.request_json, {}),
    modelSettings: parseJson<JsonObject>(row.model_settings_json, {}),
    createdAt: row.created_at,
  };
}
