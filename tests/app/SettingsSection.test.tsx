import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SettingsSection, type RuntimeSettingsView } from "../../src/app/SettingsSection";
import type { Persona } from "../../src/app/runtimeTypes";

const personas: Persona[] = [
  { id: "persona_default", name: "Default persona", description: "You are cautious.", lorebooks: [], isDefault: true },
  { id: "persona_mara", name: "Mara", description: "A careful cartographer.", lorebooks: [], isDefault: false },
];

describe("SettingsSection", () => {
  it("updates runtime settings and imports runtime JSON drafts", () => {
    const setRuntimeSettings = vi.fn();
    const exportRuntimeData = vi.fn();
    const importRuntimeData = vi.fn();
    const downloadDiagnostics = vi.fn();
    const runtimeSettings: RuntimeSettingsView = {
      textStreaming: true,
      banEmojis: false,
      promptDebugLogs: false,
      diceRollsEnabled: false,
      onboardingCompleted: false,
      accentColor: "",
    };

    render(
      <SettingsSection
        runtimeSettings={runtimeSettings}
        setRuntimeSettings={setRuntimeSettings}
        personas={personas}
        activePersonaId="persona_default"
        selectPersona={vi.fn()}
        addPersona={vi.fn()}
        editPersona={vi.fn()}
        removePersona={vi.fn()}
        makePersonaDefault={vi.fn()}
        promptPreview=""
        dataManagementStatus="Idle."
        exportRuntimeData={exportRuntimeData}
        importRuntimeData={importRuntimeData}
        downloadDiagnostics={downloadDiagnostics}
        restorePoints={[]}
        restoreStatus="Restore points capture automatically as you play this session."
        restoreRuntimePoint={vi.fn()}
      />,
    );

    const runtimePanel = screen.getByRole("region", { name: /Runtime settings/i });
    fireEvent.click(within(runtimePanel).getByLabelText(/Text streaming/i));
    fireEvent.click(within(runtimePanel).getByLabelText(/Ban emojis/i));
    fireEvent.click(within(runtimePanel).getByLabelText(/Prompt debug logs/i));

    expect(setRuntimeSettings).toHaveBeenCalledWith({ ...runtimeSettings, textStreaming: false });
    expect(setRuntimeSettings).toHaveBeenCalledWith({ ...runtimeSettings, banEmojis: true });
    expect(setRuntimeSettings).toHaveBeenCalledWith({ ...runtimeSettings, promptDebugLogs: true });
    expect(screen.getByText("(no runtime settings enabled)")).toBeInTheDocument();

    const dataPanel = screen.getByRole("region", { name: /Runtime data management/i });
    fireEvent.click(within(dataPanel).getByRole("button", { name: /Export runtime data/i }));
    fireEvent.click(within(dataPanel).getByRole("button", { name: /Download diagnostics/i }));
    expect(exportRuntimeData).toHaveBeenCalledTimes(1);
    expect(downloadDiagnostics).toHaveBeenCalledTimes(1);

    const importButton = within(dataPanel).getByRole("button", { name: /Import runtime data/i });
    expect(importButton).toBeDisabled();
    fireEvent.change(within(dataPanel).getByLabelText(/Runtime export JSON/i), {
      target: { value: '{"schema":"rpg.runtime.export"}' },
    });
    expect(importButton).toBeEnabled();
    fireEvent.click(importButton);

    expect(importRuntimeData).toHaveBeenCalledWith('{"schema":"rpg.runtime.export"}');
    expect(within(dataPanel).getByLabelText(/Runtime export JSON/i)).toHaveValue("");
    expect(within(dataPanel).getByRole("status", { name: /Data management status/i })).toHaveTextContent("Idle.");
  });

  it("creates, switches, edits, and deletes personas", () => {
    const selectPersona = vi.fn();
    const addPersona = vi.fn();
    const editPersona = vi.fn();
    const removePersona = vi.fn();
    const makePersonaDefault = vi.fn();

    render(
      <SettingsSection
        runtimeSettings={{
          textStreaming: false,
          banEmojis: false,
          promptDebugLogs: false,
          diceRollsEnabled: false,
          onboardingCompleted: false,
          accentColor: "",
        }}
        setRuntimeSettings={vi.fn()}
        personas={personas}
        activePersonaId="persona_default"
        selectPersona={selectPersona}
        addPersona={addPersona}
        editPersona={editPersona}
        removePersona={removePersona}
        makePersonaDefault={makePersonaDefault}
        promptPreview=""
        dataManagementStatus="Idle."
        exportRuntimeData={vi.fn()}
        importRuntimeData={vi.fn()}
        downloadDiagnostics={vi.fn()}
        restorePoints={[]}
        restoreStatus=""
        restoreRuntimePoint={vi.fn()}
      />,
    );

    const personaPanel = screen.getByRole("region", { name: /Persona profiles/i });
    fireEvent.change(within(personaPanel).getByLabelText(/New persona name/i), { target: { value: "Rook" } });
    fireEvent.click(within(personaPanel).getByRole("button", { name: /Create persona/i }));
    expect(addPersona).toHaveBeenCalledWith("Rook");

    fireEvent.click(within(personaPanel).getByRole("button", { name: /^Use Mara$/i }));
    expect(selectPersona).toHaveBeenCalledWith("persona_mara");

    fireEvent.click(within(personaPanel).getByRole("button", { name: /Make Mara the default persona/i }));
    expect(makePersonaDefault).toHaveBeenCalledWith("persona_mara");

    fireEvent.click(within(personaPanel).getByRole("button", { name: /Delete Mara/i }));
    expect(removePersona).toHaveBeenCalledWith("persona_mara");

    const editorPanel = screen.getByRole("region", { name: /Persona editor/i });
    fireEvent.change(within(editorPanel).getByLabelText(/Persona prompt/i), {
      target: { value: "I speak plainly." },
    });
    expect(editPersona).toHaveBeenCalledWith("persona_default", { description: "I speak plainly." });
  });
});
