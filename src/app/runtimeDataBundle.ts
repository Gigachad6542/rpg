import {
  sanitizeGeneratedMaps,
  sanitizePersistedImageProviderSettings,
  sanitizePersistedProviderSettings,
  sanitizePersistedRuntimeSettings,
  sanitizePromptRunsForExport,
  type LocalRuntimeSnapshot,
} from "./localRuntimeStore";
import type { RuntimeRepositoryStoreStatus } from "./runtimeRepositoryStore";

export const RUNTIME_EXPORT_SCHEMA_VERSION = 1;
export const RUNTIME_DIAGNOSTICS_SCHEMA_VERSION = 1;

export type RuntimeExportSnapshot = LocalRuntimeSnapshot<
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, unknown>
>;

export interface RuntimeExportBundle {
  schema: "rpg.runtime.export";
  version: typeof RUNTIME_EXPORT_SCHEMA_VERSION;
  exportedAt: string;
  app: {
    name: "rpg";
    exportFormat: "runtime-bundle";
  };
  snapshot: RuntimeExportSnapshot;
}

export interface RuntimeExportOptions {
  exportedAt?: string;
}

export interface RuntimeDiagnosticsInput {
  snapshot: RuntimeExportSnapshot;
  exportedAt?: string;
  repositoryStatus: string;
  saveStatus: string;
  providerKeyStatus: string;
  imageProviderStatus: string;
  runtimeBackend?: RuntimeRepositoryStoreStatus["backend"] | "unknown";
}

export interface RuntimeDiagnostics {
  schema: "rpg.runtime.diagnostics";
  version: typeof RUNTIME_DIAGNOSTICS_SCHEMA_VERSION;
  exportedAt: string;
  app: {
    name: "rpg";
  };
  runtime: {
    backend: RuntimeRepositoryStoreStatus["backend"] | "unknown";
    theme: string;
    activeCardId: string;
    savedAt: string;
  };
  counts: {
    cards: number;
    chats: number;
    messages: number;
    promptRuns: number;
    lorebooks: number;
    lorebookEntries: number;
    generatedMaps: number;
  };
  provider: {
    mode: string;
    providerId: string;
    model: string;
    hasStoredSecretReference: boolean;
  };
  imageProvider: {
    mode: string;
    providerId: string;
    model: string;
  };
  statuses: {
    save: string;
    repository: string;
    providerKey: string;
    imageProvider: string;
  };
  settings: {
    textStreaming: boolean;
    banEmojis: boolean;
    promptDebugLogs: boolean;
  };
}

export function buildVersionedRuntimeExport(
  snapshot: RuntimeExportSnapshot,
  options: RuntimeExportOptions = {},
): RuntimeExportBundle {
  return {
    schema: "rpg.runtime.export",
    version: RUNTIME_EXPORT_SCHEMA_VERSION,
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    app: {
      name: "rpg",
      exportFormat: "runtime-bundle",
    },
    snapshot: sanitizeSnapshotForExport(snapshot),
  };
}

export function parseVersionedRuntimeExport(rawJson: string): RuntimeExportSnapshot {
  const payload = parseJsonRecord(rawJson, "Runtime export JSON is invalid.");
  if (payload.schema !== "rpg.runtime.export" || typeof payload.version !== "number") {
    throw new Error("Runtime export JSON is invalid.");
  }
  if (payload.version !== RUNTIME_EXPORT_SCHEMA_VERSION) {
    throw new Error(`Unsupported runtime export version ${payload.version}.`);
  }
  if (!isRecord(payload.snapshot)) {
    throw new Error("Runtime export JSON is invalid.");
  }

  const snapshot = payload.snapshot as Partial<RuntimeExportSnapshot>;
  if (
    snapshot.version !== 2 ||
    !Array.isArray(snapshot.cards) ||
    !Array.isArray(snapshot.messages) ||
    !Array.isArray(snapshot.promptRuns) ||
    typeof snapshot.activeCardId !== "string"
  ) {
    throw new Error("Runtime export JSON is invalid.");
  }

  return sanitizeSnapshotForExport(snapshot as RuntimeExportSnapshot);
}

