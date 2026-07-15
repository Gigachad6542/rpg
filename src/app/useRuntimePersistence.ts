import { useCallback, useEffect, useRef, useState } from "react";

import {
  appendRestorePoint,
  buildRestorePoint,
  findRestorePoint,
  type RestorePoint,
} from "../runtime/restorePoints";
import { syncGeneratedImageFiles } from "./imagePersistence";
import {
  loadLocalRestorePoints,
  saveLocalRestorePoints,
  shouldPersistRestorePointsInWebviewStorage,
} from "./localRestorePointStore";
import { saveLocalRuntimeSnapshot } from "./localRuntimeStore";
import { conversationRestoreSignature } from "./restoreSignature";
import { RuntimeRepositoryStore, type RepositoryRuntimeSnapshot } from "./runtimeRepositoryStore";
import { createSnapshotSaveQueue, type SnapshotSaveQueue } from "./snapshotSaveQueue";
import {
  resolveHydrationFailure,
  shouldPersistFullLocalSnapshot,
  shouldUseRepositorySnapshot,
  type HydrationState,
  type SnapshotCandidate,
} from "./startupPersistencePolicy";
import { archiveDesktopRuntimeDatabase } from "./tauriRuntimeRepositoryClient";
import { formatRestorePointTime, getErrorMessage, toRepositorySnapshot } from "./appUtils";
import { createRuntimeEntityId } from "./chatSessions";
import { initialCards, starterMessages } from "./appDefaults";
import { resolveRuntimeSnapshotState, type ResolvedRuntimeSnapshotState } from "./runtimeSnapshotHydration";
import { isTauriRuntime } from "./turnPromptBuilders";
import type { AppRuntimeSnapshot, GeneratedMapArtifact } from "./runtimeTypes";

export interface UseRuntimePersistenceOptions {
  initialSnapshot: SnapshotCandidate | null;
  currentSnapshot: AppRuntimeSnapshot;
  applyResolvedRuntimeState: (state: ResolvedRuntimeSnapshotState) => void;
  desktopRuntime?: boolean;
}

export interface RuntimePersistenceController {
  saveStatus: string;
  repositoryStatus: string;
  hydration: HydrationState;
  repositoryHydrated: boolean;
  restorePoints: RestorePoint<AppRuntimeSnapshot>[];
  restoreStatus: string;
  hydrateFromSnapshot: (snapshot: RepositoryRuntimeSnapshot, status?: string) => void;
  captureRestorePoint: (snapshot?: AppRuntimeSnapshot) => void;
  retryHydration: () => void;
  archiveDatabaseAndStartFresh: () => Promise<void>;
  restoreRuntimeFromPoint: (pointId: string) => void;
  getRepositoryBackend: () => "tauri-sqlite" | "in-memory-sqlite" | "unknown";
}

