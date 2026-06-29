import { beforeEach, describe, expect, it } from "vitest";

import { createInMemorySqlDriver, type InMemorySqlDriver } from "../../src/db/inMemoryDriver";
import { runMigrations } from "../../src/db/migrations";
import { CharacterRepository } from "../../src/db/repositories/characters";
import { ChatRepository } from "../../src/db/repositories/chats";
import { MessageRepository } from "../../src/db/repositories/messages";
import { PromptRunRepository } from "../../src/db/repositories/promptRuns";
import { sqliteMigrations } from "../../src/db/schema";

describe("SQLite-backed repositories", () => {
  let db: InMemorySqlDriver;
  let characters: CharacterRepository;
  let chats: ChatRepository;
  let messages: MessageRepository;
  let promptRuns: PromptRunRepository;

  beforeEach(async () => {
    db = createInMemorySqlDriver();
    await runMigrations(db, sqliteMigrations);

    characters = new CharacterRepository(db, { now: () => "2026-06-27T10:00:00.000Z" });
    chats = new ChatRepository(db, { now: () => "2026-06-27T10:00:00.000Z" });
    messages = new MessageRepository(db, { now: () => "2026-06-27T10:00:00.000Z" });
    promptRuns = new PromptRunRepository(db, { now: () => "2026-06-27T10:00:00.000Z" });
  });

  it("persists characters with structured profile data", async () => {
    await characters.upsert({
      id: "char_example_keeper",
      name: "Example Keeper",
      description: "Archivist in a user-created setting",
      profile: {
        socialRole: "archivist",
        abilities: ["record keeping", "quiet observation"],
        relationshipToUser: { trust: 0.86, respect: 0.91 },
      },
    });

    const stored = await characters.getById("char_example_keeper");

    expect(stored).toMatchObject({
      id: "char_example_keeper",
      name: "Example Keeper",
      description: "Archivist in a user-created setting",
      createdAt: "2026-06-27T10:00:00.000Z",
      updatedAt: "2026-06-27T10:00:00.000Z",
    });
    expect(stored?.profile).toMatchObject({
      socialRole: "archivist",
      abilities: ["record keeping", "quiet observation"],
    });
  });

  it("persists chats, branches, and branch-aware message trees", async () => {
    await chats.create({
      id: "chat_blank_rpg",
      title: "Blank RPG Opening",
      mode: "rpg",
      branchId: "branch_main",
    });

    const root = await messages.create({
      id: "msg_user_arrival",
      chatId: "chat_blank_rpg",
      branchId: "branch_main",
      role: "user",
      content: "The player reaches an undefined threshold in the rain.",
    });

    await messages.create({
      id: "msg_assistant_formal",
      chatId: "chat_blank_rpg",
      branchId: "branch_main",
      parentMessageId: root.id,
      role: "assistant",
      content: "The runtime asks which local rule should govern entry.",
      stateSnapshotId: "state_formal",
    });

    await chats.createBranch({
      id: "branch_retry",
      chatId: "chat_blank_rpg",
      name: "Retry",
      baseMessageId: root.id,
      activate: true,
    });

    await messages.create({
      id: "msg_assistant_retry",
      chatId: "chat_blank_rpg",
      branchId: "branch_retry",
      parentMessageId: root.id,
      role: "assistant",
      content: "The runtime asks controlled clarifying questions.",
      stateSnapshotId: "state_retry",
    });

    await expect(messages.listByBranch("chat_blank_rpg", "branch_main")).resolves.toEqual([
      expect.objectContaining({ id: "msg_user_arrival", branchId: "branch_main" }),
      expect.objectContaining({ id: "msg_assistant_formal", branchId: "branch_main" }),
    ]);
    await expect(messages.listByBranch("chat_blank_rpg", "branch_retry")).resolves.toEqual([
      expect.objectContaining({ id: "msg_assistant_retry", branchId: "branch_retry" }),
    ]);
    await expect(chats.getActiveBranch("chat_blank_rpg")).resolves.toMatchObject({
      id: "branch_retry",
      baseMessageId: "msg_user_arrival",
      isActive: true,
    });
    await expect(messages.getLineage("msg_assistant_retry")).resolves.toEqual([
      expect.objectContaining({ id: "msg_user_arrival" }),
      expect.objectContaining({ id: "msg_assistant_retry" }),
    ]);
  });

  it("persists prompt run debugging context with JSON collections", async () => {
    await chats.create({
      id: "chat_blank_rpg",
      title: "Blank RPG Opening",
      branchId: "branch_main",
    });

    await promptRuns.create({
      id: "prompt_001",
      chatId: "chat_blank_rpg",
      messageId: "msg_assistant_formal",
      provider: "mock",
      model: "mock-storyteller",
      temperature: 0.7,
      tokenBudget: 4096,
      compiledPrompt: "[runtime]\n[user latest message]",
      includedMemoryIds: ["mem_guest_arrival"],
      includedLoreEntryIds: ["lore_blank_setting"],
      includedStateSnapshotId: "state_formal",
      responseText: "The runtime asks which local rule should govern entry.",
      extractionJson: { newCharacters: [], continuityWarnings: [] },
      stateChanges: { worldFlags: { threshold_reached: true } },
    });

    await expect(promptRuns.getById("prompt_001")).resolves.toMatchObject({
      id: "prompt_001",
      chatId: "chat_blank_rpg",
      messageId: "msg_assistant_formal",
      includedMemoryIds: ["mem_guest_arrival"],
      includedLoreEntryIds: ["lore_blank_setting"],
      extractionJson: { newCharacters: [], continuityWarnings: [] },
      stateChanges: { worldFlags: { threshold_reached: true } },
      createdAt: "2026-06-27T10:00:00.000Z",
    });
  });
});
