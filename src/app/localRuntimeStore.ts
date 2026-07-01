import { parseSecretReference } from "../security/keyStorage";

export const RUNTIME_STORAGE_KEY = "local-cards-runtime:v2";

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
  return {
    ...snapshot,
    chatSessions: Array.isArray(snapshot.chatSessions) ? snapshot.chatSessions : undefined,
    activeChatIds: sanitizeStringRecord(snapshot.activeChatIds),
    providerSettings: sanitizePersistedProviderSettings(snapshot.providerSettings),
    imageProviderSettings: sanitizePersistedImageProviderSettings(snapshot.imageProviderSettings),
    runtimeSettings: sanitizePersistedRuntimeSettings(snapshot.runtimeSettings),
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
    promptRuns: snapshot.promptRuns.slice(-100),
    generatedMaps: sanitizeGeneratedMaps(snapshot.generatedMaps).slice(-5),
  };
}

function compactChatSessions<ChatSession>(chatSessions: ChatSession[] | undefined): ChatSession[] | undefined {
  if (!Array.isArray(chatSessions)) {
    return undefined;
  }

  return chatSessions.map((session) => {
    if (!isRecord(session) || !Array.isArray(session.messages)) {
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
  for (const key of ["mode", "providerId", "displayName", "endpoint", "model", "workflowJson", "samplerName", "scheduler"]) {
    const field = value[key];
    if (typeof field === "string") {
      sanitized[key] = field;
    }
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
    .slice(-20);
}

export function sanitizePersistedRuntimeSettings(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const sanitized: Record<string, unknown> = {};
  for (const key of ["textStreaming", "banEmojis", "promptDebugLogs"]) {
    const field = value[key];
    if (typeof field === "boolean") {
      sanitized[key] = field;
    }
  }
  if (typeof value.impersonationPrompt === "string") {
    sanitized.impersonationPrompt = value.impersonationPrompt;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
