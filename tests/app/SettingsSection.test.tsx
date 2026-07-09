import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SettingsSection, type RuntimeSettingsView } from "../../src/app/SettingsSection";

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
      impersonationPrompt: "You are cautious.",
      accentColor: "",
    };

    render(
      <SettingsSection
        runtimeSettings={runtimeSettings}
        setRuntimeSettings={setRuntimeSettings}
        promptPreview=""
        dataManagementStatus="Idle."
        exportRuntimeData={exportRuntimeData}
        importRuntimeData={importRuntimeData}
        downloadDiagnostics={downloadDiagnostics}
      />,
    );

    const runtimePanel = screen.getByRole("region", { name: /Runtime settings/i });
    fireEvent.click(within(runtimePanel).getByLabelText(/Text streaming/i));
    fireEvent.click(within(runtimePanel).getByLabelText(/Ban emojis/i));
    fireEvent.click(within(runtimePanel).getByLabelText(/Prompt debug logs/i));
    fireEvent.change(within(runtimePanel).getByLabelText(/Impersonation prompt/i), {
      target: { value: "Speak in first person." },
    });

    expect(setRuntimeSettings).toHaveBeenCalledWith({ ...runtimeSettings, textStreaming: false });
    expect(setRuntimeSettings).toHaveBeenCalledWith({ ...runtimeSettings, banEmojis: true });
    expect(setRuntimeSettings).toHaveBeenCalledWith({ ...runtimeSettings, promptDebugLogs: true });
    expect(setRuntimeSettings).toHaveBeenCalledWith({
      ...runtimeSettings,
      impersonationPrompt: "Speak in first person.",
    });
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
});
