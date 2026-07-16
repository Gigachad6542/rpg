import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PersonasPanel } from "../../src/app/PersonasPanel";
import { SettingsSection, type RuntimeSettingsView } from "../../src/app/SettingsSection";
import type { Persona } from "../../src/app/runtimeTypes";

const personas: Persona[] = [
  { id: "persona_ranger", name: "Ranger", description: "A wary ranger.", lorebooks: [] },
  { id: "persona_mara", name: "Mara", description: "Cartographer", lorebooks: [] },
];

const runtimeSettings: RuntimeSettingsView = {
  textStreaming: false,
  banEmojis: false,
  promptDebugLogs: false,
  diceRollsEnabled: false,
  onboardingCompleted: true,
  accentColor: "",
};

function renderSettings(restoreRuntimePoint: (id: string) => void) {
  return render(
    <SettingsSection
      runtimeSettings={runtimeSettings}
      setRuntimeSettings={vi.fn()}
      promptPreview=""
      dataManagementStatus="Idle."
      exportRuntimeData={vi.fn()}
      importRuntimeData={vi.fn()}
      pendingImportReview={null}
      applyRuntimeImport={vi.fn()}
      cancelRuntimeImport={vi.fn()}
      downloadDiagnostics={vi.fn()}
      restorePoints={[{ id: "restore_before_update", label: "Before update", timeLabel: "Just now" }]}
      restoreStatus=""
      restoreRuntimePoint={restoreRuntimePoint}
    />,
  );
}

describe("Settings destructive actions", () => {
  it("requires a keyboard-safe confirmation before restoring a runtime snapshot", () => {
    const restoreRuntimePoint = vi.fn();
    renderSettings(restoreRuntimePoint);

    const opener = screen.getByRole("button", { name: /Restore Before update/i });
    opener.focus();
    fireEvent.click(opener);

    expect(restoreRuntimePoint).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog", { name: /Restore Before update/i });
    expect(dialog).toHaveTextContent(/current runtime.*restore point.*before replacement/i);
    expect(screen.getByRole("button", { name: /Cancel restore/i })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(restoreRuntimePoint).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();

    fireEvent.click(opener);
    fireEvent.click(screen.getByRole("button", { name: /Restore selected point/i }));
    expect(restoreRuntimePoint).toHaveBeenCalledWith("restore_before_update");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("requires a keyboard-safe confirmation before deleting a persona", () => {
    const removePersona = vi.fn();
    render(
      <PersonasPanel
        personas={personas}
        activePersonaId="persona_default"
        selectPersona={vi.fn()}
        addPersona={vi.fn()}
        editPersona={vi.fn()}
        removePersona={removePersona}
      />,
    );

    const opener = screen.getByRole("button", { name: /Delete Mara/i });
    opener.focus();
    fireEvent.click(opener);

    expect(removePersona).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog", { name: /Delete Mara/i })).toHaveTextContent(/local restore point/i);
    expect(screen.getByRole("button", { name: /Cancel deletion/i })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(removePersona).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();

    fireEvent.click(opener);
    fireEvent.click(screen.getByRole("button", { name: /Delete persona/i }));
    expect(removePersona).toHaveBeenCalledWith("persona_mara");
  });
});
