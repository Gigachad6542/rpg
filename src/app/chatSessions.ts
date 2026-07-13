// Chat session, message, and startup-hydration helpers extracted from App.tsx.
import type { ChatSession, Message, PromptRun, RuntimeCard } from "./runtimeTypes";
import type { LocalRuntimeSnapshot } from "./localRuntimeStore";
import { isRecord } from "./appUtils";
import { createRuntimeTurnLineage, parseRuntimeTurnLineage } from "../runtime/runtimeTurnLineage";
import { parseAuthoritativeEventStream } from "../runtime/authoritativeEventStream";
import {
  advanceRollingSummary,
  MAX_ROLLING_SUMMARY_CHARACTERS,
  parseRollingSummary,
  reconcileRollingSummaryForHistory,
} from "../runtime/rollingSummary";

export function parseChatSessions(
  value: unknown,
  cards: RuntimeCard[],
  flatMessages: Message[],
  activeCardId: string,
): ChatSession[] {
  const cardIds = new Set(cards.map((card) => card.id));
  const parsed = Array.isArray(value)
    ? value
        .filter(isRecord)
        .map((session): ChatSession | null => {
          const cardId = typeof session.cardId === "string" && cardIds.has(session.cardId) ? session.cardId : null;
          if (!cardId || typeof session.id !== "string" || !session.id.trim()) {
            return null;
          }
          const card = cards.find((candidate) => candidate.id === cardId);
          if (!card) {
            return null;
          }
          const messages = sanitizeMessages(session.messages);
          const parsedRollingSummary = parseRollingSummary(session.rollingSummary);
          const rollingSummary = reconcileRollingSummaryForHistory(
            parsedRollingSummary,
            messages,
            { cardId, chatId: session.id, branchId: session.id },
          ) ?? undefined;
          return {
            id: session.id,
            cardId,
            title: typeof session.title === "string" && session.title.trim() ? session.title : deriveChatTitle(messages[0]?.content),
            branchOfId: typeof session.branchOfId === "string" ? session.branchOfId : undefined,
            branchedFromMessageId:
              typeof session.branchedFromMessageId === "string" ? session.branchedFromMessageId : undefined,
            createdAt: typeof session.createdAt === "string" ? session.createdAt : new Date().toISOString(),
            updatedAt: typeof session.updatedAt === "string" ? session.updatedAt : new Date().toISOString(),
            messages,
            turnLineage: parseRuntimeTurnLineage(
              session.turnLineage,
              card,
              { level: "branch", chatId: session.id, branchId: session.id },
            ),
            authoritativeEvents: parseAuthoritativeEventStream(session.authoritativeEvents),
            rollingSummary,
          };
        })
        .filter((session): session is ChatSession => Boolean(session))
    : [];

  const sessions = [...parsed];
  const migratedMessages = sanitizeMessages(flatMessages);
  for (const card of cards) {
    if (sessions.some((session) => session.cardId === card.id)) {
      continue;
    }
    sessions.push(
      createChatSession(card.id, `${card.name} chat`, {
        messages: card.id === activeCardId ? migratedMessages : [],
        turnLineage: createRuntimeTurnLineage(card),
      }),
    );
  }

  return sessions;
}

export function getStartupActiveCardId(
  snapshot: LocalRuntimeSnapshot<RuntimeCard, Message, PromptRun, ChatSession> | null,
  cards: RuntimeCard[],
): string {
  if (!snapshot || !cards.some((card) => card.id === snapshot.activeCardId)) {
    return "";
  }
  return snapshot.activeCardId === "card_blank_slate_rpg" ? "" : snapshot.activeCardId;
}

export function parseActiveChatIds(
  value: unknown,
  cards: RuntimeCard[],
  chatSessions: ChatSession[],
  activeCardId: string,
): Record<string, string> {
  const parsed = isRecord(value) ? value : {};
  const activeIds: Record<string, string> = {};
  for (const card of cards) {
    const stored = typeof parsed[card.id] === "string" ? parsed[card.id] : "";
    const storedSession = chatSessions.find((session) => session.id === stored && session.cardId === card.id);
    const fallback = getCardChats(card.id, chatSessions)[0];
    if (storedSession || fallback) {
      activeIds[card.id] = storedSession?.id ?? fallback.id;
    }
  }
  if (!activeIds[activeCardId]) {
    const fallback = getCardChats(activeCardId, chatSessions)[0];
    if (fallback) {
      activeIds[activeCardId] = fallback.id;
    }
  }
  return activeIds;
}

