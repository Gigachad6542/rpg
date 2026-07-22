import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  defaultProviderSettings,
  defaultRuntimeSettings,
  initialCards,
} from "../../src/app/appDefaults";
import { createTextProvider } from "../../src/app/providerConfig";
import type {
  ChatSession,
  Persona,
  PromptRun,
  ProviderSettings,
  RuntimeCard,
  RuntimeSettings,
} from "../../src/app/runtimeTypes";
import { useTurnGeneration } from "../../src/app/useTurnGeneration";
import type {
  ModelInfo,
  TextGenerationRequest,
  TextGenerationResponse,
  TextModelAdapter,
} from "../../src/providers/TextModelAdapter";

vi.mock("../../src/app/providerConfig", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/app/providerConfig")>(),
  createTextProvider: vi.fn(),
}));

const createTextProviderMock = vi.mocked(createTextProvider);

function response(text: string): TextGenerationResponse {
  return {
    providerId: "deferred-provider",
    model: "mock-narrator",
    text,
    finishReason: "stop",
    usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
    usageSource: "provider",
  };
}

function adapter(
  generateText: (request: TextGenerationRequest) => Promise<TextGenerationResponse>,
): TextModelAdapter {
  return {
    id: "deferred-provider",
    displayName: "Deferred provider",
    async listModels(): Promise<ModelInfo[]> {
      return [];
    },
    generateText,
  };
}

function renderGeneration(options: {
  modelAdapter: TextModelAdapter;
  draft?: string;
  activeCard?: RuntimeCard | null;
  runtimeRunning?: boolean;
  runtimeSettings?: RuntimeSettings;
  providerSettings?: ProviderSettings;
  initialChat?: ChatSession;
  initialChats?: ChatSession[];
} ) {
  const setRuleWarning = vi.fn();
  const runSlashCommand = vi.fn(async () => undefined);
  const generateMissingCharacterPortraits = vi.fn(async () => undefined);
  createTextProviderMock.mockReturnValue(
    options.modelAdapter as ReturnType<typeof createTextProvider>,
  );

  const hook = renderHook(() => {
    const [cards, setCards] = useState<RuntimeCard[]>(() =>
      options.activeCard === null
        ? []
        : [structuredClone(options.activeCard ?? initialCards[0])],
    );
    const [chatSessions, setChatSessions] = useState<ChatSession[]>(() =>
      structuredClone(options.initialChats ?? (options.initialChat ? [options.initialChat] : [])),
    );
    const [activeChatIds, setActiveChatIds] = useState<Record<string, string>>(() =>
      options.initialChat
        ? { [options.initialChat.cardId]: options.initialChat.id }
        : options.initialChats?.[0]
          ? { [options.initialChats[0].cardId]: options.initialChats[0].id }
          : {},
    );
    const [promptRuns, setPromptRuns] = useState<PromptRun[]>([]);
    const [personas, setPersonas] = useState<Persona[]>([]);
    const [draft, setDraft] = useState(options.draft ?? "I inspect the gate carefully.");
    const activeCard = cards[0] ?? null;
    const activeChat = chatSessions.find((chat) => chat.id === activeChatIds[activeCard?.id ?? ""]);
    const generation = useTurnGeneration({
      activeCard,
      activeChat,
      activePersona: null,
      runtimeRunning: options.runtimeRunning ?? true,
      draft,
      providerSettings: options.providerSettings ?? defaultProviderSettings,
      sessionApiKey: "",
      runtimeSettings: options.runtimeSettings ?? { ...defaultRuntimeSettings, hiddenContinuityMode: "off" },
      setActiveChatIds,
      setChatSessions,
      setCards,
      setPersonas,
      setPromptRuns,
      setDraft,
      setRuleWarning,
      runSlashCommand,
      generateMissingCharacterPortraits,
    });

    return {
      ...generation,
      cards,
      chatSessions,
      promptRuns,
      personas,
      draft,
      activeChatId: activeChat?.id,
      selectChat: (chatId: string) => setActiveChatIds((current) => ({
        ...current,
        [activeCard?.id ?? ""]: chatId,
      })),
      removeChat: (chatId: string) => setChatSessions((current) =>
        current.filter((chat) => chat.id !== chatId),
      ),
    };
  });

  return {
    ...hook,
    setRuleWarning,
    runSlashCommand,
    generateMissingCharacterPortraits,
  };
}

