import type { SqlDriver } from "./driver";
import type { SqlMigration } from "./schema";
import type { MigrationResult } from "./types";
import { runInTransaction } from "./transaction";

export async function runMigrations(
  db: SqlDriver,
  migrations: readonly SqlMigration[],
  now = () => new Date().toISOString(),
): Promise<MigrationResult[]> {
  const results: MigrationResult[] = [];
  await db.execute(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);

  for (const migration of migrations) {
    const existing = await db.select<{ version: number }>(
      "SELECT version FROM schema_migrations WHERE version = $1",
      [migration.version],
    );

    if (existing.length > 0) {
      results.push({ version: migration.version, name: migration.name, status: "skipped" });
      continue;
    }

    await runInTransaction(db, async (transactionDriver) => {
      for (const statement of migration.statements) {
        await transactionDriver.execute(statement);
      }
      await transactionDriver.execute("INSERT INTO schema_migrations (version, name, applied_at) VALUES ($1, $2, $3)", [
        migration.version,
        migration.name,
        now(),
      ]);
    });
    results.push({ version: migration.version, name: migration.name, status: "applied" });
  }

  return results;
}
