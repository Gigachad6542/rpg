import { describe, expect, it, vi } from "vitest";

import {
  TURN_PIPELINE_LAYER_IDS,
  compileTurnPrompt,
  runTurnPipeline,
  type RunTurnPipelineRequest,
} from "../../src/runtime/turnPipeline";
import type {
  ModelInfo,
  TextGenerationRequest,
  TextGenerationResponse,
  TextModelAdapter,
} from "../../src/providers/TextModelAdapter";

class RecordingTextAdapter implements TextModelAdapter {
  readonly id = "recording";
  readonly displayName = "Recording text adapter";
  readonly requests: TextGenerationRequest[] = [];

  constructor(private readonly response: Omit<TextGenerationResponse, "providerId" | "model">) {}

  async listModels(): Promise<ModelInfo[]> {
    return [];
  }

  async generateText(request: TextGenerationRequest): Promise<TextGenerationResponse> {
    this.requests.push(request);

    return {
      ...this.response,
      providerId: this.id,
      model: request.model,
    };
  }
}

class StreamingTextAdapter extends RecordingTextAdapter {
  async *streamText(request: TextGenerationRequest) {
    this.requests.push(request);
    yield { text: "Streamed ", index: 0, done: false };
    yield { text: "reply", index: 1, done: false };
    yield { text: "", index: 2, done: true };
  }
}