describe("useTurnGeneration", () => {
  beforeEach(() => {
    createTextProviderMock.mockReset();
  });

  it("synchronously rejects a second generation before React commits state", async () => {
    let resolveGeneration!: (value: TextGenerationResponse) => void;
    const generateText = vi.fn(
      () => new Promise<TextGenerationResponse>((resolve) => {
        resolveGeneration = resolve;
      }),
    );
    const { result } = renderGeneration({ modelAdapter: adapter(generateText) });

    let firstGeneration!: Promise<void>;
    let secondGeneration!: Promise<void>;
    act(() => {
      firstGeneration = result.current.generateTurn();
      secondGeneration = result.current.generateTurn();
    });

    await waitFor(() => expect(generateText).toHaveBeenCalledTimes(1));
    expect(result.current.isGenerating).toBe(true);

    await act(async () => {
      resolveGeneration(response("The gate opens without duplicating the turn."));
      await Promise.all([firstGeneration, secondGeneration]);
    });

    await waitFor(() => expect(result.current.isGenerating).toBe(false));
    expect(result.current.promptRuns).toHaveLength(1);
    expect(result.current.chatSessions).toHaveLength(1);
    expect(result.current.chatSessions[0]?.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
  });

  it("aborts an in-flight turn without committing transcript or state changes", async () => {
    const generateText = vi.fn(
      (request: TextGenerationRequest) => new Promise<TextGenerationResponse>((_resolve, reject) => {
        request.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      }),
    );
    const { result, setRuleWarning } = renderGeneration({ modelAdapter: adapter(generateText) });

    let generation!: Promise<void>;
    act(() => {
      generation = result.current.generateTurn();
    });
    await waitFor(() => expect(result.current.isGenerating).toBe(true));

    act(() => result.current.stopGeneration());
    await act(async () => generation);

    await waitFor(() => expect(result.current.isGenerating).toBe(false));
    expect(result.current.chatSessions[0]?.messages).toEqual([]);
    expect(result.current.cards[0]).toEqual(initialCards[0]);
    expect(setRuleWarning).toHaveBeenCalledWith(
      "Generation stopped. No turn messages or state changes were saved.",
    );
  });

  it("aborts when the active chat changes and leaves both transcripts untouched", async () => {
    const generateText = vi.fn(
      (request: TextGenerationRequest) => new Promise<TextGenerationResponse>((_resolve, reject) => {
        request.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      }),
    );
    const activeCard = structuredClone(initialCards[0]);
    const first = {
      id: "chat-first",
      cardId: activeCard.id,
      title: "First",
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z",
      messages: [],
    } satisfies ChatSession;
    const second = { ...first, id: "chat-second", title: "Second" } satisfies ChatSession;
    const { result } = renderGeneration({
      modelAdapter: adapter(generateText),
      activeCard,
      initialChat: first,
      initialChats: [first, second],
    });

    let generation!: Promise<void>;
    act(() => {
      generation = result.current.generateTurn();
    });
    await waitFor(() => expect(result.current.isGenerating).toBe(true));
    act(() => result.current.selectChat(second.id));
    await act(async () => generation);

    expect(result.current.activeChatId).toBe(second.id);
    expect(result.current.chatSessions.map((chat) => chat.messages)).toEqual([[], []]);
    expect(result.current.promptRuns).toEqual([]);
  });

  it("does not resurrect a chat deleted while its generation is being cancelled", async () => {
    const generateText = vi.fn(
      (request: TextGenerationRequest) => new Promise<TextGenerationResponse>((_resolve, reject) => {
        request.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      }),
    );
    const activeCard = structuredClone(initialCards[0]);
    const chat = {
      id: "chat-delete",
      cardId: activeCard.id,
      title: "Delete me",
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z",
      messages: [],
    } satisfies ChatSession;
    const { result } = renderGeneration({ modelAdapter: adapter(generateText), activeCard, initialChat: chat });

    let generation!: Promise<void>;
    act(() => {
      generation = result.current.generateTurn();
    });
    await waitFor(() => expect(result.current.isGenerating).toBe(true));
    act(() => result.current.removeChat(chat.id));
    await act(async () => generation);

    expect(result.current.chatSessions).toEqual([]);
    expect(result.current.promptRuns).toEqual([]);
  });

  it("keeps legacy prompt-run diagnostics aligned when regenerating an older active variant", async () => {
    const activeCard = structuredClone(initialCards[0]);
    const chat = {
      id: "chat-legacy-variants",
      cardId: activeCard.id,
      title: "Legacy variants",
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z",
      messages: [
        { id: "user-original", role: "user", content: "Open the gate." },
        {
          id: "assistant-original",
          role: "assistant",
          content: "The first reply.",
          promptRunId: "run-second",
          variants: ["The first reply.", "The second reply."],
          activeVariantIndex: 0,
        },
      ],
    } satisfies ChatSession;
    const { result } = renderGeneration({
      modelAdapter: adapter(async () => response("The third reply.")),
      activeCard,
      initialChat: chat,
    });

    await act(async () => result.current.regenerateLastReply());

    const regenerated = result.current.chatSessions[0]?.messages.find((message) => message.role === "assistant");
    expect(regenerated?.variants).toEqual(["The first reply.", "The second reply.", "The third reply."]);
    expect(regenerated?.variantRunIds?.slice(0, 2)).toEqual(["", "run-second"]);
    expect(regenerated?.variantRunIds?.[2]).toBe(regenerated?.promptRunId);
  });

  it("fails closed before model setup when no card is active", async () => {
    const generateText = vi.fn(async () => response("This must not run."));
    const { result, setRuleWarning } = renderGeneration({
      modelAdapter: adapter(generateText),
      activeCard: null,
    });

    await act(async () => result.current.generateTurn());

    expect(createTextProviderMock).not.toHaveBeenCalled();
    expect(generateText).not.toHaveBeenCalled();
    expect(setRuleWarning).toHaveBeenCalledWith("Open a card before starting the runtime.");
  });

  it("uses the tested evidence-brief pipeline only after older context leaves the four-message window", async () => {
    const requests: TextGenerationRequest[] = [];
    const brief = {
      relevant_evidence: [
        { source_id: "old-user", fact: "The iron key was destroyed.", status: "active" },
      ],
      knowledge_boundaries: [],
      uncertainties: [],
      response_constraints: ["Do not restore the iron key."],
      response_plan: ["Continue at the gate."],
    };
    const generateText = vi.fn(async (request: TextGenerationRequest): Promise<TextGenerationResponse> => {
      requests.push(request);
      return request.responseFormat?.type === "json_schema"
        ? response(JSON.stringify(brief))
        : ({
            ...response("Iven studies the empty key ring, unaware of what happened beyond the gate."),
            model: "qwen/qwen3.7-max",
            reasoning: {
              trace: "I checked the destroyed key and Iven's knowledge boundary.",
              format: "text",
              encrypted: false,
              tokenCount: 12,
            },
          });
    });
    const activeCard = structuredClone(initialCards[0]);
    const initialChat: ChatSession = {
      id: "chat-evidence",
      cardId: activeCard.id,
      title: "Evidence chat",
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z",
      messages: [
        { id: "old-user", role: "user", content: "OLD RAW PREFIX: The iron key was destroyed." },
        { id: "old-assistant", role: "assistant", content: "The fragments fell into the river." },
        { id: "recent-user-1", role: "user", content: "I return to the north gate." },
        { id: "recent-assistant-1", role: "assistant", content: "Iven waits beside the arch." },
        { id: "recent-user-2", role: "user", content: "I conceal the empty key ring." },
      ],
    };
    const { result } = renderGeneration({
      modelAdapter: adapter(generateText),
      activeCard,
      initialChat,
      providerSettings: {
        ...defaultProviderSettings,
        mode: "openai-compatible",
        providerId: "openrouter",
        displayName: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        model: "qwen/qwen3.7-max",
      },
      runtimeSettings: { ...defaultRuntimeSettings, hiddenContinuityMode: "evidence-brief" },
      draft: "I ask Iven whether he remembers the iron key.",
    });

    await act(async () => result.current.generateTurn());

    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      model: "qwen/qwen3.7-max",
      reasoning: { enabled: false },
      responseFormat: { type: "json_schema" },
    });
    expect(requests[0].prompt).toContain("[old-user] user: OLD RAW PREFIX");
    expect(requests[1]).toMatchObject({
      model: "qwen/qwen3.7-max",
      reasoning: { enabled: true, exclude: false },
    });
    expect(requests[1].prompt).not.toContain("OLD RAW PREFIX");
    expect(requests[1].prompt).toContain("The fragments fell into the river.");
    expect(requests[1].prompt).toContain("Private memory evidence brief");
    expect(requests[1].systemPrompt).toContain("fallible analytical aid");
    expect(result.current.promptRuns[0]?.modelCalls?.map((call) => call.phase)).toEqual([
      "memory-evidence",
      "visible-response",
    ]);
    expect(result.current.cards[0]?.memory).toEqual(activeCard.memory);
    expect(result.current.cards[0]?.storyEntities).toEqual(activeCard.storyEntities);
    const reasoningTraces = result.current.reasoningTraces;
    expect(reasoningTraces).toEqual({
      [`${result.current.promptRuns[0]?.id}:visible-response`]: expect.objectContaining({
        trace: "I checked the destroyed key and Iven's knowledge boundary.",
      }),
    });
    expect(JSON.stringify(result.current.promptRuns)).not.toContain("I checked the destroyed key");
  });

  it("keeps an enabled short conversation to one ordinary visible call", async () => {
    const requests: TextGenerationRequest[] = [];
    const generateText = vi.fn(async (request: TextGenerationRequest) => {
      requests.push(request);
      return response("The gate remains in view.");
    });
    const activeCard = structuredClone(initialCards[0]);
    const initialChat: ChatSession = {
      id: "chat-short",
      cardId: activeCard.id,
      title: "Short chat",
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z",
      messages: [
        { id: "user-1", role: "user", content: "I approach the gate." },
        { id: "assistant-1", role: "assistant", content: "The arch rises ahead." },
        { id: "user-2", role: "user", content: "I study its hinges." },
        { id: "assistant-2", role: "assistant", content: "Rust marks the lower hinge." },
      ],
    };
    const { result } = renderGeneration({
      modelAdapter: adapter(generateText),
      activeCard,
      initialChat,
      runtimeSettings: { ...defaultRuntimeSettings, hiddenContinuityMode: "evidence-brief" },
    });

    await act(async () => result.current.generateTurn());

    expect(requests).toHaveLength(1);
    expect(requests[0].responseFormat).toBeUndefined();
    expect(requests[0].prompt).not.toContain("Private memory evidence brief");
    expect(result.current.promptRuns[0]?.modelCalls?.map((call) => call.phase)).toEqual(["visible-response"]);
  });

  it("fails open to the ordinary full-context visible request when analyst citations are invalid", async () => {
    const requests: TextGenerationRequest[] = [];
    const generateText = vi.fn(async (request: TextGenerationRequest) => {
      requests.push(request);
      if (request.responseFormat?.type === "json_schema") {
        return response(JSON.stringify({
          relevant_evidence: [{ source_id: "forged", fact: "Invented.", status: "active" }],
          knowledge_boundaries: [],
          uncertainties: [],
          response_constraints: [],
          response_plan: [],
        }));
      }
      return response("The ordinary context remains available.");
    });
    const activeCard = structuredClone(initialCards[0]);
    const initialChat: ChatSession = {
      id: "chat-fallback",
      cardId: activeCard.id,
      title: "Fallback chat",
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z",
      messages: Array.from({ length: 5 }, (_, index) => ({
        id: `message-${index}`,
        role: index % 2 === 0 ? "user" as const : "assistant" as const,
        content: index === 0 ? "FULL CONTEXT FALLBACK MARKER" : `Message ${index}`,
      })),
    };
    const { result } = renderGeneration({
      modelAdapter: adapter(generateText),
      activeCard,
      initialChat,
      runtimeSettings: { ...defaultRuntimeSettings, hiddenContinuityMode: "evidence-brief" },
    });

    await act(async () => result.current.generateTurn());

    expect(requests).toHaveLength(2);
    expect(requests[1].prompt).toContain("FULL CONTEXT FALLBACK MARKER");
    expect(requests[1].prompt).not.toContain("Private memory evidence brief");
    expect(result.current.promptRuns[0]?.warnings.join(" ")).toMatch(/unknown source/i);
    expect(result.current.promptRuns[0]?.modelCalls?.[0]).toMatchObject({
      phase: "memory-evidence",
      status: "error",
    });
  });
});
