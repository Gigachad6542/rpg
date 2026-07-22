import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  defaultImageProviderSettings,
  defaultProviderSettings,
  defaultRuntimeSettings,
  initialCards,
} from "../../src/app/appDefaults";
import { RuntimeRepositoryStore, type RuntimeRepository } from "../../src/app/runtimeRepositoryStore";
import type { AppRuntimeSnapshot } from "../../src/app/runtimeTypes";
import { useRuntimePersistence } from "../../src/app/useRuntimePersistence";

vi.mock("../../src/app/runtimeRepositoryStore", () => ({
  RuntimeRepositoryStore: {
    create: vi.fn(),
  },
}));

const repositoryCreateMock = vi.mocked(RuntimeRepositoryStore.create);

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
    savedAt: "2026-07-15T00:00:00.000Z",
    ...overrides,
  };
}

function createStore(overrides: Partial<RuntimeRepository> = {}): RuntimeRepository {
  return {
    getStatus: () => ({ backend: "tauri-sqlite" }),
    loadSnapshot: vi.fn(async () => null),
    saveSnapshot: vi.fn(async () => undefined),
    backupDatabase: vi.fn(async () => null),
    ...overrides,
  };
}

describe("useRuntimePersistence", () => {
  beforeEach(() => {
    repositoryCreateMock.mockReset();
    window.localStorage.clear();
  });

  it("does not expose readiness or write desktop state until load and startup backup complete", async () => {
    let resolveBackup!: (path: string | null) => void;
    const saveSnapshot = vi.fn(async () => undefined);
    const backupDatabase = vi.fn(
      () => new Promise<string | null>((resolve) => {
        resolveBackup = resolve;
      }),
    );
    repositoryCreateMock.mockResolvedValue(createStore({ saveSnapshot, backupDatabase }));
    const currentSnapshot = createSnapshot();
    const applyResolvedRuntimeState = vi.fn();

    const { result } = renderHook(() => useRuntimePersistence({
      initialSnapshot: null,
      currentSnapshot,
      applyResolvedRuntimeState,
      desktopRuntime: true,
    }));

    await waitFor(() => expect(backupDatabase).toHaveBeenCalledTimes(1));
    expect(result.current.hydration.phase).toBe("loading");
    expect(saveSnapshot).not.toHaveBeenCalled();

    act(() => resolveBackup("backups/runtime-backup.db"));

    await waitFor(() => expect(result.current.hydration.phase).toBe("ready"));
    await waitFor(() => expect(saveSnapshot).toHaveBeenCalledTimes(1));
    expect(result.current.repositoryStatus).toContain("Startup backup saved");
  });

  it("fails closed without writing when desktop hydration cannot load saved state", async () => {
    const saveSnapshot = vi.fn(async () => undefined);
    repositoryCreateMock.mockResolvedValue(createStore({
      loadSnapshot: vi.fn(async () => {
        throw new Error("database is corrupt");
      }),
      saveSnapshot,
    }));
    const currentSnapshot = createSnapshot();
    const applyResolvedRuntimeState = vi.fn();

    const { result } = renderHook(() => useRuntimePersistence({
      initialSnapshot: null,
      currentSnapshot,
      applyResolvedRuntimeState,
      desktopRuntime: true,
    }));

    await waitFor(() => expect(result.current.hydration.phase).toBe("failed"));
    expect(result.current.repositoryStatus).toContain("database is corrupt");
    expect(result.current.saveStatus).toContain("Autosave paused");
    expect(saveSnapshot).not.toHaveBeenCalled();
  });

  it("captures the current state before restoring an earlier local point", async () => {
    const saveSnapshot = vi.fn(async () => undefined);
    repositoryCreateMock.mockResolvedValue(createStore({ saveSnapshot }));
    const applyResolvedRuntimeState = vi.fn();
    const original = createSnapshot({ savedAt: "2026-07-15T00:00:00.000Z" });
    let current = original;

    const { result, rerender } = renderHook(() => useRuntimePersistence({
      initialSnapshot: null,
      currentSnapshot: current,
      applyResolvedRuntimeState,
      desktopRuntime: true,
    }));

    await waitFor(() => expect(result.current.hydration.phase).toBe("ready"));
    await waitFor(() => expect(result.current.saveStatus).toBe("Saved to local SQLite repository."));
    act(() => result.current.captureRestorePoint(original));
    await waitFor(() => expect(result.current.restorePoints.length).toBeGreaterThan(0));
    const originalPointId = result.current.restorePoints[0]?.id;
    expect(originalPointId).toBeTruthy();

    current = createSnapshot({ activeCardId: initialCards[1].id, savedAt: "2026-07-15T00:01:00.000Z" });
    rerender();
    await waitFor(() => expect(saveSnapshot).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.saveStatus).toBe("Saved to local SQLite repository."));
    const pointCountBeforeRestore = result.current.restorePoints.length;
    act(() => result.current.restoreRuntimeFromPoint(originalPointId!));

    expect(applyResolvedRuntimeState).toHaveBeenCalledWith(expect.objectContaining({
      activeCardId: original.activeCardId,
    }));
    expect(result.current.restoreStatus).toContain("Restored");
    expect(result.current.restorePoints).toHaveLength(pointCountBeforeRestore + 1);
  });

  it("does not restore over a turn generation that is in flight", async () => {
    repositoryCreateMock.mockResolvedValue(createStore());
    const applyResolvedRuntimeState = vi.fn();
    const snapshot = createSnapshot();
    const { result } = renderHook(() => useRuntimePersistence({
      initialSnapshot: null,
      currentSnapshot: snapshot,
      applyResolvedRuntimeState,
      desktopRuntime: true,
      generationInFlightRef: { current: true },
    }));

    await waitFor(() => expect(result.current.hydration.phase).toBe("ready"));
    act(() => result.current.captureRestorePoint(snapshot));
    await waitFor(() => expect(result.current.restorePoints).toHaveLength(1));

    act(() => result.current.restoreRuntimeFromPoint(result.current.restorePoints[0]!.id));

    expect(applyResolvedRuntimeState).not.toHaveBeenCalled();
    expect(result.current.restorePoints).toHaveLength(1);
    expect(result.current.restoreStatus).toMatch(/stop the in-flight generation/i);
  });
});