describe("turn pipeline", () => {
  it("compiles local RPG context, calls the adapter, validates extraction, and reports run metadata", async () => {
    const adapter = new RecordingTextAdapter({
      text: [
        "The lantern gate opens, but the heat bites before the threshold gives way.",
        "",
        "```json",
        JSON.stringify({
          extraction: {
            rpg_state_updates: {
              location: "Lantern Gate",
              health_delta: -1,
              inventory_add: ["ember key"],
            },
            continuity_warnings: ["Lantern Gate may contradict the previous unmapped location."],
          },
        }),
        "```",
      ].join("\n"),
      finishReason: "stop",
      usage: {
        inputTokens: 120,
        outputTokens: 40,
        totalTokens: 160,
      },
    });

    const result = await runTurnPipeline({
      ...baseRequest(adapter),
      promptRunId: "prompt_test_001",
      now: () => "2026-06-27T18:00:00.000Z",
    });

    expect(adapter.requests).toHaveLength(1);
    expect(adapter.requests[0].model).toBe("mock-narrator");
    expect(adapter.requests[0].temperature).toBe(0.3);
    expect(adapter.requests[0].prompt).toContain("Respect card boundaries");
    expect(adapter.requests[0].prompt).toContain("Pinned fact: The player promised not to steal from shrine keepers.");
    expect(adapter.requests[0].prompt).toContain("[Gatehouse | priority 10]");
    expect(adapter.requests[0].prompt).toContain("Location: Unmapped road");
    expect(adapter.requests[0].prompt).toContain("## User latest message\nI approach the glowing lantern gate.");
    expect(adapter.requests[0].prompt).toContain("Presentation rules: use *single asterisks*");
    expect(adapter.requests[0].metadata?.includedLayerIds).toContain(TURN_PIPELINE_LAYER_IDS.rpgState);

    expect(result.assistantMessageText).toBe(
      "The lantern gate opens, but the heat bites before the threshold gives way.",
    );
    expect(result.promptRun.id).toBe("prompt_test_001");
    expect(result.promptRun.providerId).toBe("recording");
    expect(result.promptRun.includedLayerIds).toContain(TURN_PIPELINE_LAYER_IDS.latestUserMessage);
    expect(result.promptRun.includedMemoryIds).toEqual(["mem-promise"]);
    expect(result.promptRun.includedLoreEntryIds).toEqual(["lore-gate"]);
    expect(result.promptRun.includedStateSnapshotId).toBe("state-1");
    expect(result.promptRun.extractionValidated).toBe(true);
    expect(result.stateProposals.rpgStateUpdates.location).toBe("Lantern Gate");
    expect(result.stateProposals.rpgStateUpdates.health_delta).toBe(-1);
    expect(result.stateProposals.rpgStateUpdates.inventory_add).toEqual(["ember key"]);
    expect(result.warnings).toContainEqual({
      code: "continuity_warning",
      message: "Lantern Gate may contradict the previous unmapped location.",
    });
  });

  it("surfaces invalid extraction as warnings and uses persistence callbacks without a DB", async () => {
    const adapter = new RecordingTextAdapter({
      text: JSON.stringify({
        assistant_message: "The blow lands, but the runtime holds the health change for validation.",
        extraction: {
          rpg_state_updates: {
            health_delta: "wounded",
          },
        },
      }),
      finishReason: "length",
      usage: {
        inputTokens: 50,
        outputTokens: 15,
        totalTokens: 65,
      },
    });
    const savePromptRun = vi.fn();
    const saveAssistantMessage = vi.fn();
    const saveStateProposals = vi.fn();

    const result = await runTurnPipeline({
      ...baseRequest(adapter),
      promptRunId: "prompt_test_002",
      persistence: {
        savePromptRun,
        saveAssistantMessage,
        saveStateProposals,
      },
    });

    expect(result.assistantMessageText).toBe(
      "The blow lands, but the runtime holds the health change for validation.",
    );
    expect(result.promptRun.extractionValidated).toBe(false);
    expect(result.stateProposals.rpgStateUpdates.health_delta).toBe(0);
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "provider_finish_reason",
      "invalid_extraction",
    ]);
    expect(result.warnings[1].issues?.[0]?.path).toContain("rpg_state_updates.health_delta");
    expect(savePromptRun).toHaveBeenCalledWith(result.promptRun);
    expect(saveAssistantMessage).toHaveBeenCalledWith(result.assistantMessage);
    expect(saveStateProposals).toHaveBeenCalledWith(result.stateProposals);
  });

  it("uses streamText when streaming is preferred and available", async () => {
    const adapter = new StreamingTextAdapter({
      text: "unused",
      finishReason: "stop",
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
      },
    });
    const streamedText: string[] = [];

    const result = await runTurnPipeline({
      ...baseRequest(adapter),
      preferStreaming: true,
      onStreamText: (text) => {
        streamedText.push(text);
      },
    });

    expect(adapter.requests).toHaveLength(1);
    expect(streamedText).toEqual(["Streamed ", "Streamed reply"]);
    expect(result.assistantMessageText).toBe("Streamed reply");
    expect(result.promptRun.metadata).toBeUndefined();
    expect(result.promptRun.usage.totalTokens).toBeGreaterThan(0);
  });

  it("does not claim memory IDs that were trimmed out of the compiled prompt", async () => {
    const adapter = new RecordingTextAdapter({
      text: "A short reply.",
      finishReason: "stop",
      usage: {
        inputTokens: 20,
        outputTokens: 4,
        totalTokens: 24,
      },
    });

    const result = await runTurnPipeline({
      ...baseRequest(adapter),
      memoryEntries: [
        { id: "mem-keep", text: "small memory" },
        { id: "mem-trimmed", text: "oversized memory ".repeat(80) },
      ],
      loreEntries: [{ id: "lore-keep", content: "small lore", priority: 10 }],
      tokenBudget: {
        maxInputTokens: 1_500,
        reservedOutputTokens: 200,
      },
      estimator: (text) => text.length,
      includeLayerLabels: false,
    });

    expect(result.promptRun.truncatedLayerIds).toContain(TURN_PIPELINE_LAYER_IDS.longTermMemory);
    expect(result.promptRun.includedMemoryIds).not.toContain("mem-trimmed");
  });

  it("does not claim lore IDs that were trimmed out of the compiled prompt", async () => {
    const adapter = new RecordingTextAdapter({
      text: "A short reply.",
      finishReason: "stop",
      usage: {
        inputTokens: 20,
        outputTokens: 4,
        totalTokens: 24,
      },
    });

    const result = await runTurnPipeline({
      ...baseRequest(adapter),
      memoryEntries: [{ id: "mem-keep", text: "small memory" }],
      loreEntries: [
        { id: "lore-keep", content: "small lore", priority: 10 },
        { id: "lore-trimmed", content: "oversized lore ".repeat(140), priority: 1 },
      ],
      tokenBudget: {
        maxInputTokens: 1_600,
        reservedOutputTokens: 200,
      },
      estimator: (text) => text.length,
      includeLayerLabels: false,
    });

    expect(result.promptRun.truncatedLayerIds).toContain(TURN_PIPELINE_LAYER_IDS.lorebookEntries);
    expect(result.promptRun.includedLoreEntryIds).not.toContain("lore-trimmed");
  });

  it("strips embedded extraction JSON from visible assistant prose", async () => {
    const adapter = new RecordingTextAdapter({
      text: `The gate opens. ${JSON.stringify({
        extraction: {
          rpg_state_updates: {
            location: "Gatehouse",
          },
        },
      })}`,
      finishReason: "stop",
      usage: {
        inputTokens: 30,
        outputTokens: 8,
        totalTokens: 38,
      },
    });

    const result = await runTurnPipeline({
      ...baseRequest(adapter),
    });

    expect(result.assistantMessageText).toBe("The gate opens.");
    expect(result.stateProposals.rpgStateUpdates.location).toBe("Gatehouse");
  });

  it("compiles optional layers, explicit latest messages, empty lists, and complex RPG state values", () => {
    const { modelAdapter: _adapter, model: _model, ...request } = baseRequest(
      new RecordingTextAdapter({
        text: "",
        finishReason: "stop",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      }),
    );
    const circularPlayer: Record<string, unknown> = { name: "Nia" };
    circularPlayer.self = circularPlayer;
    const throwingValue = {
      toJSON() {
        throw new Error("cannot serialize");
      },
    };

    const compiled = compileTurnPrompt({
      ...request,
      session: {
        id: "session-full",
        title: "Full Session",
        mode: "rpg",
        summary: "The table watches the north gate.",
        systemPrompt: "Session system instruction.",
      },
      card: {
        id: "card-full",
        name: "Guide",
        kind: "npc",
        summary: "A careful local guide.",
        systemPrompt: "Card system instruction.",
        characterDefinition: "Guide remembers only witnessed facts.",
        userPersona: "The player is a cautious scout.",
        preHistoryInstructions: "Pre-history instruction.",
        postHistoryInstructions: "Post-history instruction.",
        knowledgeBoundaries: "Card boundary.",
        assistantPrefill: "Card prefill.",
      },
      latestUserMessage: "Explicit latest action.",
      rules: [
        { id: "disabled", description: "Hidden rule.", enabled: false },
        { id: "fallback-title", description: "Use the id as title." },
      ],
      memoryEntries: [
        { id: "disabled-memory", text: "Hidden memory.", enabled: false },
        { id: "detail-memory", detail: "Detail-only memory.", importance: 2 },
      ],
      loreEntries: [
        { id: "low", title: "Low", content: "Low priority lore.", priority: 1 },
        { id: "high", title: "High", content: "High priority lore.", priority: 5 },
      ],
      rpgState: {
        id: "state-full",
        location: "North Gate",
        sceneSummary: "Snow is falling.",
        health: null,
        player: circularPlayer,
        inventory: [],
        activeQuestIds: [],
        quests: [{ title: "Find shelter" }, undefined],
        companionCharacterIds: [],
        knownPlaces: [],
        statusEffects: [true, 3n] as unknown as string[],
        worldFlags: { gate_open: true },
        flags: throwingValue as unknown as Record<string, string | number | boolean | null>,
      },
      knowledgeBoundaries: "Global boundary.",
      responseContract: "Custom response contract.",
      includeLayerLabels: false,
    });

    expect(compiled.prompt).toContain("Session system instruction.");
    expect(compiled.prompt).toContain("Card system instruction.");
    expect(compiled.prompt).toContain("Character definition:\nGuide remembers only witnessed facts.");
    expect(compiled.prompt).toContain("The player is a cautious scout.");
    expect(compiled.prompt).toContain("1. fallback-title: Use the id as title.");
    expect(compiled.prompt).not.toContain("Hidden rule.");
    expect(compiled.prompt).toContain("- Detail-only memory. [importance: 2]");
    expect(compiled.prompt).not.toContain("Hidden memory.");
    expect(compiled.prompt.indexOf("[High | priority 5]")).toBeLessThan(compiled.prompt.indexOf("[Low | priority 1]"));
    expect(compiled.prompt).toContain("Inventory: none");
    expect(compiled.prompt).toContain("Status effects: true, 3");
    expect(compiled.prompt).toContain('"[Circular]"');
    expect(compiled.prompt).toContain("Health: ");
    expect(compiled.prompt).toContain("Flags: [object Object]");
    expect(compiled.prompt).toContain("Card boundary.\n\nGlobal boundary.");
    expect(compiled.prompt).toContain("Explicit latest action.");
    expect(compiled.prompt).toContain("Custom response contract.");
    expect(compiled.prompt).toContain("Card prefill.");
  });

  it("uses an empty latest-message layer when no user message is available", () => {
    const { modelAdapter: _adapter, model: _model, ...request } = baseRequest(
      new RecordingTextAdapter({
        text: "",
        finishReason: "stop",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      }),
    );

    const compiled = compileTurnPrompt({
      ...request,
      messages: [{ id: "assistant-only", role: "assistant", content: "Waiting." }],
    });

    expect(compiled.omittedLayers.map((layer) => layer.id)).toContain(TURN_PIPELINE_LAYER_IDS.latestUserMessage);
    expect(compiled.prompt).toContain("assistant: Waiting.");
  });

  it("parses raw extraction payloads and ignores malformed JSON candidates", async () => {
    const rawPayloadAdapter = new RecordingTextAdapter({
      text: "Fallback visible text",
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      raw: {
        assistantMessage: "Raw assistant message.",
        rpg_state_updates: {
          location: "Raw Room",
        },
      },
    });

    await expect(runTurnPipeline(baseRequest(rawPayloadAdapter))).resolves.toMatchObject({
      assistantMessageText: "Raw assistant message.",
      stateProposals: {
        rpgStateUpdates: {
          location: "Raw Room",
        },
      },
    });

    for (const text of ["{not valid}", "Text before ```json\nnot-json\n``` after", "Text before {not valid} after"]) {
      const adapter = new RecordingTextAdapter({
        text,
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      });

      const result = await runTurnPipeline(baseRequest(adapter));

      expect(result.assistantMessageText).toBe(text);
      expect(result.stateProposals.rpgStateUpdates).toEqual({
        health_delta: 0,
        inventory_add: [],
        inventory_remove: [],
        quest_updates: [],
        location: null,
        world_flags: {},
      });
    }

    const fencedAssistant = await runTurnPipeline(
      baseRequest(
        new RecordingTextAdapter({
          text: [
            "```json",
            JSON.stringify({
              assistant_message: "Fenced assistant message.",
              extraction: {
                rpg_state_updates: {
                  location: "Fenced Room",
                },
              },
            }),
            "```",
          ].join("\n"),
          finishReason: "stop",
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        }),
      ),
    );
    expect(fencedAssistant.assistantMessageText).toBe("Fenced assistant message.");
    expect(fencedAssistant.stateProposals.rpgStateUpdates.location).toBe("Fenced Room");

    const embeddedAssistant = await runTurnPipeline(
      baseRequest(
        new RecordingTextAdapter({
          text: `prefix ${JSON.stringify({
            assistantMessage: "Embedded assistant message.",
            extractionJson: {
              rpg_state_updates: {
                location: "Embedded Room",
              },
            },
          })} suffix`,
          finishReason: "stop",
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        }),
      ),
    );
    expect(embeddedAssistant.assistantMessageText).toBe("Embedded assistant message.");
    expect(embeddedAssistant.stateProposals.rpgStateUpdates.location).toBe("Embedded Room");

    await expect(
      runTurnPipeline(
        baseRequest(
          new RecordingTextAdapter({
            text: "{}",
            finishReason: "stop",
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          }),
        ),
      ),
    ).resolves.toMatchObject({
      assistantMessageText: "{}",
      promptRun: {
        extractionValidated: true,
      },
    });
  });
});