export function buildRuntimeDiagnostics(input: RuntimeDiagnosticsInput): RuntimeDiagnostics {
  const providerSettings = getRecord(input.snapshot.providerSettings);
  const imageProviderSettings = getRecord(input.snapshot.imageProviderSettings);
  const runtimeSettings = sanitizePersistedRuntimeSettings(input.snapshot.runtimeSettings);
  const cards = Array.isArray(input.snapshot.cards) ? input.snapshot.cards : [];
  const chatSessions = Array.isArray(input.snapshot.chatSessions) ? input.snapshot.chatSessions : [];
  const messages = Array.isArray(input.snapshot.messages) ? input.snapshot.messages : [];
  const promptRuns = Array.isArray(input.snapshot.promptRuns) ? input.snapshot.promptRuns : [];
  const generatedMaps = Array.isArray(input.snapshot.generatedMaps) ? input.snapshot.generatedMaps : [];
  const lorebookStats = countLorebooks(cards);

  return {
    schema: "rpg.runtime.diagnostics",
    version: RUNTIME_DIAGNOSTICS_SCHEMA_VERSION,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    app: {
      name: "rpg",
    },
    runtime: {
      backend: input.runtimeBackend ?? "unknown",
      theme: typeof input.snapshot.theme === "string" ? input.snapshot.theme : "unknown",
      activeCardId: input.snapshot.activeCardId,
      savedAt: input.snapshot.savedAt,
    },
    counts: {
      cards: cards.length,
      chats: chatSessions.length,
      messages: messages.length,
      promptRuns: promptRuns.length,
      lorebooks: lorebookStats.lorebooks,
      lorebookEntries: lorebookStats.entries,
      generatedMaps: generatedMaps.length,
    },
    provider: {
      mode: getString(providerSettings.mode),
      providerId: getString(providerSettings.providerId),
      model: getString(providerSettings.model),
      hasStoredSecretReference: isRecord(providerSettings.secretReference),
    },
    imageProvider: {
      mode: getString(imageProviderSettings.mode),
      providerId: getString(imageProviderSettings.providerId),
      model: getString(imageProviderSettings.model),
    },
    statuses: {
      save: redactDiagnosticText(input.saveStatus),
      repository: redactDiagnosticText(input.repositoryStatus),
      providerKey: redactDiagnosticText(input.providerKeyStatus),
      imageProvider: redactDiagnosticText(input.imageProviderStatus),
    },
    settings: {
      textStreaming: runtimeSettings?.textStreaming === true,
      banEmojis: runtimeSettings?.banEmojis === true,
      promptDebugLogs: runtimeSettings?.promptDebugLogs === true,
    },
  };
}

function sanitizeSnapshotForExport(snapshot: RuntimeExportSnapshot): RuntimeExportSnapshot {
  const runtimeSettings = sanitizePersistedRuntimeSettings(snapshot.runtimeSettings);
  return {
    ...snapshot,
    version: 2,
    theme: snapshot.theme === "light" ? "light" : "dark",
    cards: Array.isArray(snapshot.cards) ? snapshot.cards : [],
    messages: Array.isArray(snapshot.messages) ? snapshot.messages : [],
    chatSessions: Array.isArray(snapshot.chatSessions) ? snapshot.chatSessions : undefined,
    activeChatIds: isRecord(snapshot.activeChatIds) ? (snapshot.activeChatIds as Record<string, string>) : undefined,
    promptRuns: sanitizePromptRunsForExport(Array.isArray(snapshot.promptRuns) ? snapshot.promptRuns : []),
    providerKeyStatus:
      typeof snapshot.providerKeyStatus === "string" ? redactDiagnosticText(snapshot.providerKeyStatus) : "Unknown.",
    providerSettings: sanitizePersistedProviderSettings(snapshot.providerSettings),
    imageProviderSettings: sanitizeImageProviderSettingsForExport(snapshot.imageProviderSettings),
    runtimeSettings,
    generatedMaps: sanitizeGeneratedMaps(snapshot.generatedMaps),
    savedAt: typeof snapshot.savedAt === "string" ? snapshot.savedAt : new Date().toISOString(),
  };
}

function countLorebooks(cards: Array<Record<string, unknown>>): { lorebooks: number; entries: number } {
  return cards.reduce<{ lorebooks: number; entries: number }>(
    (totals, card) => {
      const lorebooks = Array.isArray(card.lorebooks) ? card.lorebooks.filter(isRecord) : [];
      return {
        lorebooks: totals.lorebooks + lorebooks.length,
        entries:
          totals.entries +
          lorebooks.reduce((entryTotal, lorebook) => {
            const entries = Array.isArray(lorebook.entries) ? lorebook.entries : [];
            return entryTotal + entries.length;
          }, 0),
      };
    },
    { lorebooks: 0, entries: 0 },
  );
}

function sanitizeImageProviderSettingsForExport(value: unknown): Record<string, unknown> | undefined {
  const persisted = sanitizePersistedImageProviderSettings(value);
  if (!persisted) {
    return undefined;
  }

  const { workflowJson: _workflowJson, ...shareable } = persisted;
  return Object.keys(shareable).length > 0 ? shareable : undefined;
}

function redactDiagnosticText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed
    .replace(/(?:authorization|bearer|api[-_ ]?key|token|secret|password)\s*[:/=]?\s*[\w:.-]+/gi, "[redacted]")
    .replace(/(?:sk-[A-Za-z0-9_-]{6,}|[A-Za-z0-9_-]{24,})/g, "[redacted]")
    .replace(/[A-Za-z0-9_.-]+:apiKey/g, "[redacted]");
}

function parseJsonRecord(value: string, message: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (isRecord(parsed)) {
      return parsed;
    }
  } catch {
    // fall through to shared error
  }
  throw new Error(message);
}

function getRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function getString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
