import { parseSecretReference } from "../security/keyStorage";
import { sanitizePersistedPersonas } from "./personas";

export const RUNTIME_STORAGE_KEY = "local-cards-runtime:v2";
const MAX_GENERATED_MEDIA_ARTIFACTS = 80;
const COMPACT_GENERATED_MEDIA_ARTIFACTS = 20;

export type PersistedTheme = "light" | "dark";

export interface LocalRuntimeSnapshot<Card, Message, PromptRun, ChatSession = unknown> {
  version: 2;
  theme: PersistedTheme;
  activeCardId: string;
  cards: Card[];
  messages: Message[];
  chatSessions?: ChatSession[];
  activeChatIds?: Record<string, string>;
  promptRuns: PromptRun[];
  providerKeyStatus: string;
  providerSettings?: Record<string, unknown>;
  imageProviderSettings?: Record<string, unknown>;
  runtimeSettings?: Record<string, unknown>;
  personas?: unknown[];
  activePersonaId?: string;
  generatedMaps?: unknown[];
  savedAt: string;
}

export function loadLocalRuntimeSnapshot<Card, Message, PromptRun, ChatSession = unknown>():
  | LocalRuntimeSnapshot<Card, Message, PromptRun, ChatSession>
  | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(RUNTIME_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<LocalRuntimeSnapshot<Card, Message, PromptRun, ChatSession>>;
    if (
      parsed.version !== 2 ||
      !Array.isArray(parsed.cards) ||
      parsed.cards.length === 0 ||
      !Array.isArray(parsed.messages) ||
      !Array.isArray(parsed.promptRuns) ||
      typeof parsed.activeCardId !== "string"
    ) {
      return null;
    }

    return {
      version: 2,
      theme: parsed.theme === "light" ? "light" : "dark",
      activeCardId: parsed.activeCardId,
      cards: parsed.cards,
      messages: parsed.messages,
      chatSessions: Array.isArray(parsed.chatSessions) ? (parsed.chatSessions as ChatSession[]) : undefined,
      activeChatIds: sanitizeStringRecord(parsed.activeChatIds),
      promptRuns: parsed.promptRuns,
      providerKeyStatus:
        typeof parsed.providerKeyStatus === "string"
          ? parsed.providerKeyStatus
          : "No plaintext keys stored.",
      providerSettings: sanitizePersistedProviderSettings(parsed.providerSettings),
      imageProviderSettings: sanitizePersistedImageProviderSettings(parsed.imageProviderSettings),
      runtimeSettings: sanitizePersistedRuntimeSettings(parsed.runtimeSettings),
      personas: sanitizePersistedPersonas(parsed.personas),
      activePersonaId: typeof parsed.activePersonaId === "string" ? parsed.activePersonaId : undefined,
      generatedMaps: sanitizeGeneratedMaps(parsed.generatedMaps),
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function saveLocalRuntimeSnapshot<Card, Message, PromptRun, ChatSession = unknown>(
  snapshot: LocalRuntimeSnapshot<Card, Message, PromptRun, ChatSession>,
): void {
  if (typeof window === "undefined") {
    return;
  }

  const persisted = toPersistedLocalRuntimeSnapshot(snapshot);
  try {
    window.localStorage.setItem(RUNTIME_STORAGE_KEY, JSON.stringify(persisted));
  } catch (error) {
    if (!isQuotaExceededError(error)) {
      throw error;
    }

    try {
      window.localStorage.setItem(RUNTIME_STORAGE_KEY, JSON.stringify(compactLocalRuntimeSnapshot(persisted)));
    } catch (retryError) {
      if (!isQuotaExceededError(retryError)) {
        throw retryError;
      }
    }
  }
}

function toPersistedLocalRuntimeSnapshot<Card, Message, PromptRun, ChatSession>(
  snapshot: LocalRuntimeSnapshot<Card, Message, PromptRun, ChatSession>,
): LocalRuntimeSnapshot<Card, Message, PromptRun, ChatSession> {
  const runtimeSettings = sanitizePersistedRuntimeSettings(snapshot.runtimeSettings);
  return {
    ...snapshot,
    chatSessions: Array.isArray(snapshot.chatSessions) ? snapshot.chatSessions : undefined,
    activeChatIds: sanitizeStringRecord(snapshot.activeChatIds),
    promptRuns: sanitizePromptRunsForPersistence(snapshot.promptRuns, runtimeSettings),
    providerSettings: sanitizePersistedProviderSettings(snapshot.providerSettings),
    imageProviderSettings: sanitizePersistedImageProviderSettings(snapshot.imageProviderSettings),
    runtimeSettings,
    personas: sanitizePersistedPersonas(snapshot.personas),
    activePersonaId: typeof snapshot.activePersonaId === "string" ? snapshot.activePersonaId : undefined,
    generatedMaps: sanitizeGeneratedMaps(snapshot.generatedMaps),
  };
}

function compactLocalRuntimeSnapshot<Card, Message, PromptRun, ChatSession>(
  snapshot: LocalRuntimeSnapshot<Card, Message, PromptRun, ChatSession>,
): LocalRuntimeSnapshot<Card, Message, PromptRun, ChatSession> {
  return {
    ...snapshot,
    messages: snapshot.messages.slice(-100),
    chatSessions: compactChatSessions(snapshot.chatSessions),
    promptRuns: sanitizePromptRunsForPersistence(snapshot.promptRuns, snapshot.runtimeSettings).slice(-100),
    generatedMaps: sanitizeGeneratedMaps(snapshot.generatedMaps).slice(-COMPACT_GENERATED_MEDIA_ARTIFACTS),
  };
}

export function sanitizePromptRunsForPersistence<PromptRun>(promptRuns: PromptRun[], runtimeSettings: unknown): PromptRun[] {
  if (shouldPersistPromptDebugLogs(runtimeSettings)) {
    return promptRuns;
  }

  return stripCompiledPrompts(promptRuns);
}

export function sanitizePromptRunsForExport<PromptRun>(promptRuns: PromptRun[]): PromptRun[] {
  return stripCompiledPrompts(promptRuns);
}

function stripCompiledPrompts<PromptRun>(promptRuns: PromptRun[]): PromptRun[] {
  let changed = false;
  const sanitized = promptRuns.map((run) => {
    if (!isRecord(run) || typeof run.compiledPrompt !== "string" || !run.compiledPrompt) {
      return run;
    }

    changed = true;
    return {
      ...run,
      compiledPrompt: "",
    } as PromptRun;
  });

  return changed ? sanitized : promptRuns;
}

function shouldPersistPromptDebugLogs(runtimeSettings: unknown): boolean {
  return isRecord(runtimeSettings) && runtimeSettings.promptDebugLogs === true;
}

function compactChatSessions<ChatSession>(chatSessions: ChatSession[] | undefined): ChatSession[] | undefined {
  if (!Array.isArray(chatSessions)) {
    return undefined;
  }

  return chatSessions.map((session) => {
    if (!isRecord(session) || !Array.isArray(session.messages)) {
      return session;
    }
    // A lineage root and its message chain are one consistency unit. Slicing
    // messages without folding the removed commits into a new base would make
    // the restored card lose historical effects, so fail size compaction closed
    // for these sessions until a lineage-aware rebase compactor exists.
    if (isRecord(session.turnLineage)) {
      return session;
    }
    return {
      ...session,
      messages: session.messages.slice(-50),
    } as ChatSession;
  });
}

function isQuotaExceededError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED")
  );
}

