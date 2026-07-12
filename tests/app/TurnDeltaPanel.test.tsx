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

  it("marks an undone turn and does not offer a second undo", () => {
    render(<TurnDeltaPanel run={promptRun({ stateEffectsUndone: true })} onUndo={vi.fn()} />);
    expect(screen.getByText(/State changes undone/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Undo state changes/i })).not.toBeInTheDocument();
  });
});
