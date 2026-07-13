import { describe, expect, it } from "vitest";

import {
  appendAuthoritativeEvent,
  branchAuthoritativeEventStream,
  createDiceRolledEvent,
  createPlayerActionEvent,
  createRuleDecisionEvent,
  createStateCommittedEvent,
  createToolResultEvent,
  parseAuthoritativeEventStream,
  replayAuthoritativeEvents,
  replayAuthoritativeRpgState,
  type AuthoritativeEventStream,
} from "../../src/runtime/authoritativeEventStream";

const occurredAt = "2026-07-12T12:00:00.000Z";

function playerAction() {
  return createPlayerActionEvent({
    id: "event_action",
    chatId: "chat_parent",
    branchId: "branch_main",
    messageId: "user_1",
    occurredAt,
    action: "I open the north gate with the brass key.",
    origin: "typed",
  });
}

function ruleDecision() {
  return createRuleDecisionEvent({
    id: "event_rule",
    chatId: "chat_parent",
    branchId: "branch_main",
    messageId: "user_1",
    occurredAt,
    action: "I open the north gate with the brass key.",
    engine: "player-rule-engine-v1",
    decision: {
      allowed: true,
      warning: null,
      triggeredRuleIds: [],
    },
  });
}

function stateCommit(variantIndex: number, item: string) {
  return createStateCommittedEvent({
    id: `event_state_${variantIndex}`,
    chatId: "chat_parent",
    branchId: "branch_main",
    messageId: "assistant_1",
    occurredAt,
    runId: `run_${variantIndex}`,
    variant: { assistantMessageId: "assistant_1", variantIndex },
    proposalIds: [`proposal_${variantIndex}`],
    mutations: [{ type: "inventory_add", item }],
  });
}

describe("authoritative event construction", () => {
  it("records dice outcomes as typed data instead of relying on rendered chat text", () => {
    const event = createDiceRolledEvent({
      id: "event_dice",
      chatId: "chat_parent",
      branchId: "branch_main",
      messageId: "dice_message",
      occurredAt,
      roll: {
        notation: "2d6+3",
        count: 2,
        sides: 6,
        modifier: 3,
        rolls: [4, 5],
        total: 12,
      },
    });

    expect(event).toEqual({
      schemaVersion: 1,
      id: "event_dice",
      kind: "dice_rolled",
      chatId: "chat_parent",
      branchId: "branch_main",
      messageId: "dice_message",
      occurredAt,
      roll: {
        notation: "2d6+3",
        count: 2,
        sides: 6,
        modifier: 3,
        rolls: [4, 5],
        total: 12,
      },
    });
  });

  it("records deterministic rule decisions with their engine and triggered rules", () => {
    expect(ruleDecision()).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        kind: "rule_decision",
        engine: "player-rule-engine-v1",
        action: "I open the north gate with the brass key.",
        decision: {
          allowed: true,
          warning: null,
          triggeredRuleIds: [],
        },
      }),
    );
  });

  it("keeps generic tool output structured and explicitly scoped to a generated variant", () => {
    const event = createToolResultEvent({
      id: "event_tool",
      chatId: "chat_parent",
      branchId: "branch_main",
      messageId: "assistant_1",
      occurredAt,
      runId: "run_1",
      variant: { assistantMessageId: "assistant_1", variantIndex: 1 },
      toolName: "lookup_difficulty",
      callId: "call_1",
      status: "success",
      result: { difficultyClass: 14, source: "gate-rules" },
    });

    expect(event.kind).toBe("tool_result");
    expect(event).toEqual(
      expect.objectContaining({
        variant: { assistantMessageId: "assistant_1", variantIndex: 1 },
        toolName: "lookup_difficulty",
        callId: "call_1",
        status: "success",
        result: { difficultyClass: 14, source: "gate-rules" },
      }),
    );
  });
});