export function useRuntimePersistence({
  initialSnapshot,
  currentSnapshot,
  applyResolvedRuntimeState,
  desktopRuntime,
}: UseRuntimePersistenceOptions): RuntimePersistenceController {
  const isDesktopRuntime = desktopRuntime ?? isTauriRuntime();
  const repositoryStoreRef = useRef<Awaited<ReturnType<typeof RuntimeRepositoryStore.create>> | null>(null);
  const snapshotSaveQueueRef = useRef<SnapshotSaveQueue<RepositoryRuntimeSnapshot> | null>(null);
  const currentSnapshotRef = useRef(currentSnapshot);
  const restoreSignatureRef = useRef("");
  const [saveStatus, setSaveStatus] = useState(
    initialSnapshot ? "Loaded local runtime snapshot." : "Ready for local save.",
  );
  const [repositoryStatus, setRepositoryStatus] = useState("Repository store initializing.");
  const [hydration, setHydration] = useState<HydrationState>({ phase: "loading" });
  const [hydrationAttempt, setHydrationAttempt] = useState(0);
  const repositoryHydrated = hydration.phase === "ready";
  const [restorePoints, setRestorePoints] = useState<RestorePoint<AppRuntimeSnapshot>[]>(() =>
    shouldPersistRestorePointsInWebviewStorage({ isDesktopRuntime })
      ? loadLocalRestorePoints<AppRuntimeSnapshot>()
      : [],
  );
  const [restoreStatus, setRestoreStatus] = useState(() =>
    isDesktopRuntime
      ? "Restore points are available for this session; rotating SQLite backups persist across restarts."
      : "Restore points persist automatically as you play.",
  );

  const hydrateFromSnapshot = useCallback((
    snapshot: RepositoryRuntimeSnapshot,
    status = "Loaded repository runtime snapshot.",
  ) => {
    applyResolvedRuntimeState(resolveRuntimeSnapshotState(snapshot, {
      fallbackCards: initialCards,
      fallbackMessages: starterMessages,
    }));
    setSaveStatus(status);
  }, [applyResolvedRuntimeState]);

  const captureRestorePoint = useCallback((snapshot?: AppRuntimeSnapshot) => {
    const capturedSnapshot = snapshot ?? currentSnapshotRef.current;
    setRestorePoints((current) =>
      appendRestorePoint(
        current,
        buildRestorePoint({
          id: createRuntimeEntityId("restore"),
          createdAt: new Date().toISOString(),
          snapshot: capturedSnapshot,
        }),
      ),
    );
  }, []);

  useEffect(() => {
    currentSnapshotRef.current = currentSnapshot;
  }, [currentSnapshot]);

  useEffect(() => {
    if (!repositoryHydrated) {
      return;
    }
    const signature = conversationRestoreSignature(currentSnapshot.chatSessions, currentSnapshot.cards.length);
    if (signature === restoreSignatureRef.current) {
      return;
    }
    restoreSignatureRef.current = signature;
    captureRestorePoint();
  }, [captureRestorePoint, currentSnapshot.cards.length, currentSnapshot.chatSessions, repositoryHydrated]);

  useEffect(() => {
    if (!shouldPersistRestorePointsInWebviewStorage({ isDesktopRuntime })) {
      return;
    }
    if (!saveLocalRestorePoints(restorePoints)) {
      setRestoreStatus("Restore points are available this session, but could not be persisted locally.");
    }
  }, [isDesktopRuntime, restorePoints]);

  useEffect(() => {
    if (!repositoryHydrated) return;
    const generatedMaps = currentSnapshot.generatedMaps as GeneratedMapArtifact[];
    void syncGeneratedImageFiles(generatedMaps.map((artifact) => artifact.id));
  }, [currentSnapshot.generatedMaps, repositoryHydrated]);

  useEffect(() => {
    let cancelled = false;
    setHydration({ phase: "loading" });

    void RuntimeRepositoryStore.create()
      .then(async (store) => {
        if (cancelled) {
          return;
        }

        repositoryStoreRef.current = store;
        setRepositoryStatus(
          store.getStatus().backend === "tauri-sqlite"
            ? "SQLite repository ready."
            : "Repository API ready with in-memory SQL fallback.",
        );

        try {
          const repositorySnapshot = await store.loadSnapshot();
          if (cancelled) {
            return;
          }
          if (repositorySnapshot && shouldUseRepositorySnapshot(repositorySnapshot, initialSnapshot)) {
            hydrateFromSnapshot(repositorySnapshot);
          }
          // The rotating startup backup must land before autosave can write desktop state.
          const backupPath = await (store.backupDatabase?.() ?? Promise.resolve(null)).catch(() => {
            if (!cancelled) {
              setSaveStatus("Warning: startup database backup failed; autosave continues.");
            }
            return null;
          });
          if (cancelled) {
            return;
          }
          if (backupPath) {
            setRepositoryStatus("SQLite repository ready. Startup backup saved.");
          }
          setHydration({ phase: "ready" });
        } catch (error) {
          if (cancelled) {
            return;
          }
          const message = getErrorMessage(error);
          setRepositoryStatus(`Repository load failed: ${message}`);
          setHydration(resolveHydrationFailure({ isDesktopRuntime, error: message }));
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        const message = getErrorMessage(error);
        setRepositoryStatus(`Repository unavailable: ${message}`);
        setHydration(resolveHydrationFailure({ isDesktopRuntime, error: message }));
      });

    return () => {
      cancelled = true;
    };
  }, [hydrateFromSnapshot, hydrationAttempt, initialSnapshot, isDesktopRuntime]);

  useEffect(() => {
    let cancelled = false;
    const shouldPersistBrowserFallback = shouldPersistFullLocalSnapshot({ isDesktopRuntime });
    if (shouldPersistBrowserFallback) {
      saveLocalRuntimeSnapshot(currentSnapshot);
      setSaveStatus("Saved locally in this browser runtime.");
    } else if (hydration.phase === "failed") {
      setSaveStatus("Autosave paused: saved data could not be loaded.");
    } else if (hydration.phase === "loading") {
      setSaveStatus("Waiting for SQLite repository before writing desktop state.");
    }

    const store = repositoryStoreRef.current;
    if (store && repositoryHydrated) {
      snapshotSaveQueueRef.current ??= createSnapshotSaveQueue((snapshot: RepositoryRuntimeSnapshot) =>
        store.saveSnapshot(snapshot),
      );
      void snapshotSaveQueueRef.current
        .enqueue(toRepositorySnapshot(currentSnapshot))
        .then(() => {
          if (!cancelled) {
            setSaveStatus(
              store.getStatus().backend === "tauri-sqlite"
                ? "Saved to local SQLite repository."
                : "Saved to repository API and browser fallback.",
            );
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setSaveStatus(
              shouldPersistBrowserFallback
                ? `Local fallback saved; repository save failed: ${getErrorMessage(error)}`
                : `Repository save failed: ${getErrorMessage(error)}`,
            );
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [currentSnapshot, hydration, isDesktopRuntime, repositoryHydrated]);

  const retryHydration = useCallback(() => {
    setHydrationAttempt((attempt) => attempt + 1);
  }, []);

  const archiveDatabaseAndStartFresh = useCallback(async () => {
    try {
      const archivedTo = await archiveDesktopRuntimeDatabase();
      setRepositoryStatus(
        archivedTo ? `Previous database archived to ${archivedTo}.` : "Starting with a fresh database.",
      );
      setHydrationAttempt((attempt) => attempt + 1);
    } catch (error) {
      setHydration({
        phase: "failed",
        error: `Could not archive the current database: ${getErrorMessage(error)}`,
      });
    }
  }, []);

  const restoreRuntimeFromPoint = useCallback((pointId: string) => {
    const point = findRestorePoint(restorePoints, pointId);
    if (!point) {
      setRestoreStatus("That restore point is no longer available.");
      return;
    }
    const snapshot = point.snapshot;
    captureRestorePoint();
    const restoredMessages = snapshot.chatSessions.reduce((count, session) => count + session.messages.length, 0);
    restoreSignatureRef.current = `${restoredMessages}:${snapshot.cards.length}`;
    applyResolvedRuntimeState(resolveRuntimeSnapshotState(snapshot, {
      fallbackCards: initialCards,
      fallbackMessages: starterMessages,
    }));
    setRestoreStatus(`Restored "${point.label}" from ${formatRestorePointTime(point.createdAt)}.`);
  }, [applyResolvedRuntimeState, captureRestorePoint, restorePoints]);

  const getRepositoryBackend = useCallback(
    () => repositoryStoreRef.current?.getStatus().backend ?? "unknown",
    [],
  );

  return {
    saveStatus,
    repositoryStatus,
    hydration,
    repositoryHydrated,
    restorePoints,
    restoreStatus,
    hydrateFromSnapshot,
    captureRestorePoint,
    retryHydration,
    archiveDatabaseAndStartFresh,
    restoreRuntimeFromPoint,
    getRepositoryBackend,
  };
}
