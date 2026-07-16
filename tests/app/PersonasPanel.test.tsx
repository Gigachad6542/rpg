import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PersonasPanel } from "../../src/app/PersonasPanel";
import { NO_PERSONA_ID } from "../../src/app/personas";
import type { Persona } from "../../src/app/runtimeTypes";

const personas: Persona[] = [
  { id: "persona_mara", name: "Mara", description: "A careful cartographer.", lorebooks: [] },
  { id: "persona_rook", name: "Rook", description: "A blunt scout.", lorebooks: [] },
];

type PersonasPanelProps = Parameters<typeof PersonasPanel>[0];

function renderPanel(overrides: Partial<PersonasPanelProps> = {}) {
  const props: PersonasPanelProps = {
    personas,
    activePersonaId: "persona_mara",
    selectPersona: vi.fn(),
    addPersona: vi.fn(),
    editPersona: vi.fn(),
    removePersona: vi.fn(),
    ...overrides,
  };
  render(<PersonasPanel {...props} />);
  return props;
}

describe("PersonasPanel", () => {
  it("offers a No persona option alongside the custom personas", () => {
    renderPanel();

    const panel = screen.getByRole("region", { name: /Persona profiles/i });
    expect(within(panel).getByText("No persona")).toBeInTheDocument();
    expect(within(panel).getByText("Mara")).toBeInTheDocument();
    expect(within(panel).getByText("Rook")).toBeInTheDocument();
  });

  it("selects the No persona option", () => {
    const { selectPersona } = renderPanel({ activePersonaId: "persona_mara" });

    fireEvent.click(screen.getByRole("button", { name: /Use no persona/i }));

    expect(selectPersona).toHaveBeenCalledWith(NO_PERSONA_ID);
  });

  it("creates a new persona and switches to an existing one", () => {
    const { addPersona, selectPersona } = renderPanel();

    const panel = screen.getByRole("region", { name: /Persona profiles/i });
    fireEvent.change(within(panel).getByLabelText(/New persona name/i), { target: { value: "Vale" } });
    fireEvent.click(within(panel).getByRole("button", { name: /Create persona/i }));
    expect(addPersona).toHaveBeenCalledWith("Vale");

    fireEvent.click(within(panel).getByRole("button", { name: /^Use Rook$/i }));
    expect(selectPersona).toHaveBeenCalledWith("persona_rook");
  });

  it("edits the active persona's prompt", () => {
    const { editPersona } = renderPanel({ activePersonaId: "persona_mara" });

    const editor = screen.getByRole("region", { name: /Persona editor/i });
    fireEvent.change(within(editor).getByLabelText(/Persona prompt/i), { target: { value: "I speak plainly." } });

    expect(editPersona).toHaveBeenCalledWith("persona_mara", { description: "I speak plainly." });
  });

  it("does not expose a default-persona control", () => {
    renderPanel();

    expect(screen.queryByRole("button", { name: /default persona/i })).not.toBeInTheDocument();
  });
});