describe("append-only authoritative event stream", () => {
  it("does not mutate prior snapshots or retain mutable payload references", () => {
    const mutableRolls = [4, 5];
    const dice = createDiceRolledEvent({
      id: "event_dice",
      chatId: "chat_parent",
      branchId: "branch_main",
      messageId: "dice_message",
      occurredAt,
      roll: {
        notation: "2d6+3",
        count: 2,
        sides: 6,
        modifier: 3,
        rolls: mutableRolls,
        total: 12,
      },
    });
    const first = appendAuthoritativeEvent([], dice);

    mutableRolls[0] = 1;
    const second = appendAuthoritativeEvent(first, playerAction());

    expect(first).toHaveLength(1);
    expect(first[0]).toEqual(expect.objectContaining({ kind: "dice_rolled", roll: expect.objectContaining({ rolls: [4, 5] }) }));
    expect(second).toHaveLength(2);
    expect(second).not.toBe(first);
  });

  it("rejects duplicate event ids instead of silently replacing history", () => {
    const stream = appendAuthoritativeEvent([], playerAction());

    expect(() => appendAuthoritativeEvent(stream, playerAction())).toThrow(/duplicate.*event_action/i);
  });
});

describe("authoritative event replay", () => {
  it("keeps durable run-scoped attempts even when no transcript message was committed", () => {
    const action = createPlayerActionEvent({
      id: "event_blocked_action",
      chatId: "chat_parent",
      branchId: "branch_main",
      messageId: "attempt_message",
      occurredAt,
      runId: "run_blocked",
      action: "I teleport through the wall.",
      origin: "typed",
    });
    const decision = createRuleDecisionEvent({
      id: "event_blocked_rule",
      chatId: "chat_parent",
      branchId: "branch_main",
      messageId: "attempt_message",
      occurredAt,
      runId: "run_blocked",
      action: "I teleport through the wall.",
      engine: "player-rule-engine-v1",
      decision: { allowed: false, warning: "Movement blocked.", triggeredRuleIds: ["movement"] },
    });

    const replayed = replayAuthoritativeEvents([action, decision], {
      chatId: "chat_parent",
      branchId: "branch_main",
      messages: [],
    });

    expect(replayed.map((event) => event.id)).toEqual(["event_blocked_action", "event_blocked_rule"]);
    expect(replayed.every((event) => event.runId === "run_blocked")).toBe(true);
  });

  it("reconstructs the active RPG projection from typed state mutations", () => {
    const event = createStateCommittedEvent({
      id: "event_state_projection",
      chatId: "chat_parent",
      branchId: "branch_main",
      messageId: "assistant_1",
      occurredAt,
      runId: "run_projection",
      variant: { assistantMessageId: "assistant_1", variantIndex: 0 },
      proposalIds: ["proposal_projection"],
      mutations: [
        { type: "inventory_remove", item: "old key" },
        { type: "inventory_add", item: "new key" },
        { type: "quest_remove", quest: "Find the gate" },
        { type: "quest_set", quest: "Open the gate" },
        { type: "world_flag_remove", flag: "gate_locked" },
        { type: "world_flag_set", flag: "gate_open", value: true },
        { type: "known_place_remove", place: "Old road" },
        { type: "known_place_add", place: "North gate" },
      ],
    });

    expect(replayAuthoritativeRpgState({
      location: "Road",
      health: "10/10",
      inventory: ["old key"],
      quests: ["Find the gate"],
      flags: { gate_locked: true },
      knownPlaces: ["Old road"],
    }, [event], {
      chatId: "chat_parent",
      branchId: "branch_main",
      messages: [{ id: "assistant_1", role: "assistant", activeVariantIndex: 0 }],
    })).toEqual({
      location: "Road",
      health: "10/10",
      inventory: ["new key"],
      quests: ["Open the gate"],
      flags: { gate_open: true },
      knownPlaces: ["North gate"],
    });
  });

  it("replays only the requested branch and the active assistant variant in stable order", () => {
    let stream: AuthoritativeEventStream = [];
    stream = appendAuthoritativeEvent(stream, playerAction());
    stream = appendAuthoritativeEvent(stream, ruleDecision());
    stream = appendAuthoritativeEvent(stream, stateCommit(0, "sword"));
    stream = appendAuthoritativeEvent(stream, stateCommit(1, "shield"));
    stream = appendAuthoritativeEvent(
      stream,
      createPlayerActionEvent({
        id: "event_other_branch",
        chatId: "chat_parent",
        branchId: "branch_other",
        messageId: "other_user",
        occurredAt,
        action: "This must never leak across branches.",
        origin: "typed",
      }),
    );

    const replayed = replayAuthoritativeEvents(stream, {
      chatId: "chat_parent",
      branchId: "branch_main",
      messages: [
        { id: "user_1", role: "user" },
        { id: "assistant_1", role: "assistant", activeVariantIndex: 1 },
      ],
    });

    expect(replayed.map((event) => event.id)).toEqual(["event_action", "event_rule", "event_state_1"]);
    expect(replayed.find((event) => event.kind === "state_committed")).toEqual(
      expect.objectContaining({ mutations: [{ type: "inventory_add", item: "shield" }] }),
    );
  });

  it("fails closed for an explicitly undone active variant", () => {
    const stream = [playerAction(), stateCommit(1, "shield")];

    const replayed = replayAuthoritativeEvents(stream, {
      chatId: "chat_parent",
      branchId: "branch_main",
      messages: [
        { id: "user_1", role: "user" },
        {
          id: "assistant_1",
          role: "assistant",
          activeVariantIndex: 1,
          undoneVariantIndices: [1],
        },
      ],
    });

    expect(replayed.map((event) => event.id)).toEqual(["event_action"]);
  });

  it("round-trips through persisted JSON without changing deterministic replay", () => {
    const stream = [playerAction(), ruleDecision(), stateCommit(0, "torch")];
    const context = {
      chatId: "chat_parent",
      branchId: "branch_main",
      messages: [
        { id: "user_1", role: "user" as const },
        { id: "assistant_1", role: "assistant" as const, activeVariantIndex: 0 },
      ],
    };

    const restored = parseAuthoritativeEventStream(JSON.parse(JSON.stringify(stream)));

    expect(replayAuthoritativeEvents(restored, context)).toEqual(replayAuthoritativeEvents(stream, context));
  });
});

