import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TurnDeltaPanel } from "../../src/app/TurnDeltaPanel";
import type { PromptRun } from "../../src/app/runtimeTypes";

function promptRun(overrides: Partial<PromptRun> = {}): PromptRun {
  return {
    id: "run-1",
    cardId: "card-1",
    chatId: "chat-1",
    compiledPrompt: "",
    response: "",
    provider: "mock",
    model: "mock",
    tokenEstimate: 0,
    includedLayerIds: [],
    includedLoreEntryIds: [],
    warnings: [],
    stateChanges: ["[player-action] Inventory + torch"],
    stateProposals: [
      {
        kind: "inventory",
        summary: "Inventory + torch",
        provenance: "player-action",
        applied: true,
      },
      {
        kind: "memory",
        summary: "Memory: invented royal title",
        provenance: "model-narration",
        applied: false,
      },
    ],
    ...overrides,
  };
}

describe("TurnDeltaPanel", () => {
  it("summarizes both intentional model calls and expands their usage details", () => {
    render(
      <TurnDeltaPanel
        run={promptRun({
          stateChanges: [],
          stateProposals: [],
          modelCalls: [
            {
              phase: "hidden-continuity",
              provider: "telemetry-provider",
              model: "mock-narrator",
              usage: { inputTokens: 30, outputTokens: 5, totalTokens: 35 },
              inputBudgetTokens: 120,
              durationMs: 120,
              status: "success",
            },
            {
              phase: "visible-response",
              provider: "telemetry-provider",
              model: "mock-narrator",
              usage: { inputTokens: 40, outputTokens: 10, totalTokens: 50 },
              inputBudgetTokens: 200,
              durationMs: 640,
              status: "success",
            },
          ],
        } as Partial<PromptRun>)}
        onUndo={vi.fn()}
      />,
    );

    const summary = screen.getByText(/2 model calls/i);
    expect(summary).toHaveTextContent("2 model calls · 85 tokens");
    expect(summary).not.toHaveTextContent("Â");

    fireEvent.click(summary);

    expect(screen.getByText(/retains its own usage, latency, cost status, failure, and proposal count/i)).toBeInTheDocument();
    expect(screen.getByText(/Continuity preparation/i)).toBeInTheDocument();
    expect(screen.getByText(/Visible response/i)).toBeInTheDocument();
    expect(screen.getAllByText(/telemetry-provider \/ mock-narrator/i)).toHaveLength(2);
    expect(screen.getByText(/30 input.*5 output.*35 total/i)).toBeInTheDocument();
    expect(screen.getByText(/40 input.*10 output.*50 total/i)).toBeInTheDocument();
    expect(screen.getByText(/30 \/ 120 input tokens.*25%/i)).toBeInTheDocument();
    expect(screen.getByText(/40 \/ 200 input tokens.*20%/i)).toBeInTheDocument();
    expect(screen.getByText(/120 ms phase duration/i)).toBeInTheDocument();
    expect(screen.getByText(/640 ms phase duration/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Cost unknown/i)).toHaveLength(2);
    expect(screen.getAllByText(/0 state proposals/i)).toHaveLength(2);
  });

  it("shows applied and blocked proposals with provenance and supports undo", () => {
    const undo = vi.fn();
    render(<TurnDeltaPanel run={promptRun()} onUndo={undo} />);

    expect(screen.getByText(/State changes \(1 applied, 1 blocked\)/i)).toBeInTheDocument();
    expect(screen.getByText("Inventory + torch")).toBeInTheDocument();
    expect(screen.getByText(/player action/i)).toBeInTheDocument();
    expect(screen.getByText("Memory: invented royal title")).toBeInTheDocument();
    expect(screen.getByText(/model narration/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Undo state changes/i }));
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("labels cost derived from estimated usage instead of presenting it as exact", () => {
    const estimatedCost = {
      status: "estimated",
      currency: "USD",
      amountUsd: 0.00125,
      pricing: {
        model: "mock-narrator",
        currency: "USD",
        inputUsdPerMillionTokens: 1,
        outputUsdPerMillionTokens: 2,
        source: "test fixture",
        effectiveDate: "2026-07-01",
      },
    } as unknown as NonNullable<PromptRun["modelCalls"]>[number]["cost"];

    render(
      <TurnDeltaPanel
        run={promptRun({
          stateChanges: [],
          stateProposals: [],
          modelCalls: [{
            phase: "visible-response",
            provider: "telemetry-provider",
            model: "mock-narrator",
            usage: { inputTokens: 1_000, outputTokens: 125, totalTokens: 1_125 },
            durationMs: 500,
            status: "success",
            usageSource: "estimated",
            cost: estimatedCost,
          }],
        })}
        onUndo={vi.fn()}
      />,
    );

    const summary = screen.getByText(/1 model calls/i);
    expect(summary).toHaveTextContent(/\$0\.001250.*1 estimated/i);
    fireEvent.click(summary);
    expect(screen.getByText("$0.001250 USD estimated")).toBeInTheDocument();
  });

  it("marks an undone turn and does not offer a second undo", () => {
    render(<TurnDeltaPanel run={promptRun()} onUndo={vi.fn()} undone />);
    expect(screen.getByText(/State changes undone/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Undo state changes/i })).not.toBeInTheDocument();
  });
});
