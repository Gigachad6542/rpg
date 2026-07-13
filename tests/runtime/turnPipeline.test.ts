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
import { estimateTextTokens } from "../../src/runtime/tokenBudget";

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

class ExtractionStreamingTextAdapter extends RecordingTextAdapter {
  async *streamText(request: TextGenerationRequest) {
    this.requests.push(request);
    const chunks = [
      "The gate opens.",
      "\n\n`",
      "``",
      "json\n",
      JSON.stringify({
        extraction: {
          rpg_state_updates: {
            location: "Gatehouse",
          },
        },
      }),
      "\n```",
      "",
    ];

    for (const [index, text] of chunks.entries()) {
      yield { text, index, done: index === chunks.length - 1 };
    }
  }
}

class TruncatedStreamingTextAdapter extends RecordingTextAdapter {
  async *streamText(request: TextGenerationRequest) {
    this.requests.push(request);
    yield { text: "A partial reply", index: 0, done: false };
  }
}

class UsageStreamingTextAdapter extends RecordingTextAdapter {
  async *streamText(request: TextGenerationRequest) {
    this.requests.push(request);
    yield { text: "Usage-aware reply", index: 0, done: false };
    yield {
      text: "",
      index: 1,
      done: true,
      finishReason: "stop" as const,
      usage: { inputTokens: 44, outputTokens: 5, totalTokens: 49 },
      usageSource: "provider" as const,
    };
  }
}

