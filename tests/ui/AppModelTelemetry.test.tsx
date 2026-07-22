import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { App } from "../../src/app/App";
import { RUNTIME_STORAGE_KEY } from "../../src/app/localRuntimeStore";
import type { ModelCallRecord } from "../../src/app/runtimeTypes";
import * as providerConfig from "../../src/app/providerConfig";
import type {
  ModelInfo,
  TextGenerationRequest,
  TextGenerationResponse,
  TextModelAdapter,
} from "../../src/providers/TextModelAdapter";

type TauriInvokeMock = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

const tauriInvokeMock = vi.hoisted(() =>
  vi.fn<TauriInvokeMock>(async () => {
    throw new Error("Tauri unavailable");
  }),
);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauriInvokeMock,
}));

async function renderAppAndOpenBlankCard() {
  render(<App />);
  await screen.findByText(/Repository API ready|SQLite repository ready|Repository unavailable/i);
  fireEvent.click(screen.getByRole("button", { name: /^Cards$/i }));
  fireEvent.click(within(screen.getByRole("region", { name: /Card library/i })).getByRole("button", { name: /^Open$/i }));
}

function sendRuntimeMessage(message: string) {
  fireEvent.change(screen.getByLabelText(/Message input/i), { target: { value: message } });
  fireEvent.click(screen.getByRole("button", { name: /^Send$/i }));
}

async function readLatestStoredModelCalls(expectedCallCount: 1 | 2): Promise<ModelCallRecord[]> {
  let modelCalls: ModelCallRecord[] | undefined;
  await waitFor(() => {
    const snapshot = JSON.parse(window.localStorage.getItem(RUNTIME_STORAGE_KEY) ?? "{}") as {
      promptRuns?: Array<{ modelCalls?: ModelCallRecord[] }>;
    };
    const promptRuns = snapshot.promptRuns ?? [];
    modelCalls = promptRuns[promptRuns.length - 1]?.modelCalls;
    expect(modelCalls).toHaveLength(expectedCallCount);
  });
  return modelCalls ?? [];
}

async function readStoredActiveChat(): Promise<Record<string, unknown>> {
  let chat: Record<string, unknown> | undefined;
  await waitFor(() => {
    const snapshot = JSON.parse(window.localStorage.getItem(RUNTIME_STORAGE_KEY) ?? "{}") as {
      activeCardId?: string;
      activeChatIds?: Record<string, string>;
      chatSessions?: Array<Record<string, unknown>>;
    };
    const activeChatId = snapshot.activeCardId ? snapshot.activeChatIds?.[snapshot.activeCardId] : undefined;
    chat = snapshot.chatSessions?.find((candidate) => candidate.id === activeChatId);
    expect(chat).toBeDefined();
  });
  return chat ?? {};
}

function providerResponse(
  request: TextGenerationRequest,
  text: string,
  usage = { inputTokens: 20, outputTokens: 5, totalTokens: 25 },
): TextGenerationResponse {
  return {
    providerId: "telemetry-provider",
    model: request.model,
    text,
    finishReason: "stop",
    usage,
    usageSource: "provider",
  };
}

