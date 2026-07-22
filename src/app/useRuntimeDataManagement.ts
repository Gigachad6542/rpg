import { useRef, useState, type MutableRefObject } from "react";

import { countImportedMessages } from "./appControllerHelpers";
import { downloadJson, formatDownloadTimestamp, getErrorMessage, toRuntimeExportSnapshot } from "./appUtils";
import {
  buildRuntimeDiagnostics,
  buildVersionedRuntimeExport,
  parseVersionedRuntimeExport,
  type RuntimeExportSnapshot,
} from "./runtimeDataBundle";
import type { RepositoryRuntimeSnapshot } from "./runtimeRepositoryStore";
import type { AppRuntimeSnapshot } from "./runtimeTypes";

type RepositoryBackend = "tauri-sqlite" | "in-memory-sqlite" | "unknown";

export interface RuntimeImportReview {
  cards: number;
  chats: number;
  messages: number;
  savedAt: string;
}

export interface UseRuntimeDataManagementOptions {
  currentSnapshot: AppRuntimeSnapshot;
  captureRestorePoint: (snapshot?: AppRuntimeSnapshot) => void;
  hydrateFromSnapshot: (snapshot: RepositoryRuntimeSnapshot, status?: string) => void;
  repositoryStatus: string;
  saveStatus: string;
  providerKeyStatus: string;
  imageProviderStatus: string;
  getRepositoryBackend: () => RepositoryBackend;
  generationInFlightRef?: MutableRefObject<boolean>;
}

export interface RuntimeDataManagementController {
  dataManagementStatus: string;
  pendingImportSnapshot: RuntimeExportSnapshot | null;
  pendingImportReview: RuntimeImportReview | null;
  exportRuntimeData: () => void;
  importRuntimeData: (rawJson: string) => void;
  applyRuntimeImport: () => void;
  cancelRuntimeImport: () => void;
  downloadDiagnostics: () => void;
}

export function useRuntimeDataManagement({
  currentSnapshot,
  captureRestorePoint,
  hydrateFromSnapshot,
  repositoryStatus,
  saveStatus,
  providerKeyStatus,
  imageProviderStatus,
  getRepositoryBackend,
  generationInFlightRef,
}: UseRuntimeDataManagementOptions): RuntimeDataManagementController {
  const internalGenerationInFlightRef = useRef(false);
  const turnGenerationInFlightRef = generationInFlightRef ?? internalGenerationInFlightRef;
  const [dataManagementStatus, setDataManagementStatus] = useState(
    "Runtime export, import, and diagnostics are ready.",
  );
  const [pendingImportSnapshot, setPendingImportSnapshot] = useState<RuntimeExportSnapshot | null>(null);

  function exportRuntimeData() {
    const bundle = buildVersionedRuntimeExport(toRuntimeExportSnapshot(currentSnapshot));
    downloadJson(`local-first-rpg-runtime-${formatDownloadTimestamp(bundle.exportedAt)}.json`, bundle);
    setDataManagementStatus(`Runtime export downloaded: schema v${bundle.version}.`);
  }

  function importRuntimeData(rawJson: string) {
    try {
      const snapshot = parseVersionedRuntimeExport(rawJson);
      setPendingImportSnapshot(snapshot);
      const chats = Array.isArray(snapshot.chatSessions) ? snapshot.chatSessions.length : 0;
      const messages = countImportedMessages(snapshot);
      setDataManagementStatus(
        `Import parsed: ${snapshot.cards.length} cards, ${chats} chats, ${messages} messages. Review before applying.`,
      );
    } catch (error) {
      setPendingImportSnapshot(null);
      setDataManagementStatus(getErrorMessage(error));
    }
  }

  function applyRuntimeImport() {
    if (!pendingImportSnapshot) return;
    if (turnGenerationInFlightRef.current) {
      setDataManagementStatus("Stop the in-flight generation before applying a runtime import.");
      return;
    }
    captureRestorePoint();
    hydrateFromSnapshot(pendingImportSnapshot as RepositoryRuntimeSnapshot, "Imported runtime export.");
    setDataManagementStatus(`Imported runtime export saved at ${pendingImportSnapshot.savedAt}.`);
    setPendingImportSnapshot(null);
  }

  function cancelRuntimeImport() {
    setPendingImportSnapshot(null);
    setDataManagementStatus("Runtime import cancelled; current data was not changed.");
  }

  function downloadDiagnostics() {
    const diagnostics = buildRuntimeDiagnostics({
      snapshot: toRuntimeExportSnapshot(currentSnapshot),
      repositoryStatus,
      saveStatus,
      providerKeyStatus,
      imageProviderStatus,
      runtimeBackend: getRepositoryBackend(),
    });
    downloadJson(`local-first-rpg-diagnostics-${formatDownloadTimestamp(diagnostics.exportedAt)}.json`, diagnostics);
    setDataManagementStatus(`Diagnostics downloaded: schema v${diagnostics.version}.`);
  }

  const pendingImportReview = pendingImportSnapshot
    ? {
        cards: pendingImportSnapshot.cards.length,
        chats: pendingImportSnapshot.chatSessions?.length ?? 0,
        messages: countImportedMessages(pendingImportSnapshot),
        savedAt: pendingImportSnapshot.savedAt,
      }
    : null;

  return {
    dataManagementStatus,
    pendingImportSnapshot,
    pendingImportReview,
    exportRuntimeData,
    importRuntimeData,
    applyRuntimeImport,
    cancelRuntimeImport,
    downloadDiagnostics,
  };
}
