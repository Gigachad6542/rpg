import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauriInvokeMock = vi.hoisted(() =>
  vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(async () => {
    throw new Error("Tauri unavailable");
  }),
);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauriInvokeMock,
}));

import { App } from "../../src/app/App";

const INIT_RESPONSE = { backend: "tauri-sqlite", schemaVersion: 1, migrations: [] };
const SECURE_STATUS = { available: false, storageKind: "os-keychain", reason: "test" };

function callsFor(command: string) {
  return tauriInvokeMock.mock.calls.filter(([name]) => name === command);
}

async function flushPendingWork(ms = 25) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("App desktop hydration gate", () => {
  beforeEach(() => {
    window.localStorage.clear();
    tauriInvokeMock.mockReset();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true,
    });
  });

  afterEach(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("pauses autosave and offers recovery when the desktop snapshot load fails", async () => {
    tauriInvokeMock.mockImplementation(async (command) => {
      if (command === "initialize_runtime_repository") return INIT_RESPONSE;
      if (command === "load_runtime_snapshot") throw new Error("database is corrupt");
      if (command === "secure_storage_status") return SECURE_STATUS;
      if (command === "save_runtime_snapshot") return { saved: true };
      throw new Error(`Unexpected command: ${command}`);
    });

    render(<App />);

    const dialog = await screen.findByRole("alertdialog", { name: /saved data could not be loaded/i });
    expect(dialog).toHaveTextContent(/database is corrupt/i);
    expect(within(dialog).getByText(/autosave is paused/i)).toBeInTheDocument();

    await flushPendingWork();
    expect(callsFor("save_runtime_snapshot")).toHaveLength(0);
  });

  it("recovers when retry succeeds after a transient load failure", async () => {
    let loadAttempts = 0;
    tauriInvokeMock.mockImplementation(async (command) => {
      if (command === "initialize_runtime_repository") return INIT_RESPONSE;
      if (command === "load_runtime_snapshot") {
        loadAttempts += 1;
        if (loadAttempts === 1) throw new Error("disk hiccup");
        return { snapshot: null };
      }
      if (command === "backup_runtime_database") return { backedUpTo: "backups/runtime-backup-1.db" };
      if (command === "save_runtime_snapshot") return { saved: true };
      if (command === "secure_storage_status") return SECURE_STATUS;
      throw new Error(`Unexpected command: ${command}`);
    });

    render(<App />);

    const dialog = await screen.findByRole("alertdialog", { name: /saved data could not be loaded/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /retry/i }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await waitFor(() => expect(callsFor("save_runtime_snapshot").length).toBeGreaterThan(0));

    const commandOrder = tauriInvokeMock.mock.calls.map(([name]) => name);
    const firstBackup = commandOrder.indexOf("backup_runtime_database");
    const firstSave = commandOrder.indexOf("save_runtime_snapshot");
    expect(firstBackup).toBeGreaterThan(-1);
    expect(firstBackup).toBeLessThan(firstSave);
  });

  it("archives the database and starts fresh from the recovery screen", async () => {
    let archived = false;
    tauriInvokeMock.mockImplementation(async (command) => {
      if (command === "initialize_runtime_repository") return INIT_RESPONSE;
      if (command === "load_runtime_snapshot") {
        if (!archived) throw new Error("database is corrupt");
        return { snapshot: null };
      }
      if (command === "archive_runtime_database") {
        archived = true;
        return { archivedTo: "backups/runtime-archive-1.db" };
      }
      if (command === "backup_runtime_database") return { backedUpTo: null };
      if (command === "save_runtime_snapshot") return { saved: true };
      if (command === "secure_storage_status") return SECURE_STATUS;
      throw new Error(`Unexpected command: ${command}`);
    });

    render(<App />);

    const dialog = await screen.findByRole("alertdialog", { name: /saved data could not be loaded/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /archive.*start fresh/i }));

    await waitFor(() => expect(callsFor("archive_runtime_database")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await waitFor(() => expect(callsFor("save_runtime_snapshot").length).toBeGreaterThan(0));
  });

  it("keeps a blocking loading gate up until hydration resolves", async () => {
    let resolveLoad!: (value: unknown) => void;
    tauriInvokeMock.mockImplementation(async (command) => {
      if (command === "initialize_runtime_repository") return INIT_RESPONSE;
      if (command === "load_runtime_snapshot") {
        return new Promise((resolve) => {
          resolveLoad = resolve;
        });
      }
      if (command === "backup_runtime_database") return { backedUpTo: null };
      if (command === "save_runtime_snapshot") return { saved: true };
      if (command === "secure_storage_status") return SECURE_STATUS;
      throw new Error(`Unexpected command: ${command}`);
    });

    render(<App />);

    await screen.findByText(/loading saved data/i);
    resolveLoad({ snapshot: null });
    await waitFor(() => expect(screen.queryByText(/loading saved data/i)).not.toBeInTheDocument());
  });
});
