import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SettingsSection, type RuntimeSettingsView } from "../../src/app/SettingsSection";

describe("SettingsSection", () => {
  it("offers the tested windowed evidence brief as the sole two-call memory option", () => {
    const setRuntimeSettings = vi.fn();
    const runtimeSettings = {
      textStreaming: false,
      banEmojis: false,
      promptDebugLogs: false,
      diceRollsEnabled: false,
      hiddenContinuityMode: "evidence-brief",
      onboardingCompleted: true,
      accentColor: "",
    } as RuntimeSettingsView;

    render(
      <SettingsSection
        runtimeSettings={runtimeSettings}
        setRuntimeSettings={setRuntimeSettings}
        promptPreview=""
        dataManagementStatus="Idle."
        exportRuntimeData={vi.fn()}
        importRuntimeData={vi.fn()}
        pendingImportReview={null}
        applyRuntimeImport={vi.fn()}
        cancelRuntimeImport={vi.fn()}
        downloadDiagnostics={vi.fn()}
        restorePoints={[]}
        restoreStatus=""
        restoreRuntimePoint={vi.fn()}
      />,
    );

    const runtimePanel = screen.getByRole("region", { name: /Runtime settings/i });
    expect(within(runtimePanel).getByText(/Desktop keys stored in the OS keychain use request\/response/i)).toBeInTheDocument();
    expect(within(runtimePanel).getByText(/older context.*four-message window/i)).toBeInTheDocument();
    const memoryMode = within(runtimePanel).getByLabelText(/Two-model-call memory/i);
    expect(within(memoryMode).getAllByRole("option")).toHaveLength(2);
    fireEvent.change(memoryMode, {
      target: { value: "off" },
    });
    expect(setRuntimeSettings).toHaveBeenCalledWith({ ...runtimeSettings, hiddenContinuityMode: "off" });
    expect(within(runtimePanel).queryByLabelText(/Economical continuity model/i)).not.toBeInTheDocument();
  });

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
        promptPreview=""
        dataManagementStatus="Idle."
        exportRuntimeData={exportRuntimeData}
        importRuntimeData={importRuntimeData}
        pendingImportReview={null}
        applyRuntimeImport={vi.fn()}
        cancelRuntimeImport={vi.fn()}
        downloadDiagnostics={downloadDiagnostics}
        restorePoints={[{ id: "restore_before_import", label: "Before runtime import", timeLabel: "Now" }]}
        restoreStatus="Restore points capture automatically as you play this session."
        restoreRuntimePoint={vi.fn()}
      />,
    );

    const runtimePanel = screen.getByRole("region", { name: /Runtime settings/i });
    fireEvent.click(within(runtimePanel).getByLabelText(/Text streaming/i));
    fireEvent.click(within(runtimePanel).getByLabelText(/Ban emojis/i));
    fireEvent.click(within(runtimePanel).getByLabelText(/Prompt debug logs/i));
    fireEvent.change(within(runtimePanel).getByLabelText(/Dialogue examples/i), {
      target: { value: "selective" },
    });

    expect(setRuntimeSettings).toHaveBeenCalledWith({ ...runtimeSettings, textStreaming: false });
    expect(setRuntimeSettings).toHaveBeenCalledWith({ ...runtimeSettings, banEmojis: true });
    expect(setRuntimeSettings).toHaveBeenCalledWith({ ...runtimeSettings, promptDebugLogs: true });
    expect(setRuntimeSettings).toHaveBeenCalledWith({ ...runtimeSettings, dialogueExampleMode: "selective" });
    expect(screen.getByText("(no runtime settings enabled)")).toBeInTheDocument();

    const dataPanel = screen.getByRole("region", { name: /Runtime data management/i });
    fireEvent.click(within(dataPanel).getByRole("button", { name: /Export runtime data/i }));
    fireEvent.click(within(dataPanel).getByRole("button", { name: /Download diagnostics/i }));
    expect(exportRuntimeData).toHaveBeenCalledTimes(1);
    expect(downloadDiagnostics).toHaveBeenCalledTimes(1);

    const importButton = within(dataPanel).getByRole("button", { name: /Review runtime import/i });
    expect(importButton).toBeDisabled();
    fireEvent.change(within(dataPanel).getByLabelText(/Runtime export JSON/i), {
      target: { value: '{"schema":"rpg.runtime.export"}' },
    });
    expect(importButton).toBeEnabled();
    fireEvent.click(importButton);

    expect(importRuntimeData).toHaveBeenCalledWith('{"schema":"rpg.runtime.export"}');
    expect(within(dataPanel).getByLabelText(/Runtime export JSON/i)).toHaveValue('{"schema":"rpg.runtime.export"}');
    expect(within(dataPanel).getByRole("status", { name: /Data management status/i })).toHaveTextContent("Idle.");
    expect(screen.getByRole("button", { name: /Restore Before runtime import/i })).toBeEnabled();
  });

  it("requires explicit confirmation before applying a reviewed runtime import", () => {
    const applyRuntimeImport = vi.fn();
    const cancelRuntimeImport = vi.fn();
    render(
      <SettingsSection
        runtimeSettings={{ textStreaming: false, banEmojis: false, promptDebugLogs: false, diceRollsEnabled: false, onboardingCompleted: true, accentColor: "" }}
        setRuntimeSettings={vi.fn()}
        promptPreview=""
        dataManagementStatus="Import parsed. Review before applying."
        exportRuntimeData={vi.fn()}
        importRuntimeData={vi.fn()}
        pendingImportReview={{ cards: 3, chats: 5, messages: 21, savedAt: "2026-07-12T00:00:00.000Z" }}
        applyRuntimeImport={applyRuntimeImport}
        cancelRuntimeImport={cancelRuntimeImport}
        downloadDiagnostics={vi.fn()}
        restorePoints={[]}
        restoreStatus=""
        restoreRuntimePoint={vi.fn()}
      />,
    );

    expect(screen.getByText(/3 cards.*5 chats.*21 messages/i)).toBeInTheDocument();
    expect(screen.getByRole("alertdialog", { name: /Replace current runtime data/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Replace runtime data/i }));
    expect(applyRuntimeImport).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /Cancel import/i }));
    expect(cancelRuntimeImport).toHaveBeenCalledTimes(1);
  });

  it("renders theme color controls and flags low-contrast customizations", () => {
    const setRuntimeSettings = vi.fn();
    const runtimeSettings: RuntimeSettingsView = {
      textStreaming: false,
      banEmojis: false,
      promptDebugLogs: false,
      diceRollsEnabled: false,
      onboardingCompleted: true,
      accentColor: "",
      themeColors: { text: "#f2f2f2" },
    };

    render(
      <SettingsSection
        theme="light"
        runtimeSettings={runtimeSettings}
        setRuntimeSettings={setRuntimeSettings}
        promptPreview=""
        dataManagementStatus="Idle."
        exportRuntimeData={vi.fn()}
        importRuntimeData={vi.fn()}
        pendingImportReview={null}
        applyRuntimeImport={vi.fn()}
        cancelRuntimeImport={vi.fn()}
        downloadDiagnostics={vi.fn()}
        restorePoints={[]}
        restoreStatus=""
        restoreRuntimePoint={vi.fn()}
      />,
    );

    const themePanel = screen.getByRole("region", { name: /Theme colors/i });
    // A pale primary text on the default panels breaches AA and is surfaced.
    expect(within(themePanel).getByRole("group", { name: /Color accessibility/i })).toHaveTextContent(/below WCAG AA/i);

    // Editing a swatch persists it under themeColors without dropping existing overrides.
    fireEvent.change(within(themePanel).getByLabelText(/App background color/i), {
      target: { value: "#101010" },
    });
    expect(setRuntimeSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        themeColors: expect.objectContaining({ text: "#f2f2f2", background: "#101010" }),
      }),
    );
  });
});