describe("authoritative event branch handling", () => {
  it("copies only mapped causal history and remaps message plus variant ownership", () => {
    const parent = [
      playerAction(),
      ruleDecision(),
      stateCommit(0, "torch"),
      createPlayerActionEvent({
        id: "event_descendant",
        chatId: "chat_parent",
        branchId: "branch_main",
        messageId: "user_2",
        occurredAt,
        action: "A downstream action outside the fork prefix.",
        origin: "typed",
      }),
    ];

    const branch = branchAuthoritativeEventStream(parent, {
      sourceChatId: "chat_parent",
      sourceBranchId: "branch_main",
      targetChatId: "chat_branch",
      targetBranchId: "branch_fork",
      messageIdMap: new Map([
        ["user_1", "user_1_branch"],
        ["assistant_1", "assistant_1_branch"],
      ]),
      createEventId: (event, index) => `${event.id}__fork_${index}`,
    });

    expect(branch.map((event) => event.id)).toEqual([
      "event_action__fork_0",
      "event_rule__fork_1",
      "event_state_0__fork_2",
    ]);
    expect(branch).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "event_state_0__fork_2",
          originEventId: "event_state_0",
          chatId: "chat_branch",
          branchId: "branch_fork",
          messageId: "assistant_1_branch",
          variant: { assistantMessageId: "assistant_1_branch", variantIndex: 0 },
        }),
      ]),
    );
    expect(parent.map((event) => event.id)).toEqual([
      "event_action",
      "event_rule",
      "event_state_0",
      "event_descendant",
    ]);
  });

  it("lets a branch append new history without mutating its parent stream", () => {
    const parent = [playerAction()];
    const branch = branchAuthoritativeEventStream(parent, {
      sourceChatId: "chat_parent",
      sourceBranchId: "branch_main",
      targetChatId: "chat_branch",
      targetBranchId: "branch_fork",
      messageIdMap: new Map([["user_1", "user_1_branch"]]),
      createEventId: (event) => `${event.id}__fork`,
    });
    const evolvedBranch = appendAuthoritativeEvent(
      branch,
      createPlayerActionEvent({
        id: "event_branch_only",
        chatId: "chat_branch",
        branchId: "branch_fork",
        messageId: "user_2_branch",
        occurredAt,
        action: "I take the branch-only path.",
        origin: "typed",
      }),
    );

    expect(parent.map((event) => event.id)).toEqual(["event_action"]);
    expect(branch.map((event) => event.id)).toEqual(["event_action__fork"]);
    expect(evolvedBranch.map((event) => event.id)).toEqual(["event_action__fork", "event_branch_only"]);
  });
});

