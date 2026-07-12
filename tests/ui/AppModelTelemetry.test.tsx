import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { App } from "../../src/app/App";
import { RUNTIME_STORAGE_KEY } from "../../src/app/localRuntimeStore";
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

type ModelCallRecord = {
  phase: "hidden-continuity" | "visible-response";
  provider: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  inputBudgetTokens: number;
  durationMs: number;
  status: "success" | "error";
};

async function renderAppAndOpenBlankCard() {
  render(<App />);
  await screen.findByText(/Repository API ready|SQLite repository ready|Repository unavailable/i);

  fireEvent.click(screen.getByRole("button", { name: /^Cards$/i }));
  const cardLibrary = screen.getByRole("region", { name: /Card library/i });
  fireEvent.click(within(cardLibrary).getByRole("button", { name: /^Open$/i }));
}

function sendRuntimeMessage(message: string) {
  fireEvent.change(screen.getByLabelText(/Message input/i), { target: { value: message } });
  fireEvent.click(screen.getByRole("button", { name: /^Send$/i }));
}

async function readStoredModelCalls(): Promise<ModelCallRecord[]> {
  let modelCalls: ModelCallRecord[] | undefined;
  await waitFor(() => {
    const snapshot = JSON.parse(window.localStorage.getItem(RUNTIME_STORAGE_KEY) ?? "{}") as {
      promptRuns?: Array<{ modelCalls?: ModelCallRecord[] }>;
    };
    modelCalls = snapshot.promptRuns?.[0]?.modelCalls;
    expect(
      modelCalls,
      "completed prompt run must persist hidden-continuity and visible-response modelCalls",
    ).toHaveLength(2);
  });
  return modelCalls ?? [];
}

describe("intentional two-call turn telemetry", () => {
  it("stores hidden-continuity and visible-response usage for every completed turn", async () => {
    let callIndex = 0;
    const adapter: TextModelAdapter = {
      id: "telemetry-provider",
      displayName: "Telemetry provider",
      async listModels(): Promise<ModelInfo[]> {
        return [];
      },
      async generateText(request: TextGenerationRequest): Promise<TextGenerationResponse> {
        callIndex += 1;
        if (callIndex === 1) {
          return {
            providerId: "telemetry-provider",
            model: request.model,
            text: JSON.stringify({ continuity_brief: "Keep the archway in view." }),
            finishReason: "stop",
            usage: { inputTokens: 30, outputTokens: 5, totalTokens: 35 },
          };
        }
        return {
          providerId: "telemetry-provider",
          model: request.model,
          text: "The old archway hums as you approach.",
          finishReason: "stop",
          usage: { inputTokens: 40, outputTokens: 10, totalTokens: 50 },
        };
      },
    };
    const providerSpy = vi
      .spyOn(providerConfig, "createTextProvider")
      .mockReturnValue(adapter as ReturnType<typeof providerConfig.createTextProvider>);

    try {
      await renderAppAndOpenBlankCard();
      sendRuntimeMessage("I approach the old archway.");

      await screen.findByText(/The old archway hums/i);
      const modelCalls = await readStoredModelCalls();

      expect(modelCalls).toEqual([
        {
          phase: "hidden-continuity",
          provider: "telemetry-provider",
          model: "mock-narrator",
          usage: { inputTokens: 30, outputTokens: 5, totalTokens: 35 },
          inputBudgetTokens: expect.any(Number),
          durationMs: expect.any(Number),
          status: "success",
        },
        {
          phase: "visible-response",
          provider: "telemetry-provider",
          model: "mock-narrator",
          usage: { inputTokens: 40, outputTokens: 10, totalTokens: 50 },
          inputBudgetTokens: expect.any(Number),
          durationMs: expect.any(Number),
          status: "success",
        },
      ]);
      expect(modelCalls.every((call) => call.durationMs >= 0)).toBe(true);
      expect(modelCalls.every((call) => call.inputBudgetTokens >= call.usage.inputTokens)).toBe(true);
      expect(screen.getByText(/2 model calls/i)).toHaveTextContent(/85 tokens/i);
    } finally {
      providerSpy.mockRestore();
    }
  });

  it("records a failed hidden phase while allowing the visible phase to complete", async () => {
    let callIndex = 0;
    const adapter: TextModelAdapter = {
      id: "telemetry-provider",
      displayName: "Telemetry provider",
      async listModels(): Promise<ModelInfo[]> {
        return [];
      },
      async generateText(request: TextGenerationRequest): Promise<TextGenerationResponse> {
        callIndex += 1;
        if (callIndex === 1) {
          throw new Error("Hidden continuity unavailable");
        }
        return {
          providerId: "telemetry-provider",
          model: request.model,
          text: "You continue despite the continuity warning.",
          finishReason: "stop",
          usage: { inputTokens: 16, outputTokens: 4, totalTokens: 20 },
        };
      },
    };
    const providerSpy = vi
      .spyOn(providerConfig, "createTextProvider")
      .mockReturnValue(adapter as ReturnType<typeof providerConfig.createTextProvider>);

    try {
      await renderAppAndOpenBlankCard();
      sendRuntimeMessage("I continue carefully.");

      await screen.findByText(/continue despite the continuity warning/i);
      const modelCalls = await readStoredModelCalls();

      expect(modelCalls[0]).toMatchObject({
        phase: "hidden-continuity",
        provider: "telemetry-provider",
        model: "mock-narrator",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        inputBudgetTokens: expect.any(Number),
        durationMs: expect.any(Number),
        status: "error",
      });
      expect(modelCalls[1]).toMatchObject({
        phase: "visible-response",
        provider: "telemetry-provider",
        model: "mock-narrator",
        usage: { inputTokens: 16, outputTokens: 4, totalTokens: 20 },
        inputBudgetTokens: expect.any(Number),
        durationMs: expect.any(Number),
        status: "success",
      });
    } finally {
      providerSpy.mockRestore();
    }
  });
});