export function sanitizePersistedProviderSettings(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const sanitized: Record<string, unknown> = {};
  for (const key of ["mode", "providerId", "displayName", "baseUrl", "model"]) {
    const field = value[key];
    if (typeof field === "string") {
      sanitized[key] = field;
    }
  }

  const reference = value.secretReference;
  const secretReference = parseSecretReference(reference);
  if (secretReference) {
    sanitized.secretReference = secretReference;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

export function sanitizePersistedImageProviderSettings(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const sanitized: Record<string, unknown> = {};
  for (const key of ["mode", "providerId", "displayName", "endpoint", "model", "samplerName", "scheduler"]) {
    const field = value[key];
    if (typeof field === "string") {
      sanitized[key] = field;
    }
  }
  if (typeof value.workflowJson === "string" && !containsSensitiveWorkflowContent(value.workflowJson)) {
    sanitized.workflowJson = value.workflowJson;
  }
  for (const key of ["width", "height", "seed", "steps", "cfg", "pollTimeoutMs"]) {
    const field = value[key];
    if (typeof field === "number" && Number.isFinite(field)) {
      sanitized[key] = field;
    }
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

export function sanitizeGeneratedMaps(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isRecord)
    .map((artifact) => {
      const sanitized: Record<string, unknown> = {};
      for (const key of [
        "id",
        "imageKind",
        "cardId",
        "chatId",
        "subjectId",
        "subjectName",
        "prompt",
        "negativePrompt",
        "provider",
        "model",
        "status",
        "imageUrl",
        "error",
        "userInput",
        "createdAt",
      ]) {
        const field = artifact[key];
        if (typeof field === "string") {
          sanitized[key] = field;
        }
      }
      return sanitized;
    })
    .filter((artifact) => Object.keys(artifact).length > 0)
    .slice(-MAX_GENERATED_MEDIA_ARTIFACTS);
}

export function sanitizePersistedRuntimeSettings(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const sanitized: Record<string, unknown> = {};
  for (const key of ["textStreaming", "banEmojis", "promptDebugLogs", "diceRollsEnabled", "onboardingCompleted"]) {
    const field = value[key];
    if (typeof field === "boolean") {
      sanitized[key] = field;
    }
  }
  if (typeof value.accentColor === "string" && /^#[0-9a-fA-F]{6}$/.test(value.accentColor)) {
    sanitized.accentColor = value.accentColor;
  }
  // Legacy carrier: pre-persona snapshots stored the impersonation prompt here.
  // parsePersonas() migrates it into a default persona, after which it stops
  // being written and drains out of the stored snapshot on the next save.
  if (typeof value.impersonationPrompt === "string") {
    sanitized.impersonationPrompt = value.impersonationPrompt;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsSensitiveWorkflowContent(value: string): boolean {
  if (containsRawSecretLikeToken(value)) {
    return true;
  }

  try {
    return workflowValueContainsSecretishContent(JSON.parse(value) as unknown);
  } catch {
    return containsSecretishJsonKey(value);
  }
}

function workflowValueContainsSecretishContent(value: unknown): boolean {
  if (typeof value === "string") {
    return containsRawSecretLikeToken(value);
  }
  if (Array.isArray(value)) {
    return value.some(workflowValueContainsSecretishContent);
  }
  if (!isRecord(value)) {
    return false;
  }

  return Object.entries(value).some(
    ([key, field]) => isSecretishWorkflowKey(key) || workflowValueContainsSecretishContent(field),
  );
}

function isSecretishWorkflowKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    normalized.includes("apikey") ||
    normalized.includes("token") ||
    normalized.includes("secret") ||
    normalized.includes("password") ||
    normalized.includes("authorization") ||
    normalized.includes("bearer") ||
    ((normalized.includes("auth") || normalized.includes("access")) && normalized.includes("key"))
  );
}

function containsSecretishJsonKey(value: string): boolean {
  return /"(?:[^"\\]|\\.)*(?:api[-_ ]?key|token|secret|password|authorization|bearer)(?:[^"\\]|\\.)*"\s*:/i.test(value);
}

function containsRawSecretLikeToken(value: string): boolean {
  return /(?:sk-[A-Za-z0-9_-]{6,}|[A-Za-z0-9_-]{40,})/.test(value);
}

function sanitizeStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const sanitized: Record<string, string> = {};
  for (const [key, field] of Object.entries(value)) {
    if (typeof field === "string") {
      sanitized[key] = field;
    }
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}