describe("authoritative event persistence boundary", () => {
  it("supports deterministic tools that are not owned by an assistant variant", () => {
    const event = createToolResultEvent({
      id: "event_dice_tool",
      chatId: "chat_parent",
      branchId: "branch_main",
      messageId: "dice_message",
      occurredAt,
      runId: "run_dice",
      toolName: "dice.roll",
      callId: "run_dice",
      status: "success",
      result: { notation: "1d6", rolls: [4], total: 4 },
    });

    expect(event).toEqual(expect.objectContaining({ kind: "tool_result", runId: "run_dice" }));
    expect(event).not.toHaveProperty("variant");
  });

  it("rejects secret-bearing tool results so credentials never enter the event log", () => {
    expect(parseAuthoritativeEventStream([
      {
        schemaVersion: 1,
        id: "event-secret-tool",
        kind: "tool_result",
        chatId: "chat_parent",
        branchId: "branch_main",
        messageId: "assistant_1",
        occurredAt,
        runId: "run_1",
        variant: { assistantMessageId: "assistant_1", variantIndex: 0 },
        toolName: "provider_probe",
        callId: "call_1",
        status: "success",
        result: { authorization: "Bearer sk-sensitive-event-token" },
      },
    ])).toEqual([]);

    const secretResults: Array<Record<string, string>> = [
      { token: "ghp_123456789012345678901234567890123456" },
      { sessionToken: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature" },
      { clientSecret: "not-safe-to-persist" },
      { privateKey: "-----BEGIN PRIVATE KEY-----payload-----END PRIVATE KEY-----" },
      { accessKey: "AKIAIOSFODNN7EXAMPLE" },
    ];
    for (const result of secretResults) {
      expect(() => createToolResultEvent({
        id: `event-secret-${Object.keys(result)[0]}`,
        chatId: "chat_parent",
        branchId: "branch_main",
        messageId: "assistant_1",
        occurredAt,
        runId: "run_secret",
        toolName: "provider_probe",
        callId: "call_secret",
        status: "success",
        result,
      })).toThrow(/invalid authoritative tool result/i);
    }
  });

  it("drops unknown or malformed persisted events instead of replaying untrusted data", () => {
    const restored = parseAuthoritativeEventStream([
      playerAction(),
      {
        schemaVersion: 1,
        id: "event_unknown",
        kind: "arbitrary_model_claim",
        chatId: "chat_parent",
        branchId: "branch_main",
        messageId: "assistant_1",
        occurredAt,
      },
      {
        schemaVersion: 1,
        id: "event_bad_dice",
        kind: "dice_rolled",
        chatId: "chat_parent",
        branchId: "branch_main",
        messageId: "dice_message",
        occurredAt,
        roll: {
          notation: "2d6+3",
          count: 2,
          sides: 6,
          modifier: 3,
          rolls: [4, 99],
          total: 106,
        },
      },
    ]);

    expect(restored).toEqual([playerAction()]);
  });
});
