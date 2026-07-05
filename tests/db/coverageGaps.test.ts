import { afterEach, describe, expect, it, vi } from "vitest";

import { createDatabaseDriver, createMigratedDatabaseDriver } from "../../src/db/client";
import { createInMemorySqlDriver, type InMemorySqlDriver } from "../../src/db/inMemoryDriver";
import { runMigrations } from "../../src/db/migrations";
import { CharacterRepository } from "../../src/db/repositories/characters";
import { ChatRepository } from "../../src/db/repositories/chats";
import { ImagePromptRunRepository } from "../../src/db/repositories/imagePromptRuns";
import { LorebookEntryRepository, LorebookRepository } from "../../src/db/repositories/lorebooks";
import { MemoryEntryRepository } from "../../src/db/repositories/memoryEntries";
import { MessageRepository } from "../../src/db/repositories/messages";
import { ModelProviderConfigRepository } from "../../src/db/repositories/modelProviderConfigs";
import { PromptRunRepository } from "../../src/db/repositories/promptRuns";
import { RpgStateSnapshotRepository } from "../../src/db/repositories/rpgStateSnapshots";
import {
  createRepositoryContext,
  fromSqlBoolean,
  parseJson,
  stringifyJson,
} from "../../src/db/repositories/shared";
import { runInTransaction } from "../../src/db/transaction";
import { sqliteMigrations } from "../../src/db/schema";
import type { SqlDriver } from "../../src/db/types";

