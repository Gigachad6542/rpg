import { describe, expect, it, vi } from "vitest";

import {
  archiveActiveChatState,
  deleteActiveChatState,
  restoreArchivedChatState,
} from "../../src/app/chatLifecycle";
import { createChatSession } from "../../src/app/chatSessions";
import { initializeChatTurnState } from "../../src/app/chatTurnState";
import { initialCards } from "../../src/app/appDefaults";
import type { GeneratedMapArtifact, PromptRun } from "../../src/app/runtimeTypes";

describe("chat lifecycle mutations", () => {
  it("deletes only the active chat and retains archived history", () => {
    const card = initialCards[0];
    const active = initializeChatTurnState(
      createChatSession(card.id, "Active", { id: "chat_active" }),
      card,
    );
    const archived = {
      ...initializeChatTurnState(
        createChatSession(card.id, "Archived", { id: "chat_archived" }),
        card,
      ),
      archived: true,
    };
    const fallback = initializeChatTurnState(
      createChatSession(card.id, "Fallback", { id: "chat_fallback" }),
      card,
    );
    const createFallbackChat = vi.fn(() => fallback);

    const result = deleteActiveChatState({
      activeCard: card,
      activeChat: active,
      cards: [card],
      chatSessions: [active, archived],
      activeChatIds: { [card.id]: active.id },
      promptRuns: [promptRun(active.id), promptRun(archived.id)],
      generatedMaps: [artifact(active.id), artifact(archived.id)],
      createFallbackChat,
    });

    expect(createFallbackChat).toHaveBeenCalledOnce();
    expect(result.chatSessions.map((chat) => chat.id)).toEqual([archived.id, fallback.id]);
    expect(result.activeChatIds[card.id]).toBe(fallback.id);
    expect(result.promptRuns.map((run) => run.chatId)).toEqual([archived.id]);
    expect(result.generatedMaps.map((item) => item.chatId)).toEqual([archived.id]);
  });

  it("selects an existing non-archived fallback without creating another chat", () => {
    const card = initialCards[0];
    const active = initializeChatTurnState(
      createChatSession(card.id, "Active", { id: "chat_active" }),
      card,
    );
    const existing = initializeChatTurnState(
      createChatSession(card.id, "Existing", { id: "chat_existing" }),
      card,
    );
    const createFallbackChat = vi.fn(() => {
      throw new Error("must not create fallback");
    });

    const result = deleteActiveChatState({
      activeCard: card,
      activeChat: active,
      cards: [card],
      chatSessions: [active, existing],
      activeChatIds: { [card.id]: active.id },
      promptRuns: [],
      generatedMaps: [],
      createFallbackChat,
    });

    expect(createFallbackChat).not.toHaveBeenCalled();
    expect(result.chatSessions.map((chat) => chat.id)).toEqual([existing.id]);
    expect(result.activeChatIds[card.id]).toBe(existing.id);
  });

  it("retains prompt runs from a deleted parent while a branch still references them", () => {
    const card = initialCards[0];
    const active = initializeChatTurnState(
      createChatSession(card.id, "Parent", {
        id: "chat_parent",
        messages: [{ id: "assistant-parent", role: "assistant", content: "Parent reply", promptRunId: "run-shared" }],
      }),
      card,
    );
    const branch = initializeChatTurnState(
      createChatSession(card.id, "Branch", {
        id: "chat_branch",
        branchOfId: active.id,
        messages: [{
          id: "assistant-branch",
          role: "assistant",
          content: "Variant two",
          promptRunId: "run-shared",
          variants: ["Variant one", "Variant two"],
          activeVariantIndex: 1,
          variantRunIds: ["run-shared", "run-branch-variant"],
        }],
      }),
      card,
    );

    const result = deleteActiveChatState({
      activeCard: card,
      activeChat: active,
      cards: [card],
      chatSessions: [active, branch],
      activeChatIds: { [card.id]: active.id },
      promptRuns: [promptRunWithId("run-shared", active.id), promptRunWithId("run-orphan", active.id)],
      generatedMaps: [],
      createFallbackChat: () => branch,
    });

    expect(result.promptRuns.map((run) => run.id)).toEqual(["run-shared"]);

    const afterBranchDeletion = deleteActiveChatState({
      activeCard: result.cards[0],
      activeChat: branch,
      cards: result.cards,
      chatSessions: result.chatSessions,
      activeChatIds: result.activeChatIds,
      promptRuns: result.promptRuns,
      generatedMaps: [],
      createFallbackChat: () => initializeChatTurnState(
        createChatSession(card.id, "Fallback", { id: "chat_final_fallback" }),
        card,
      ),
    });
    expect(afterBranchDeletion.promptRuns).toEqual([]);
  });

  it("archives the last active chat without dropping older archives", () => {
    const card = initialCards[0];
    const active = initializeChatTurnState(
      createChatSession(card.id, "Active", { id: "chat_active" }),
      card,
    );
    const olderArchive = {
      ...initializeChatTurnState(
        createChatSession(card.id, "Older archive", { id: "chat_older_archive" }),
        card,
      ),
      archived: true,
    };
    const fallback = initializeChatTurnState(
      createChatSession(card.id, "Fallback", { id: "chat_fallback" }),
      card,
    );

    const result = archiveActiveChatState({
      activeCard: card,
      activeChat: active,
      cards: [card],
      chatSessions: [active, olderArchive],
      activeChatIds: { [card.id]: active.id },
      createFallbackChat: () => fallback,
    });

    expect(result.chatSessions.map((chat) => [chat.id, chat.archived])).toEqual([
      [active.id, true],
      [olderArchive.id, true],
      [fallback.id, false],
    ]);
    expect(result.activeChatIds[card.id]).toBe(fallback.id);
  });

  it("restores an archived chat as the active continuity branch", () => {
    const card = initialCards[0];
    const archived = {
      ...initializeChatTurnState(
        createChatSession(card.id, "Archived", { id: "chat_archived" }),
        card,
      ),
      archived: true,
    };

    const result = restoreArchivedChatState({
      activeCard: card,
      archivedChat: archived,
      cards: [card],
      chatSessions: [archived],
      activeChatIds: {},
    });

    expect(result.chatSessions).toHaveLength(1);
    expect(result.chatSessions[0]).toMatchObject({ id: archived.id, archived: false });
    expect(result.activeChatIds[card.id]).toBe(archived.id);
  });
});

function promptRun(chatId: string): PromptRun {
  return promptRunWithId(`run_${chatId}`, chatId);
}

function promptRunWithId(id: string, chatId: string): PromptRun {
  return {
    id,
    cardId: initialCards[0].id,
    chatId,
    compiledPrompt: "",
    response: "",
    provider: "mock",
    model: "mock",
    tokenEstimate: 0,
    includedLayerIds: [],
    includedLoreEntryIds: [],
    warnings: [],
    stateChanges: [],
  };
}

function artifact(chatId: string): GeneratedMapArtifact {
  return {
    id: `artifact_${chatId}`,
    imageKind: "map",
    cardId: initialCards[0].id,
    chatId,
    prompt: "map",
    negativePrompt: "",
    provider: "prompt-only",
    model: "none",
    status: "prompt-only",
    createdAt: "2026-07-14T00:00:00.000Z",
  };
}
