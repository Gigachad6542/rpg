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
  RuntimeCard,
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
    const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
    const [activeChatIds, setActiveChatIds] = useState<Record<string, string>>({});
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
      providerSettings: defaultProviderSettings,
      sessionApiKey: "",
      runtimeSettings: { ...defaultRuntimeSettings, hiddenContinuityMode: "off" },
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
});
