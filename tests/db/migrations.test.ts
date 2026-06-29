import { describe, expect, it } from "vitest";

import { createInMemorySqlDriver } from "../../src/db/inMemoryDriver";
import { runMigrations } from "../../src/db/migrations";
import { sqliteMigrations } from "../../src/db/schema";
import type { SqlDriver, SqlValue } from "../../src/db/driver";

describe("SQLite migrations", () => {
  it("creates the local-first runtime core schema exactly once", async () => {
    const db = createInMemorySqlDriver();

    const firstRun = await runMigrations(db, sqliteMigrations);
    const secondRun = await runMigrations(db, sqliteMigrations);

    expect(firstRun).toEqual([{ version: 1, name: "initial_core_schema", status: "applied" }]);
    expect(secondRun).toEqual([{ version: 1, name: "initial_core_schema", status: "skipped" }]);

    const tables = await db.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    );

    expect(tables.map((table) => table.name)).toEqual(
      expect.arrayContaining([
        "characters",
        "chats",
        "message_branches",
        "messages",
        "prompt_runs",
        "rpg_state_snapshots",
        "schema_migrations",
      ]),
    );
  });

  it("bootstraps schema_migrations before checking applied migrations on a strict SQLite-like driver", async () => {
    const db = createStrictSqliteLikeDriver();

    await expect(runMigrations(db, sqliteMigrations)).resolves.toEqual([
      { version: 1, name: "initial_core_schema", status: "applied" },
    ]);

    await expect(runMigrations(db, sqliteMigrations)).resolves.toEqual([
      { version: 1, name: "initial_core_schema", status: "skipped" },
    ]);
  });

  it("rolls back a failed migration and does not record it as applied", async () => {
    const db = createInMemorySqlDriver();
    await runMigrations(db, sqliteMigrations);

    await expect(
      runMigrations(db, [
        {
          version: 2,
          name: "failed_migration",
          statements: [
            "CREATE TABLE IF NOT EXISTS transient_table (id TEXT PRIMARY KEY)",
            "INSERT INTO transient_table (id) VALUES ($1)",
            "DELETE FROM transient_table WHERE id IN ($1)",
          ],
        },
      ]),
    ).rejects.toThrow(/unsupported/i);

    await expect(
      db.select<{ version: number }>("SELECT version FROM schema_migrations WHERE version = $1", [2]),
    ).resolves.toEqual([]);
    expect(db.hasTable("transient_table")).toBe(false);
  });

  it("defines runtime relation constraints and lookup indexes", () => {
    const schemaSql = sqliteMigrations.flatMap((migration) => migration.statements).join("\n");

    expect(schemaSql).toMatch(/FOREIGN KEY\s*\(chat_id\)\s+REFERENCES chats\(id\)/i);
    expect(schemaSql).toMatch(/CHECK\s*\(role IN \('system', 'user', 'assistant', 'tool', 'narrator'\)\)/i);
    expect(schemaSql).toContain("idx_messages_chat_branch_created");
    expect(schemaSql).toContain("idx_prompt_runs_chat_created");
    expect(schemaSql).toContain("idx_image_prompt_runs_chat_created");
    expect(schemaSql).toContain("idx_lorebook_entries_lorebook_updated");
    expect(schemaSql).toContain("idx_memory_entries_chat_updated");
    expect(schemaSql).toContain("idx_rpg_state_snapshots_chat_created");
  });
});

function createStrictSqliteLikeDriver(): SqlDriver {
  const db = createInMemorySqlDriver();

  return {
    execute: (sql: string, params: SqlValue[] = []) => db.execute(sql, params),
    async select<TRecord extends Record<string, unknown>>(sql: string, params: SqlValue[] = []) {
      if (/from\s+schema_migrations/i.test(sql) && !db.hasTable("schema_migrations")) {
        throw new Error("no such table: schema_migrations");
      }

      return db.select<TRecord>(sql, params);
    },
  };
}