function baseRequest(adapter: TextModelAdapter): RunTurnPipelineRequest {
  return {
    session: {
      id: "chat-1",
      title: "Lantern Road",
      mode: "rpg",
      summary: "The player is testing a local-first RPG runtime.",
    },
    card: {
      id: "card-1",
      name: "Blank Slate RPG",
      kind: "rpg",
      summary: "A user-defined RPG card.",
      systemPrompt: "Run only the RPG defined by this card.",
      preHistoryInstructions: "Ground action in the active card.",
      postHistoryInstructions: "Ask what the player does next.",
    },
    messages: [
      {
        id: "assistant-1",
        role: "assistant",
        content: "The road ends at a gate lined with cold lanterns.",
      },
      {
        id: "user-1",
        role: "user",
        content: "I approach the glowing lantern gate.",
      },
    ],
    rules: [
      {
        id: "rule-boundaries",
        title: "Respect card boundaries",
        description: "Do not overwrite continuity or bypass local card rules.",
        enforcement: "ignore_rules",
      },
    ],
    memoryEntries: [
      {
        id: "mem-promise",
        label: "Pinned fact",
        text: "The player promised not to steal from shrine keepers.",
        importance: "high",
      },
    ],
    loreEntries: [
      {
        id: "lore-gate",
        title: "Gatehouse",
        content: "The Lantern Gate opens only when the player accepts a cost.",
        priority: 10,
      },
    ],
    rpgState: {
      id: "state-1",
      location: "Unmapped road",
      health: "not configured",
      inventory: [],
      quests: ["Find the first landmark"],
      flags: {
        road_found: true,
      },
    },
    modelAdapter: adapter,
    model: "mock-narrator",
    temperature: 0.3,
    tokenBudget: {
      maxInputTokens: 2_000,
      reservedOutputTokens: 200,
    },
  };
}