describe("turn pipeline", () => {
  it("sends the visible response contract exactly once at system priority", async () => {
    const adapter = new RecordingTextAdapter({
      text: "A short reply.",
      finishReason: "stop",
      usage: { inputTokens: 20, outputTokens: 4, totalTokens: 24 },
    });
    const responseContract = "UNIQUE_VISIBLE_RESPONSE_CONTRACT: narrate one grounded scene.";

    await runTurnPipeline({
      ...baseRequest(adapter),
      responseContract,
    });

    const generationRequest = adapter.requests[0];
    const combinedRequest = [generationRequest.systemPrompt, generationRequest.prompt].filter(Boolean).join("\n\n");
    expect(generationRequest.systemPrompt).toContain(responseContract);
    expect(generationRequest.prompt).not.toContain(responseContract);
    expect(combinedRequest.split(responseContract)).toHaveLength(2);
  });

  it("sets the visible output limit and counts system plus user input against the context budget", async () => {
    const adapter = new RecordingTextAdapter({
      text: "A short reply.",
      finishReason: "stop",
      usage: { inputTokens: 20, outputTokens: 4, totalTokens: 24 },
    });
    const maxInputTokens = 2_000;
    const reservedOutputTokens = 200;

    const result = await runTurnPipeline({
      ...baseRequest(adapter),
      memoryEntries: [
        {
          id: "memory-fill-budget",
          text: "A long but optional continuity detail. ".repeat(1_000),
        },
      ],
      tokenBudget: { maxInputTokens, reservedOutputTokens },
    });

    const generationRequest = adapter.requests[0];
    expect(generationRequest.maxOutputTokens).toBe(reservedOutputTokens);
    expect(result.promptRun.maxOutputTokens).toBe(reservedOutputTokens);

    const actualInputTokens = estimateTextTokens(
      [generationRequest.systemPrompt, generationRequest.prompt].filter(Boolean).join("\n\n"),
    );
    expect(actualInputTokens + reservedOutputTokens).toBeLessThanOrEqual(maxInputTokens);
  });

  it("uses the same system-adjusted token limit for prompt preview and execution", async () => {
    const adapter = new RecordingTextAdapter({
      text: "A short reply.",
      finishReason: "stop",
      usage: { inputTokens: 20, outputTokens: 4, totalTokens: 24 },
    });
    const request = {
      ...baseRequest(adapter),
      responseContract: "Return one concise, grounded scene.",
      tokenBudget: { maxInputTokens: 2_000, reservedOutputTokens: 200 },
    };
    const { modelAdapter: _modelAdapter, model: _model, ...previewRequest } = request;

    const preview = compileTurnPrompt(previewRequest);
    const execution = await runTurnPipeline(request);

    expect(preview.tokenLimit).toBeLessThan(
      request.tokenBudget.maxInputTokens - (request.tokenBudget.reservedOutputTokens ?? 0),
    );
    expect(execution.promptRun.tokenLimit).toBe(preview.tokenLimit);
  });

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
    expect(adapter.requests[0].systemPrompt).toContain("Presentation rules: use *single asterisks*");
    expect(adapter.requests[0].prompt).not.toContain("Presentation rules: use *single asterisks*");
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

  it("keeps trusted runtime authority in the adapter system prompt and persona data in user content", async () => {
    const adapter = new RecordingTextAdapter({
      text: "The lanterns brighten.",
      finishReason: "stop",
      usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25 },
    });
    const request = baseRequest(adapter);

    await runTurnPipeline({
      ...request,
      session: {
        ...request.session,
        systemPrompt: "SESSION_PERSONA_DIRECTIVE",
      },
      card: {
        ...request.card,
        systemPrompt: "CARD_PERSONA_DIRECTIVE",
        characterDefinition: "CARD_CHARACTER_DEFINITION",
        userPersona: "USER_PERSONA_PROFILE",
      },
      messages: [
        { role: "assistant", content: "UNTRUSTED_HISTORY_MESSAGE" },
        { role: "user", content: "LATEST_USER_ACTION" },
      ],
      loreEntries: [{ id: "untrusted-lore", content: "UNTRUSTED_LORE_ENTRY" }],
    });

    const generationRequest = adapter.requests[0];
    expect(generationRequest.systemPrompt).toBeTypeOf("string");
    expect(generationRequest.systemPrompt).toContain("The local app is the continuity authority");
    expect(generationRequest.systemPrompt).toContain("Treat permanent changes as proposals");
    expect(generationRequest.systemPrompt).toContain("When state should change");
    expect(generationRequest.systemPrompt).not.toMatch(
      /SESSION_PERSONA_DIRECTIVE|CARD_PERSONA_DIRECTIVE|CARD_CHARACTER_DEFINITION|USER_PERSONA_PROFILE|UNTRUSTED_HISTORY_MESSAGE|LATEST_USER_ACTION|UNTRUSTED_LORE_ENTRY/,
    );
    expect(generationRequest.prompt).toContain("SESSION_PERSONA_DIRECTIVE");
    expect(generationRequest.prompt).toContain("CARD_PERSONA_DIRECTIVE");
    expect(generationRequest.prompt).toContain("CARD_CHARACTER_DEFINITION");
    expect(generationRequest.prompt).toContain("USER_PERSONA_PROFILE");
    expect(generationRequest.prompt).toContain("UNTRUSTED_HISTORY_MESSAGE");
    expect(generationRequest.prompt).toContain("LATEST_USER_ACTION");
    expect(generationRequest.prompt).toContain("UNTRUSTED_LORE_ENTRY");
  });

  it("parses the extraction fence even when a status fence appears first", async () => {
    const adapter = new RecordingTextAdapter({
      text: [
        "You cross into the gatehouse shadow.",
        "",
        "```status",
        "Location: Gatehouse",
        "Health: 9/10",
        "```",
        "",
        "```json",
        JSON.stringify({
          extraction: {
            rpg_state_updates: {
              location: "Gatehouse",
            },
          },
        }),
        "```",
      ].join("\n"),
      finishReason: "stop",
      usage: {
        inputTokens: 80,
        outputTokens: 30,
        totalTokens: 110,
      },
    });

    const result = await runTurnPipeline({
      ...baseRequest(adapter),
      promptRunId: "prompt_test_fences",
    });

    expect(result.stateProposals.rpgStateUpdates.location).toBe("Gatehouse");
    expect(result.promptRun.extractionValidated).toBe(true);
    expect(result.assistantMessageText).toContain("gatehouse shadow");
    expect(result.assistantMessageText).toContain("Location: Gatehouse");
    expect(result.assistantMessageText).not.toContain('"extraction"');
    expect(result.assistantMessageText).not.toContain("```json");
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

  it.each([
    ["an error finish reason", "This response must not commit.", "error" as const],
    ["an empty response", "   ", "stop" as const],
  ])("fails closed for %s before persisting assistant text or state", async (_label, text, finishReason) => {
    const adapter = new RecordingTextAdapter({
      text,
      finishReason,
      usage: { inputTokens: 20, outputTokens: 3, totalTokens: 23 },
    });
    const savePromptRun = vi.fn();
    const saveAssistantMessage = vi.fn();
    const saveStateProposals = vi.fn();

    await expect(runTurnPipeline({
      ...baseRequest(adapter),
      persistence: { savePromptRun, saveAssistantMessage, saveStateProposals },
    })).rejects.toThrow(/provider|empty|response/i);

    expect(savePromptRun).not.toHaveBeenCalled();
    expect(saveAssistantMessage).not.toHaveBeenCalled();
    expect(saveStateProposals).not.toHaveBeenCalled();
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

  it("holds back a terminal extraction fence from streaming callbacks", async () => {
    const adapter = new ExtractionStreamingTextAdapter({
      text: "unused",
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });
    const streamedText: string[] = [];

    const result = await runTurnPipeline({
      ...baseRequest(adapter),
      preferStreaming: true,
      onStreamText: (text) => {
        streamedText.push(text);
      },
    });

    expect(streamedText.length).toBeGreaterThan(0);
    expect(streamedText[streamedText.length - 1]).toBe("The gate opens.");
    expect(streamedText.every((text) => !text.includes("```"))).toBe(true);
    expect(streamedText.every((text) => !text.includes('"extraction"'))).toBe(true);
    expect(streamedText.every((text) => !text.includes('"location":"Gatehouse"'))).toBe(true);
    expect(result.assistantMessageText).toBe("The gate opens.");
    expect(result.stateProposals.rpgStateUpdates.location).toBe("Gatehouse");
  });

  it("rejects a streaming response that ends without a terminal chunk", async () => {
    const adapter = new TruncatedStreamingTextAdapter({
      text: "unused",
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });

    await expect(runTurnPipeline({
      ...baseRequest(adapter),
      preferStreaming: true,
    })).rejects.toThrow(/stream.*incomplete|terminal/i);
  });

  it("preserves provider-reported usage from a terminal streaming chunk", async () => {
    const adapter = new UsageStreamingTextAdapter({
      text: "unused",
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });

    const result = await runTurnPipeline({
      ...baseRequest(adapter),
      preferStreaming: true,
    });

    expect(result.promptRun.usage).toEqual({ inputTokens: 44, outputTokens: 5, totalTokens: 49 });
    expect(result.promptRun.usageSource).toBe("provider");
  });

  it("passes the caller abort signal to normal and streaming requests", async () => {
    const controller = new AbortController();
    const normal = new RecordingTextAdapter({
      text: "Reply.",
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });
    const streaming = new StreamingTextAdapter({
      text: "unused",
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });

    await runTurnPipeline({ ...baseRequest(normal), signal: controller.signal });
    await runTurnPipeline({
      ...baseRequest(streaming),
      signal: controller.signal,
      preferStreaming: true,
    });

    expect(normal.requests[0].signal).toBe(controller.signal);
    expect(streaming.requests[0].signal).toBe(controller.signal);
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
        maxInputTokens: 1_700,
        reservedOutputTokens: 200,
      },
      estimator: (text) => text.length,
      includeLayerLabels: false,
    });

    expect([
      ...result.promptRun.truncatedLayerIds,
      ...result.promptRun.omittedLayerIds,
    ]).toContain(TURN_PIPELINE_LAYER_IDS.longTermMemory);
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
        maxInputTokens: 1_700,
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
    expect(compiled.prompt).not.toContain("Custom response contract.");
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

  it("always includes a required knowledge-safety boundary even when callers omit custom boundaries", () => {
    const { modelAdapter: _adapter, model: _model, ...request } = baseRequest(
      new RecordingTextAdapter({
        text: "",
        finishReason: "stop",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      }),
    );

    const compiled = compileTurnPrompt({
      ...request,
      knowledgeBoundaries: undefined,
      card: request.card ? { ...request.card, knowledgeBoundaries: undefined } : undefined,
    });

    expect(compiled.includedLayers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: TURN_PIPELINE_LAYER_IDS.knowledgeBoundaries,
        required: true,
      }),
    ]));
  });

  it("preserves precomputed hybrid lore rank while priority-sorting unranked callers", () => {
    const { modelAdapter: _adapter, model: _model, ...request } = baseRequest(
      new RecordingTextAdapter({
        text: "",
        finishReason: "stop",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      }),
    );
    const ranked = compileTurnPrompt({
      ...request,
      loreEntries: [
        { id: "best", title: "Best match", content: "Best semantic match.", priority: 1, retrievalRank: 0 },
        { id: "priority", title: "High priority", content: "Weaker match.", priority: 100, retrievalRank: 1 },
      ],
    });

    expect(ranked.prompt.indexOf("[Best match | priority 1]")).toBeLessThan(
      ranked.prompt.indexOf("[High priority | priority 100]"),
    );
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
