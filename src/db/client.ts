import { createInMemorySqlDriver } from "./inMemoryDriver";
import { runMigrations } from "./migrations";
import { sqliteMigrations } from "./schema";
import type { Migration, SqlDriver } from "./types";

export const DEFAULT_SQLITE_PATH = "sqlite:local-first-ai-rpg-runtime.db";

export interface CreateDatabaseDriverOptions {
  sqlitePath?: string;
  preferTauri?: boolean;
}

export async function createDatabaseDriver(options: CreateDatabaseDriverOptions = {}): Promise<SqlDriver> {
  if (options.preferTauri ?? isTauriRuntime()) {
    throw new Error("Renderer SQL access is disabled. Use RuntimeRepositoryStore typed Tauri commands.");
  }

  return createInMemorySqlDriver();
}

export async function createMigratedDatabaseDriver(
  options: CreateDatabaseDriverOptions = {},
  migrations: readonly Migration[] = sqliteMigrations,
): Promise<SqlDriver> {
  const driver = await createDatabaseDriver(options);
  await runMigrations(driver, migrations);
  return driver;
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
