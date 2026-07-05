import { describe, expect, it } from "vitest";

import {
  CHAT_MODES,
  CHARACTER_ORIGINS,
  DEFAULT_PROMPT_LAYER_ORDER,
  EVENT_KINDS,
  KNOWLEDGE_TYPES,
  LOREBOOK_SCOPES,
  MEMORY_CATEGORIES,
  MODEL_PROVIDER_KINDS,
  RPG_RULESET_STYLES,
  createMessageBranch,
  createRpgStateSnapshot,
  type CharacterKnowledgeRecord,
  type ExtractionResultPayload,
  type MessageNode,
} from "../../src/domain";

describe("domain model helpers", () => {
  it("creates a root message branch with a stable active pointer", () => {
    const branch = createMessageBranch({
      id: "branch_main",
      chatId: "chat_1",
      rootMessageId: "msg_root",
      createdAt: "2026-06-27T15:00:00.000Z",
    });

    expect(branch).toMatchObject({
      id: "branch_main",
      chatId: "chat_1",
      rootMessageId: "msg_root",
      headMessageId: "msg_root",
      isActive: true,
    });
    expect(branch.label).toBe("Main");
  });

  it("creates RPG snapshots with defensive collection defaults", () => {
    const snapshot = createRpgStateSnapshot({
      id: "snapshot_1",
      worldId: "world_1",
      chatId: "chat_1",
      branchId: "branch_main",
      messageId: "msg_1",
      createdAt: "2026-06-27T15:05:00.000Z",
      player: {
        name: "User",
        level: 3,
        health: { current: 72, max: 100 },
        className: "Rogue",
      },
      location: "Unmapped threshold",
    });

    expect(snapshot.inventory).toEqual([]);
    expect(snapshot.activeQuestIds).toEqual([]);
    expect(snapshot.companionCharacterIds).toEqual([]);
    expect(snapshot.worldFlags).toEqual({});
    expect(snapshot.statusEffects).toEqual([]);
  });

  it("keeps literal category registries narrow enough for extraction contracts", () => {
    expect(CHARACTER_ORIGINS).toContain("auto_extracted");
    expect(CHAT_MODES).toContain("group_scene");
    expect(EVENT_KINDS).toContain("knowledge_change");
    expect(KNOWLEDGE_TYPES).toContain("false_belief");
    expect(LOREBOOK_SCOPES).toContain("character");
    expect(MEMORY_CATEGORIES).toContain("contradiction_log");
    expect(MODEL_PROVIDER_KINDS).toContain("local_endpoint");
    expect(RPG_RULESET_STYLES).toContain("narrative_light");
    expect(DEFAULT_PROMPT_LAYER_ORDER[0]).toBe("global_runtime_rules");
    expect(DEFAULT_PROMPT_LAYER_ORDER).toContain("pre_history_directive");
    expect(DEFAULT_PROMPT_LAYER_ORDER).toContain("post_history_directive");
  });

  it("supports branch-aware messages and extraction payloads as compile-time contracts", () => {
    const message: MessageNode = {
      id: "msg_2",
      chatId: "chat_1",
      branchId: "branch_main",
      parentMessageId: "msg_1",
      role: "assistant",
      content: "The runtime asks which local rule should govern entry.",
      stateSnapshotId: "snapshot_2",
      createdAt: "2026-06-27T15:10:00.000Z",
      promptRunId: "prompt_run_1",
    };

    const knowledge: CharacterKnowledgeRecord = {
      id: "knowledge_1",
      characterId: "char_example_keeper",
      eventId: "event_1",
      chatId: "chat_1",
      knowledgeType: "witnessed",
      certainty: 0.95,
      interpretation: "The user reached a threshold and expected the card rules to govern entry.",
      canDiscussWith: ["user", "household_staff"],
      createdAt: "2026-06-27T15:10:00.000Z",
      updatedAt: "2026-06-27T15:10:00.000Z",
    };

    const extraction: ExtractionResultPayload = {
      schemaVersion: 1,
      newCharacters: [],
      updatedCharacters: [],
      newEvents: [],
      characterKnowledgeUpdates: [knowledge],
      relationshipUpdates: [],
      memoryUpdates: [],
      rpgStateUpdates: {
        location: null,
        healthDelta: 0,
        inventoryAdd: [],
        inventoryRemove: [],
        questUpdates: [],
        worldFlags: {},
      },
      imagePromptOpportunity: {
        shouldGenerate: false,
        reason: null,
        visualSceneSummary: null,
      },
      continuityWarnings: [],
    };

    expect(message.stateSnapshotId).toBe("snapshot_2");
    expect(extraction.characterKnowledgeUpdates[0]?.knowledgeType).toBe("witnessed");
  });

  it("keeps aggregate domain contracts aligned with split chat and RPG modules", () => {
    const narratorMessage: MessageNode = {
      id: "msg_narrator",
      chatId: "chat_1",
      branchId: "branch_main",
      role: "narrator",
      content: "The scene widens beyond the active character.",
      createdAt: "2026-06-27T15:12:00.000Z",
    };
    const snapshot = createRpgStateSnapshot({
      id: "snapshot_without_message",
      worldId: "world_1",
      chatId: "chat_1",
      branchId: "branch_main",
      createdAt: "2026-06-27T15:12:00.000Z",
      player: {
        name: "User",
      },
      location: "Archive",
      sceneSummary: "The archive quiets after the warning.",
      inventory: [
        {
          name: "brass key",
          quantity: 1,
          tags: ["quest"],
        },
      ],
      quests: [
        {
          id: "quest_gate",
          title: "Open the gate",
          status: "active",
          objectives: ["Find the oath"],
        },
      ],
      injuries: ["bruised shoulder"],
    });

    expect(narratorMessage.role).toBe("narrator");
    expect(snapshot.messageId).toBeUndefined();
    expect(snapshot.inventory[0]).toMatchObject({ name: "brass key", quantity: 1 });
    expect(snapshot.quests[0]?.status).toBe("active");
    expect(snapshot.injuries).toEqual(["bruised shoulder"]);
  });
});