describe("conditional memory-evidence telemetry", () => {
  it("records two same-model calls only after history exceeds the tested recent window", async () => {
    const requests: TextGenerationRequest[] = [];
    let visibleIndex = 0;
    const adapter: TextModelAdapter = {
      id: "telemetry-provider",
      displayName: "Telemetry provider",
      async listModels(): Promise<ModelInfo[]> {
        return [];
      },
      async generateText(request): Promise<TextGenerationResponse> {
        requests.push(request);
        if (request.responseFormat?.type === "json_schema") {
          return providerResponse(request, JSON.stringify({
            relevant_evidence: [
              { source_id: "latest-user", fact: "The player returns to the gate.", status: "active" },
            ],
            knowledge_boundaries: [],
            uncertainties: [],
            response_constraints: [],
            response_plan: ["Continue the gate scene."],
          }), { inputTokens: 30, outputTokens: 10, totalTokens: 40 });
        }
        visibleIndex += 1;
        return providerResponse(request, `Visible turn ${visibleIndex}.`);
      },
    };
    const providerSpy = vi.spyOn(providerConfig, "createTextProvider")
      .mockReturnValue(adapter as ReturnType<typeof providerConfig.createTextProvider>);

    try {
      await renderAppAndOpenBlankCard();
      sendRuntimeMessage("I take step one toward the gate.");
      await screen.findByText("Visible turn 1.");
      sendRuntimeMessage("I take step two and inspect the arch.");
      await screen.findByText("Visible turn 2.");
      sendRuntimeMessage("I take step three and listen.");
      await screen.findByText("Visible turn 3.");
      sendRuntimeMessage("I return to the gate and speak.");
      await screen.findByText("Visible turn 4.");

      expect(requests).toHaveLength(5);
      expect(requests[3]).toMatchObject({
        model: "mock-narrator",
        reasoning: { enabled: false },
        responseFormat: { type: "json_schema" },
      });
      expect(requests[3].prompt).toContain("I take step one toward the gate.");
      expect(requests[4].model).toBe("mock-narrator");
      expect(requests[4].prompt).not.toContain("I take step one toward the gate.");
      expect(requests[4].prompt).toContain("I take step two and inspect the arch.");
      expect(requests[4].prompt).toContain("Private memory evidence brief");

      const modelCalls = await readLatestStoredModelCalls(2);
      expect(modelCalls.map((call) => call.phase)).toEqual(["memory-evidence", "visible-response"]);
      expect(modelCalls.map((call) => call.model)).toEqual(["mock-narrator", "mock-narrator"]);
      expect(modelCalls[0]).toMatchObject({ status: "success", stateProposalCount: 0 });
      expect(screen.getByText(/2 model calls/i)).toBeInTheDocument();
      expect(screen.getByRole("log", { name: /Chat transcript/i })).not.toHaveTextContent(/Private memory evidence brief/i);
    } finally {
      providerSpy.mockRestore();
    }
  });

  it("performs one visible call when two-model-call memory is off", async () => {
    const requests: TextGenerationRequest[] = [];
    const adapter: TextModelAdapter = {
      id: "telemetry-provider",
      displayName: "Telemetry provider",
      async listModels(): Promise<ModelInfo[]> {
        return [];
      },
      async generateText(request): Promise<TextGenerationResponse> {
        requests.push(request);
        return providerResponse(request, "The gate opens with one call.");
      },
    };
    const providerSpy = vi.spyOn(providerConfig, "createTextProvider")
      .mockReturnValue(adapter as ReturnType<typeof providerConfig.createTextProvider>);

    try {
      render(<App />);
      await screen.findByText(/Repository API ready|SQLite repository ready|Repository unavailable/i);
      fireEvent.click(screen.getByRole("button", { name: /^Settings$/i }));
      fireEvent.change(screen.getByLabelText(/Two-model-call memory/i), { target: { value: "off" } });
      fireEvent.click(screen.getByRole("button", { name: /^Cards$/i }));
      fireEvent.click(within(screen.getByRole("region", { name: /Card library/i })).getByRole("button", { name: /^Open$/i }));
      sendRuntimeMessage("I open the gate.");

      await screen.findByText(/gate opens with one call/i);
      const modelCalls = await readLatestStoredModelCalls(1);
      expect(requests).toHaveLength(1);
      expect(modelCalls.map((call) => call.phase)).toEqual(["visible-response"]);
    } finally {
      providerSpy.mockRestore();
    }
  });

  it("persists a later player-action attempt when its ordinary visible call fails", async () => {
    let callIndex = 0;
    const adapter: TextModelAdapter = {
      id: "attempt-provider",
      displayName: "Attempt provider",
      async listModels(): Promise<ModelInfo[]> {
        return [];
      },
      async generateText(request): Promise<TextGenerationResponse> {
        callIndex += 1;
        if (callIndex === 2) throw new Error("Visible provider unavailable");
        return providerResponse(request, "The first turn succeeds.");
      },
    };
    const providerSpy = vi.spyOn(providerConfig, "createTextProvider")
      .mockReturnValue(adapter as ReturnType<typeof providerConfig.createTextProvider>);

    try {
      await renderAppAndOpenBlankCard();
      sendRuntimeMessage("I inspect the gate.");
      await screen.findByText(/first turn succeeds/i);
      sendRuntimeMessage("I try the gate again.");
      await screen.findByText(/Visible provider unavailable/i);

      const chat = await readStoredActiveChat();
      const actions = (chat.authoritativeEvents as Array<Record<string, unknown>>)
        .filter((event) => event.kind === "player_action");
      expect(actions).toEqual([
        expect.objectContaining({ action: "I inspect the gate." }),
        expect.objectContaining({ action: "I try the gate again." }),
      ]);
    } finally {
      providerSpy.mockRestore();
    }
  });

  it("keeps the original transcript when a short-history regeneration fails", async () => {
    let callIndex = 0;
    const adapter: TextModelAdapter = {
      id: "regeneration-provider",
      displayName: "Regeneration provider",
      async listModels(): Promise<ModelInfo[]> {
        return [];
      },
      async generateText(request): Promise<TextGenerationResponse> {
        callIndex += 1;
        if (callIndex === 2) throw new Error("Regeneration unavailable");
        return providerResponse(request, "The original gate remains closed.");
      },
    };
    const providerSpy = vi.spyOn(providerConfig, "createTextProvider")
      .mockReturnValue(adapter as ReturnType<typeof providerConfig.createTextProvider>);

    try {
      await renderAppAndOpenBlankCard();
      sendRuntimeMessage("I inspect the closed gate.");
      await screen.findByText(/original gate remains closed/i);
      fireEvent.click(screen.getByRole("button", { name: /Regenerate reply/i }));
      await screen.findByText(/Regeneration unavailable/i);

      const chat = await readStoredActiveChat();
      expect(chat.messages).toEqual([
        expect.objectContaining({ role: "user", content: "I inspect the closed gate." }),
        expect.objectContaining({ role: "assistant", content: "The original gate remains closed." }),
      ]);
    } finally {
      providerSpy.mockRestore();
    }
  });
});
