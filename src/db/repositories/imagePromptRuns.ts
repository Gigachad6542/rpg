import type { RepositoryOptions, SqlDriver, SqlRow } from "../types";
import { createRepositoryContext } from "./shared";

export interface ImagePromptRunRecord {
  id: string;
  chatId: string;
  messageId: string | null;
  provider: string | null;
  compiledPrompt: string;
  negativePrompt: string | null;
  stylePreset: string | null;
  resultUri: string | null;
  createdAt: string;
}

export interface UpsertImagePromptRunInput {
  id: string;
  chatId: string;
  messageId?: string | null;
  provider?: string | null;
  compiledPrompt: string;
  negativePrompt?: string | null;
  stylePreset?: string | null;
  resultUri?: string | null;
  createdAt?: string;
}

export class ImagePromptRunRepository {
  private readonly context;

  constructor(
    private readonly driver: SqlDriver,
    options: RepositoryOptions = {},
  ) {
    this.context = createRepositoryContext(options);
  }

  async upsert(input: UpsertImagePromptRunInput): Promise<ImagePromptRunRecord> {
    const createdAt = input.createdAt ?? this.context.now();

    await this.driver.execute(
      `INSERT OR REPLACE INTO image_prompt_runs (
        id,
        chat_id,
        message_id,
        provider,
        compiled_prompt,
        negative_prompt,
        style_preset,
        result_uri,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        input.id,
        input.chatId,
        input.messageId ?? null,
        input.provider ?? null,
        input.compiledPrompt,
        input.negativePrompt ?? null,
        input.stylePreset ?? null,
        input.resultUri ?? null,
        createdAt,
      ],
    );

    const stored = await this.getById(input.id);
    if (!stored) {
      throw new Error(`Image prompt run was not persisted: ${input.id}`);
    }

    return stored;
  }

  async getById(id: string): Promise<ImagePromptRunRecord | null> {
    const rows = await this.driver.select<ImagePromptRunRow>(
      "SELECT * FROM image_prompt_runs WHERE id = $1 LIMIT 1",
      [id],
    );
    return rows[0] ? mapImagePromptRun(rows[0]) : null;
  }

  async listByChat(chatId: string): Promise<ImagePromptRunRecord[]> {
    const rows = await this.driver.select<ImagePromptRunRow>(
      "SELECT * FROM image_prompt_runs WHERE chat_id = $1 ORDER BY created_at ASC",
      [chatId],
    );
    return rows.map(mapImagePromptRun);
  }

  async list(): Promise<ImagePromptRunRecord[]> {
    const rows = await this.driver.select<ImagePromptRunRow>(
      "SELECT * FROM image_prompt_runs ORDER BY created_at ASC",
    );
    return rows.map(mapImagePromptRun);
  }
}

type ImagePromptRunRow = SqlRow & {
  id: string;
  chat_id: string;
  message_id: string | null;
  provider: string | null;
  compiled_prompt: string;
  negative_prompt: string | null;
  style_preset: string | null;
  result_uri: string | null;
  created_at: string;
};

function mapImagePromptRun(row: ImagePromptRunRow): ImagePromptRunRecord {
  return {
    id: row.id,
    chatId: row.chat_id,
    messageId: row.message_id,
    provider: row.provider,
    compiledPrompt: row.compiled_prompt,
    negativePrompt: row.negative_prompt,
    stylePreset: row.style_preset,
    resultUri: row.result_uri,
    createdAt: row.created_at,
  };
}