export function sanitizeMessages(value: unknown): Message[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isRecord)
    .map((message): Message | null => {
      if (
        typeof message.id !== "string" ||
        typeof message.content !== "string" ||
        (message.role !== "user" && message.role !== "assistant")
      ) {
        return null;
      }
      const variants =
        Array.isArray(message.variants) && message.variants.every((variant) => typeof variant === "string")
          ? (message.variants as string[])
          : undefined;
      const activeVariantIndex =
        variants && typeof message.activeVariantIndex === "number"
          ? Math.min(Math.max(Math.trunc(message.activeVariantIndex), 0), variants.length - 1)
          : undefined;
      const variantRunIds = Array.isArray(message.variantRunIds)
        ? message.variantRunIds.filter((value): value is string => typeof value === "string")
        : undefined;
      const undoneVariantIndices = Array.isArray(message.undoneVariantIndices)
        ? message.undoneVariantIndices
            .filter((value): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0)
        : undefined;
      return {
        id: message.id,
        role: message.role,
        content: message.content,
        ...(variants && variants.length > 1 ? { variants, activeVariantIndex } : {}),
        ...(typeof message.promptRunId === "string" ? { promptRunId: message.promptRunId } : {}),
        ...(variantRunIds && variantRunIds.length > 0 ? { variantRunIds } : {}),
        ...(undoneVariantIndices && undoneVariantIndices.length > 0 ? { undoneVariantIndices } : {}),
      };
    })
    .filter((message): message is Message => Boolean(message));
}

export function createChatSession(
  cardId: string,
  title: string,
  options: Partial<Pick<
    ChatSession,
    "id" | "branchOfId" | "branchedFromMessageId" | "messages" | "turnLineage" | "authoritativeEvents" | "rollingSummary"
  >> = {},
): ChatSession {
  const now = new Date().toISOString();
  const id = options.id ?? createRuntimeEntityId("chat");
  const messages = sanitizeMessages(options.messages ?? []);
  const parsedRollingSummary = parseRollingSummary(options.rollingSummary);
  const rollingSummary = reconcileRollingSummaryForHistory(
    parsedRollingSummary,
    messages,
    { cardId, chatId: id, branchId: id },
  ) ?? undefined;
  return {
    id,
    cardId,
    title: title.trim() || deriveChatTitle(messages[0]?.content),
    branchOfId: options.branchOfId,
    branchedFromMessageId: options.branchedFromMessageId,
    createdAt: now,
    updatedAt: now,
    messages,
    ...(options.turnLineage ? { turnLineage: options.turnLineage } : {}),
    ...(options.authoritativeEvents ? { authoritativeEvents: parseAuthoritativeEventStream(options.authoritativeEvents) } : {}),
    ...(rollingSummary ? { rollingSummary } : {}),
  };
}

export function advanceChatSessionRollingSummary(
  chat: Pick<ChatSession, "id" | "cardId" | "rollingSummary">,
  messages: Message[],
  now: string,
): ChatSession["rollingSummary"] {
  return advanceRollingSummary({
    previous: chat.rollingSummary ?? null,
    messages,
    scope: { cardId: chat.cardId, chatId: chat.id, branchId: chat.id },
    retainRecentMessages: 12,
    maxCharacters: MAX_ROLLING_SUMMARY_CHARACTERS,
    now,
  }) ?? undefined;
}

export function cloneMessagesForBranch(messages: Message[], branchId: string): Message[] {
  return messages.map((message, index) => ({
    ...message,
    id: `${message.id}__branch_${branchId}_${index}`,
  }));
}

export function filterPersistedOpeningMessages(messages: Message[]): Message[] {
  return messages.filter((message) => !isPersistedOpeningMessage(message));
}

export function isPersistedOpeningMessage(message: Message): boolean {
  return message.role === "assistant" && message.id.startsWith("assistant-greeting-");
}

export function createRuntimeEntityId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${random.replace(/[^A-Za-z0-9_-]/g, "")}`;
}

export function getCardChats(cardId: string, chatSessions: ChatSession[]): ChatSession[] {
  return chatSessions
    .filter((chat) => chat.cardId === cardId)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function getActiveChatForCard(
  cardId: string,
  chatSessions: ChatSession[],
  activeChatIds: Record<string, string>,
): ChatSession | undefined {
  const activeId = activeChatIds[cardId];
  return (
    chatSessions.find((chat) => chat.id === activeId && chat.cardId === cardId) ??
    getCardChats(cardId, chatSessions)[0]
  );
}

export function upsertChatSession(current: ChatSession[], next: ChatSession): ChatSession[] {
  const found = current.some((chat) => chat.id === next.id);
  return found ? current.map((chat) => (chat.id === next.id ? next : chat)) : [...current, next];
}

export function deriveChatTitle(value?: string): string {
  const cleaned = value?.trim();
  if (!cleaned) {
    return "New chat";
  }
  return cleaned.length > 48 ? `${cleaned.slice(0, 45)}...` : cleaned;
}

export function buildWriteForMeDraft(card: RuntimeCard, messages: Message[]): string {
  const lastResponse = [...messages].reverse().find((message) => message.role === "assistant")?.content;
  if (card.kind === "rpg" && card.rpg) {
    const location = card.rpg.location || "the current area";
    const inventory = card.rpg.inventory.length > 0 ? ` using ${card.rpg.inventory[0]}` : "";
    return lastResponse
      ? `I study what just happened and take a careful next step in ${location}${inventory}.`
      : `I look around ${location}, checking for exits, threats, useful details, and anything my character can realistically do.`;
  }

  return lastResponse
    ? "I respond in a way that fits the relationship, the scenario, and what was just said."
    : "I start the conversation naturally, staying within this card's scenario and boundaries.";
}
