import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  defaultImageProviderSettings,
  defaultProviderSettings,
  defaultRuntimeSettings,
  initialCards,
} from "../../src/app/appDefaults";
import { downloadJson, toRuntimeExportSnapshot } from "../../src/app/appUtils";
import { buildVersionedRuntimeExport } from "../../src/app/runtimeDataBundle";
import type { RepositoryRuntimeSnapshot } from "../../src/app/runtimeRepositoryStore";
import type { AppRuntimeSnapshot } from "../../src/app/runtimeTypes";
import { useRuntimeDataManagement } from "../../src/app/useRuntimeDataManagement";

vi.mock("../../src/app/appUtils", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/app/appUtils")>(),
  downloadJson: vi.fn(),
}));

const downloadJsonMock = vi.mocked(downloadJson);

function createSnapshot(overrides: Partial<AppRuntimeSnapshot> = {}): AppRuntimeSnapshot {
  return {
    version: 2,
    theme: "dark",
    activeCardId: initialCards[0].id,
    cards: structuredClone(initialCards),
    messages: [],
    chatSessions: [],
    activeChatIds: {},
    promptRuns: [],
    providerKeyStatus: "Mock provider active.",
    providerSettings: structuredClone(defaultProviderSettings),
    imageProviderSettings: structuredClone(defaultImageProviderSettings),
    runtimeSettings: structuredClone(defaultRuntimeSettings),
    personas: [],
    activePersonaId: "",
    generatedMaps: [],
    savedAt: "2026-07-15T01:00:00.000Z",
    ...overrides,
  };
}

function renderManagement(overrides: Partial<Parameters<typeof useRuntimeDataManagement>[0]> = {}) {
  const currentSnapshot = createSnapshot();
  const captureRestorePoint = vi.fn();
  const hydrateFromSnapshot = vi.fn<(snapshot: RepositoryRuntimeSnapshot, status?: string) => void>();
  const getRepositoryBackend = vi.fn(() => "tauri-sqlite" as const);
  const options: Parameters<typeof useRuntimeDataManagement>[0] = {
    currentSnapshot,
    captureRestorePoint,
    hydrateFromSnapshot,
    repositoryStatus: "SQLite repository ready.",
    saveStatus: "Saved to local SQLite repository.",
    providerKeyStatus: "Only a secret reference is persisted.",
    imageProviderStatus: "Prompt-only image mode active.",
    getRepositoryBackend,
    ...overrides,
  };
  const hook = renderHook(() => useRuntimeDataManagement(options));
  return { ...hook, captureRestorePoint, hydrateFromSnapshot, getRepositoryBackend };
}

describe("useRuntimeDataManagement", () => {
  beforeEach(() => {
    downloadJsonMock.mockReset();
  });

  it("keeps invalid imports out of review and never mutates runtime state", () => {
    const { result, captureRestorePoint, hydrateFromSnapshot } = renderManagement();

    act(() => result.current.importRuntimeData("{not-json"));

    expect(result.current.pendingImportSnapshot).toBeNull();
    expect(result.current.dataManagementStatus).toMatch(/invalid|json/i);
    expect(captureRestorePoint).not.toHaveBeenCalled();
    expect(hydrateFromSnapshot).not.toHaveBeenCalled();
  });

  it("requires review and captures the current state before applying a valid replacement", () => {
    const callOrder: string[] = [];
    const captureRestorePoint = vi.fn(() => callOrder.push("capture"));
    const hydrateFromSnapshot = vi.fn(() => callOrder.push("hydrate"));
    const importedSnapshot = createSnapshot({
      activeCardId: initialCards[1].id,
      savedAt: "2026-07-15T02:00:00.000Z",
    });
    const rawJson = JSON.stringify(buildVersionedRuntimeExport(toRuntimeExportSnapshot(importedSnapshot)));
    const { result } = renderManagement({ captureRestorePoint, hydrateFromSnapshot });

    act(() => result.current.importRuntimeData(rawJson));

    expect(result.current.pendingImportSnapshot?.activeCardId).toBe(initialCards[1].id);
    expect(captureRestorePoint).not.toHaveBeenCalled();
    expect(hydrateFromSnapshot).not.toHaveBeenCalled();

    act(() => result.current.applyRuntimeImport());

    expect(callOrder).toEqual(["capture", "hydrate"]);
    expect(hydrateFromSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ activeCardId: initialCards[1].id }),
      "Imported runtime export.",
    );
    expect(result.current.pendingImportSnapshot).toBeNull();
    expect(result.current.dataManagementStatus).toContain(importedSnapshot.savedAt);
  });

  it("keeps a reviewed import pending while a turn generation is in flight", () => {
    const importedSnapshot = createSnapshot({ savedAt: "2026-07-15T03:00:00.000Z" });
    const rawJson = JSON.stringify(buildVersionedRuntimeExport(toRuntimeExportSnapshot(importedSnapshot)));
    const { result, captureRestorePoint, hydrateFromSnapshot } = renderManagement({
      generationInFlightRef: { current: true },
    });

    act(() => result.current.importRuntimeData(rawJson));
    act(() => result.current.applyRuntimeImport());

    expect(captureRestorePoint).not.toHaveBeenCalled();
    expect(hydrateFromSnapshot).not.toHaveBeenCalled();
    expect(result.current.pendingImportSnapshot).not.toBeNull();
    expect(result.current.dataManagementStatus).toMatch(/stop the in-flight generation/i);
  });

  it("downloads a versioned runtime export and redacted repository diagnostics", () => {
    const secret = "sk-live-diagnostics-secret";
    const currentSnapshot = createSnapshot({
      messages: [{ id: "message-1", role: "user", content: secret }],
      providerKeyStatus: `Stored ${secret}`,
    });
    const { result, getRepositoryBackend } = renderManagement({
      currentSnapshot,
      providerKeyStatus: `Stored ${secret}`,
    });

    act(() => result.current.exportRuntimeData());
    act(() => result.current.downloadDiagnostics());

    expect(downloadJsonMock).toHaveBeenCalledTimes(2);
    expect(downloadJsonMock.mock.calls[0]?.[0]).toMatch(/^local-first-rpg-runtime-.+\.json$/);
    expect(downloadJsonMock.mock.calls[0]?.[1]).toMatchObject({
      schema: "rpg.runtime.export",
      version: 1,
    });
    expect(downloadJsonMock.mock.calls[1]?.[0]).toMatch(/^local-first-rpg-diagnostics-.+\.json$/);
    expect(downloadJsonMock.mock.calls[1]?.[1]).toMatchObject({
      schema: "rpg.runtime.diagnostics",
      runtime: { backend: "tauri-sqlite" },
    });
    expect(JSON.stringify(downloadJsonMock.mock.calls[1]?.[1])).not.toContain(secret);
    expect(getRepositoryBackend).toHaveBeenCalledTimes(1);
  });
});
