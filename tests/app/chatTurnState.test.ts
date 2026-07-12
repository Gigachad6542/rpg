import { describe, expect, it } from "vitest";

import {
  branchChatTurnState,
  deriveCardForChat,
  deriveCardForRegeneration,
  initializeChatTurnState,
  recordChatTurnVariant,
  recordRegeneratedChatVariant,
  switchChatMessageVariant,
} from "../../src/app/chatTurnState";
import { createChatSession, parseChatSessions } from "../../src/app/chatSessions";
import type { ChatSession, Message, RuntimeCard } from "../../src/app/runtimeTypes";
import { createEmptyExtractionResult } from "../../src/runtime/extraction";
import { createEmptyHiddenContinuityResult } from "../../src/runtime/hiddenContinuity";
import { createRuntimeTurnEffects } from "../../src/runtime/runtimeTurnLineage";

function card(inventory: string[] = []): RuntimeCard {
  return {
    id: "card_test",
    name: "Test",
    kind: "rpg",
    summary: "A test world",
    characterName: "Guide",
    characterDescription: "",
    scenario: "",
    greeting: "",
    exampleDialogs: "",
    systemPrompt: "",
    preHistoryInstructions: "",
    postHistoryInstructions: "",
    playerRules: [],
    lorebooks: [],
    memory: [],
    storyEntities: [],
    mapEnabled: true,
    rpg: {
      location: "Start",
      health: "10/10",
      inventory,
      quests: [],
      flags: {},
      knownPlaces: ["Start"],
      mapStyle: "map",
    },
  };
}

function effects(item: string, seed = item) {
  const extraction = createEmptyExtractionResult();
  extraction.rpg_state_updates.inventory_add = [item];
  return createRuntimeTurnEffects({
    hiddenContinuity: createEmptyHiddenContinuityResult(),
    extraction,
    committedAt: "2026-07-11T12:00:00.000Z",
    idSeed: seed,
  });
}

function turnMessages(assistantId = "a1", activeVariantIndex = 0): Message[] {
  return [
    { id: "u1", role: "user", content: "I choose." },
    { id: assistantId, role: "assistant", content: "Done.", activeVariantIndex },
  ];
}

describe("chat turn-state integration helpers", () => {
  it("migrates legacy chats to a persisted synthetic base", () => {
    const legacyCard = card(["legacy item"]);
    const [session] = parseChatSessions(
      [{ id: "chat_legacy", cardId: legacyCard.id, messages: [] }],
      [legacyCard],
      [],
      legacyCard.id,
    );

    expect(session.turnLineage?.baseState.rpg?.inventory).toEqual(["legacy item"]);
    expect(session.turnLineage?.ledger).toEqual({});
  });

  it("records a normal turn and derives the card from the chat lineage", () => {
    const baseCard = card();
    let session = initializeChatTurnState(createChatSession(baseCard.id, "Chat"), baseCard);
    session = { ...session, messages: turnMessages() };
    session = recordChatTurnVariant(session, baseCard, "a1", 0, effects("torch"));

    expect(deriveCardForChat(baseCard, session).rpg?.inventory).toEqual(["torch"]);
  });

  it("regenerates from pre-turn state and carries prior variant effects to the replacement message", () => {
    const baseCard = card();
    let session = initializeChatTurnState(createChatSession(baseCard.id, "Chat"), baseCard);
    session = { ...session, messages: turnMessages("a-old", 0) };
    session = recordChatTurnVariant(session, baseCard, "a-old", 0, effects("discarded sword", "old"));

    expect(deriveCardForRegeneration(baseCard, session, "a-old").rpg?.inventory).toEqual([]);

    const replacementMessages = turnMessages("a-new", 1);
    const regenerated = recordRegeneratedChatVariant({
      chat: { ...session, messages: replacementMessages },
      card: baseCard,
      retainedMessages: [],
      replacedAssistantMessageId: "a-old",
      replacementAssistantMessageId: "a-new",
      variantIndex: 1,
      effects: effects("shield", "new"),
    });

    expect(regenerated.turnLineage?.ledger["a-old"]).toBeUndefined();
    expect(regenerated.turnLineage?.ledger["a-new"].variants.map((variant) => variant.variantIndex)).toEqual([0, 1]);
    expect(deriveCardForChat(baseCard, regenerated).rpg?.inventory).toEqual(["shield"]);

    const firstVariant = switchChatMessageVariant(regenerated, baseCard, "a-new", -1);
    expect(firstVariant.changed).toBe(true);
    expect(deriveCardForChat(baseCard, firstVariant.chat).rpg?.inventory).toEqual(["discarded sword"]);
  });

  it("remaps branch lineage and lets parent and branch evolve independently", () => {
    const baseCard = card();
    let parent = initializeChatTurnState(createChatSession(baseCard.id, "Parent"), baseCard);
    parent = { ...parent, messages: turnMessages("a-parent", 0) };
    parent = recordChatTurnVariant(parent, baseCard, "a-parent", 0, effects("torch"));

    const branchMessages: Message[] = [
      { id: "u-branch", role: "user", content: "I choose." },
      { id: "a-branch", role: "assistant", content: "Done.", activeVariantIndex: 0 },
    ];
    const branch = branchChatTurnState(
      parent,
      { ...createChatSession(baseCard.id, "Branch"), messages: branchMessages },
      baseCard,
    );
    const evolvedBranch = recordChatTurnVariant(branch, baseCard, "a-branch", 1, effects("lantern"));
    const branchOnSecond = {
      ...evolvedBranch,
      messages: evolvedBranch.messages.map((message) =>
        message.id === "a-branch" ? { ...message, activeVariantIndex: 1 } : message,
      ),
    };

    expect(deriveCardForChat(baseCard, parent).rpg?.inventory).toEqual(["torch"]);
    expect(deriveCardForChat(baseCard, branchOnSecond).rpg?.inventory).toEqual(["lantern"]);
  });

  it("refuses to swipe an earlier variant while dependent downstream turns remain", () => {
    const baseCard = card();
    const messages: Message[] = [
      ...turnMessages("a1", 1),
      { id: "u2", role: "user", content: "Next." },
      { id: "a2", role: "assistant", content: "Later." },
    ];
    let session = initializeChatTurnState(
      { ...createChatSession(baseCard.id, "Chat"), messages },
      baseCard,
    );
    session = {
      ...session,
      messages: session.messages.map((message) =>
        message.id === "a1"
          ? { ...message, variants: ["First", "Second"], activeVariantIndex: 1 }
          : message,
      ),
    };
    session = recordChatTurnVariant(session, baseCard, "a1", 0, effects("torch"));
    session = recordChatTurnVariant(session, baseCard, "a1", 1, effects("lantern"));
    session = recordChatTurnVariant(session, baseCard, "a2", 0, effects("rope"));

    const result = switchChatMessageVariant(session, baseCard, "a1", -1);
    expect(result.changed).toBe(false);
    expect(result.reason).toMatch(/downstream/i);
    expect(result.chat).toEqual(session);
  });
});