describe("database coverage gap characterization", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates memory drivers unless renderer SQL is explicitly unavailable", async () => {
    await expect(createDatabaseDriver()).resolves.toMatchObject({
      execute: expect.any(Function),
      select: expect.any(Function),
    });
    await expect(createMigratedDatabaseDriver()).resolves.toMatchObject({
      hasTable: expect.any(Function),
    });
    await expect(createDatabaseDriver({ preferTauri: true })).rejects.toThrow(/Renderer SQL access is disabled/i);

    const previousDescriptor = Object.getOwnPropertyDescriptor(window, "__TAURI_INTERNALS__");
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true,
    });
    try {
      await expect(createDatabaseDriver()).rejects.toThrow(/Renderer SQL access is disabled/i);
    } finally {
      if (previousDescriptor) {
        Object.defineProperty(window, "__TAURI_INTERNALS__", previousDescriptor);
      } else {
        delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
      }
    }
  });

  it("covers repository shared defaults, JSON helpers, and SQL boolean coercion", () => {
    expect(stringifyJson(undefined, { fallback: true })).toBe('{"fallback":true}');
    expect(parseJson(null, ["fallback"])).toEqual(["fallback"]);
    expect(parseJson("", ["fallback"])).toEqual(["fallback"]);
    expect(parseJson(["already"], ["fallback"])).toEqual(["already"]);
    expect(parseJson("bad-json", ["fallback"])).toEqual(["fallback"]);
    expect(fromSqlBoolean(true)).toBe(true);
    expect(fromSqlBoolean("1")).toBe(true);
    expect(fromSqlBoolean(0)).toBe(false);

    const context = createRepositoryContext({
      now: () => "2026-07-01T00:00:00.000Z",
      idFactory: (prefix) => `${prefix}_fixed`,
    });
    expect(context.now()).toBe("2026-07-01T00:00:00.000Z");
    expect(context.idFactory("char")).toBe("char_fixed");

    const defaultContext = createRepositoryContext();
    expect(defaultContext.now()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(defaultContext.idFactory("prompt")).toMatch(/^prompt_[a-zA-Z0-9_]+$/);

    const originalCrypto = globalThis.crypto;
    vi.stubGlobal("crypto", undefined);
    try {
      expect(createRepositoryContext().idFactory("fallback")).toMatch(/^fallback_[a-z0-9]+_[a-z0-9]+$/);
    } finally {
      vi.stubGlobal("crypto", originalCrypto);
    }
  });

  it("uses in-memory SQL table operations, rollback snapshots, and unsupported SQL guards", async () => {
    const db = createInMemorySqlDriver();

    expect(await db.execute("BEGIN")).toEqual({ rowsAffected: 0 });
    await db.execute("CREATE TABLE IF NOT EXISTS test_rows (id TEXT PRIMARY KEY, chat_id TEXT, status TEXT)");
    await db.execute("INSERT INTO test_rows (id, chat_id, status) VALUES ($1, $2, $3)", [
      "row-1",
      "chat-1",
      "open",
    ]);
    await db.execute("INSERT OR REPLACE INTO test_rows (id, chat_id, status) VALUES ($1, $2, $3)", [
      "row-1",
      "chat-1",
      "closed",
    ]);

    await expect(db.getById("test_rows", "row-1")).resolves.toMatchObject({ status: "closed" });
    await expect(db.select("SELECT name FROM sqlite_master")).resolves.toEqual([{ name: "test_rows" }]);
    await db.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY)");
    await db.execute("INSERT INTO schema_migrations (version) VALUES ($1)", ["001"]);
    await expect(db.select("SELECT * FROM schema_migrations")).resolves.toEqual([{ version: "001" }]);
    await expect(db.select("SELECT * FROM schema_migrations WHERE version = $1", ["missing"])).resolves.toEqual([]);
    await expect(
      db.select("SELECT * FROM test_rows WHERE chat_id = $1 AND status = 'closed' ORDER BY status ASC LIMIT 1", [
        "chat-1",
      ]),
    ).resolves.toHaveLength(1);

    await expect(
      runInTransaction(db as SqlDriver, async (transactionDriver: SqlDriver) => {
        await transactionDriver.execute("INSERT INTO test_rows (id, chat_id, status) VALUES ($1, $2, $3)", [
          "transient",
          "chat-1",
          "open",
        ]);
        throw new Error("rollback me");
      }),
    ).rejects.toThrow(/rollback me/);
    await expect(db.getById("test_rows", "transient")).resolves.toBeNull();

    await expect(db.execute("UPDATE test_rows SET bad = 1 WHERE id = $1", ["row-1"])).rejects.toThrow(
      /Unsupported in-memory SQL assignment/i,
    );
    await expect(db.execute("UPDATE test_rows SET status = $1 WHERE id = $2", ["archived", "row-1"])).resolves.toEqual({
      rowsAffected: 1,
    });
    await expect(db.getById("test_rows", "row-1")).resolves.toMatchObject({ status: "archived" });
    await expect(db.select("SELECT * FROM test_rows WHERE status <> $1", ["closed"])).rejects.toThrow(
      /Unsupported in-memory SQL predicate/i,
    );
    await expect(db.select("SELECT status FROM test_rows")).resolves.toEqual([]);
    await expect(db.execute("DELETE FROM test_rows WHERE id = $1", ["missing"])).resolves.toEqual({ rowsAffected: 0 });
    await expect(db.execute("VACUUM")).resolves.toEqual({ rowsAffected: 0 });

    await expect(db.execute("DELETE FROM test_rows")).resolves.toEqual({ rowsAffected: 1 });
    await expect(db.select("SELECT * FROM test_rows")).resolves.toEqual([]);
  });

  it("runs fallback transactions with explicit BEGIN, COMMIT, and ROLLBACK", async () => {
    const calls: string[] = [];
    const fallbackDriver: SqlDriver = {
      async execute(statement) {
        calls.push(statement);
        return { rowsAffected: 0 };
      },
      async select() {
        return [];
      },
    };

    await expect(runInTransaction(fallbackDriver, async () => "ok")).resolves.toBe("ok");
    await expect(
      runInTransaction(fallbackDriver, async () => {
        throw new Error("bad write");
      }),
    ).rejects.toThrow(/bad write/);

    expect(calls).toEqual(["BEGIN", "COMMIT", "BEGIN", "ROLLBACK"]);
  });

  it("lists repository records and maps optional defaults", async () => {
    const db = await migratedMemoryDriver();
    const now = () => "2026-07-01T01:00:00.000Z";

    const characters = new CharacterRepository(db, { now, idFactory: (prefix) => `${prefix}_generated` });
    const chats = new ChatRepository(db, { now, idFactory: (prefix) => `${prefix}_generated` });
    const messages = new MessageRepository(db, { now, idFactory: (prefix) => `${prefix}_generated` });
    const imagePromptRuns = new ImagePromptRunRepository(db, { now });
    const lorebooks = new LorebookRepository(db, { now });
    const lorebookEntries = new LorebookEntryRepository(db, { now });
    const memoryEntries = new MemoryEntryRepository(db, { now });
    const modelProviderConfigs = new ModelProviderConfigRepository(db, { now });
    const promptRuns = new PromptRunRepository(db, { now, idFactory: (prefix) => `${prefix}_generated` });
    const rpgSnapshots = new RpgStateSnapshotRepository(db, { now });

    await characters.upsert({ name: "Generated Character" });
    await expect(characters.list()).resolves.toEqual([
      expect.objectContaining({ id: "char_generated", source: "manual" }),
    ]);

    await chats.create({ title: "Generated Chat" });
    await chats.createBranch({ id: "branch_side", chatId: "chat_generated", name: "Side branch" });
    await expect(chats.list()).resolves.toEqual([
      expect.objectContaining({ id: "chat_generated", mode: "chat" }),
    ]);
    await expect(chats.getBranchById("branch_side")).resolves.toMatchObject({
      name: "Side branch",
      isActive: false,
    });

    const parent = await messages.create({
      chatId: "chat_generated",
      branchId: "branch_generated",
      role: "user",
      content: "parent",
    });
    await messages.create({
      id: "child",
      chatId: "chat_generated",
      branchId: "branch_generated",
      parentMessageId: parent.id,
      role: "assistant",
      content: "child",
    });
    await expect(messages.listChildren(parent.id)).resolves.toEqual([
      expect.objectContaining({ id: "child" }),
    ]);

    await imagePromptRuns.upsert({
      id: "image-1",
      chatId: "chat_generated",
      compiledPrompt: "map",
    });
    await expect(imagePromptRuns.list()).resolves.toEqual([
      expect.objectContaining({ id: "image-1", provider: null }),
    ]);
    await expect(imagePromptRuns.listByChat("chat_generated")).resolves.toHaveLength(1);

    await lorebooks.upsert({ id: "lore-1", name: "Lore" });
    await lorebookEntries.upsert({
      id: "entry-1",
      lorebookId: "lore-1",
      title: "Entry",
      content: "Content",
      constant: true,
      triggers: { keys: ["entry"] },
    });
    await expect(lorebooks.list()).resolves.toEqual([expect.objectContaining({ id: "lore-1" })]);
    await expect(lorebookEntries.listByLorebook("lore-1")).resolves.toEqual([
      expect.objectContaining({ id: "entry-1", constant: true }),
    ]);
    await lorebookEntries.deleteByLorebook("lore-1");
    await expect(lorebookEntries.listByLorebook("lore-1")).resolves.toEqual([]);

    await memoryEntries.upsert({
      id: "memory-1",
      chatId: "chat_generated",
      category: "world",
      text: "Stable fact",
      pinned: true,
      relatedCharacterIds: ["char_generated"],
    });
    await expect(memoryEntries.listByChat("chat_generated")).resolves.toEqual([
      expect.objectContaining({ id: "memory-1", pinned: true }),
    ]);
    await memoryEntries.deleteByChat("chat_generated");
    await expect(memoryEntries.listByChat("chat_generated")).resolves.toEqual([]);

    await modelProviderConfigs.upsert({
      id: "provider-1",
      providerId: "openrouter",
      displayName: "OpenRouter",
    });
    await expect(modelProviderConfigs.list()).resolves.toEqual([
      expect.objectContaining({ id: "provider-1", baseUrl: null }),
    ]);

    await promptRuns.create({
      chatId: "chat_generated",
      provider: "mock",
      model: "mock-narrator",
      compiledPrompt: "prompt",
    });
    await expect(promptRuns.listByChat("chat_generated")).resolves.toEqual([
      expect.objectContaining({ id: "prompt_generated", extractionJson: {} }),
    ]);

    await rpgSnapshots.upsert({
      id: "state-1",
      worldId: "world",
      chatId: "chat_generated",
      branchId: "branch_generated",
      messageId: "child",
      payload: { location: "Cellar" },
    });
    await expect(rpgSnapshots.listByChat("chat_generated")).resolves.toEqual([
      expect.objectContaining({ id: "state-1", payload: { location: "Cellar" } }),
    ]);
  });

  it("surfaces repository write/read verification failures", async () => {
    const driver: SqlDriver = {
      async execute() {
        return { rowsAffected: 1 };
      },
      async select() {
        return [];
      },
    };

    await expect(new CharacterRepository(driver).upsert({ id: "char", name: "No Readback" })).rejects.toThrow(
      /Character was not persisted/,
    );
    await expect(new ChatRepository(driver).create({ id: "chat", title: "No Readback" })).rejects.toThrow(
      /Chat was not persisted/,
    );
    await expect(new ChatRepository(driver).createBranch({ id: "branch", chatId: "chat" })).rejects.toThrow(
      /Message branch was not persisted/,
    );
    await expect(
      new ImagePromptRunRepository(driver).upsert({
        id: "image",
        chatId: "chat",
        compiledPrompt: "prompt",
      }),
    ).rejects.toThrow(/Image prompt run was not persisted/);
    await expect(new LorebookRepository(driver).upsert({ id: "lore", name: "No Readback" })).rejects.toThrow(
      /Lorebook was not persisted/,
    );
    await expect(
      new LorebookEntryRepository(driver).upsert({
        id: "entry",
        lorebookId: "lore",
        title: "Entry",
        content: "Content",
      }),
    ).rejects.toThrow(/Lorebook entry was not persisted/);
    await expect(
      new MemoryEntryRepository(driver).upsert({
        id: "memory",
        category: "world",
        text: "Fact",
      }),
    ).rejects.toThrow(/Memory entry was not persisted/);
    await expect(
      new MessageRepository(driver).create({
        id: "message",
        chatId: "chat",
        branchId: "branch",
        role: "user",
        content: "Hello",
      }),
    ).rejects.toThrow(/Message was not persisted/);
    await expect(
      new ModelProviderConfigRepository(driver).upsert({
        id: "provider",
        providerId: "mock",
        displayName: "Mock",
      }),
    ).rejects.toThrow(/Model provider config was not persisted/);
    await expect(
      new PromptRunRepository(driver).create({
        id: "prompt",
        chatId: "chat",
        provider: "mock",
        model: "mock",
        compiledPrompt: "Prompt",
      }),
    ).rejects.toThrow(/Prompt run was not persisted/);
    await expect(
      new RpgStateSnapshotRepository(driver).upsert({
        id: "state",
        worldId: "world",
        chatId: "chat",
        branchId: "branch",
        messageId: "message",
        payload: {},
      }),
    ).rejects.toThrow(/RPG state snapshot was not persisted/);
  });
});

async function migratedMemoryDriver(): Promise<InMemorySqlDriver> {
  const db = createInMemorySqlDriver();
  await runMigrations(db, sqliteMigrations);
  return db;
}
