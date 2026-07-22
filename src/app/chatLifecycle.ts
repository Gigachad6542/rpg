import { deriveCardForChat } from "./chatTurnState";
import { getCardChats, setChatArchived, upsertChatSession } from "./chatSessions";
import type {
  ChatSession,
  GeneratedMapArtifact,
  PromptRun,
  RuntimeCard,
} from "./runtimeTypes";

export interface DeleteActiveChatStateInput {
  activeCard: RuntimeCard;
  activeChat: ChatSession;
  cards: RuntimeCard[];
  chatSessions: ChatSession[];
  activeChatIds: Record<string, string>;
  promptRuns: PromptRun[];
  generatedMaps: GeneratedMapArtifact[];
  createFallbackChat: () => ChatSession;
}

export interface DeleteActiveChatStateResult {
  cards: RuntimeCard[];
  chatSessions: ChatSession[];
  activeChatIds: Record<string, string>;
  promptRuns: PromptRun[];
  generatedMaps: GeneratedMapArtifact[];
  fallbackChat: ChatSession;
}

/**
 * Applies one confirmed chat deletion across every persisted runtime surface.
 * Archived sibling chats are deliberately retained; only the selected chat and
 * artifacts directly scoped to it are removed.
 */
export function deleteActiveChatState({
  activeCard,
  activeChat,
  cards,
  chatSessions,
  activeChatIds,
  promptRuns,
  generatedMaps,
  createFallbackChat,
}: DeleteActiveChatStateInput): DeleteActiveChatStateResult {
  const remainingActiveChats = getCardChats(activeCard.id, chatSessions)
    .filter((chat) => chat.id !== activeChat.id);
  const fallbackChat = remainingActiveChats[0] ?? createFallbackChat();
  const shouldAppendFallback = remainingActiveChats.length === 0;
  const remainingChatSessions = chatSessions.filter((chat) => chat.id !== activeChat.id);
  const remainingChatIds = new Set(remainingChatSessions.map((chat) => chat.id));
  const referencedPromptRunIds = collectReferencedPromptRunIds(remainingChatSessions);

  return {
    cards: cards.map((card) =>
      card.id === activeCard.id ? deriveCardForChat(card, fallbackChat) : card,
    ),
    chatSessions: [
      ...remainingChatSessions,
      ...(shouldAppendFallback ? [fallbackChat] : []),
    ],
    activeChatIds: {
      ...activeChatIds,
      [activeCard.id]: fallbackChat.id,
    },
    // Branches intentionally reuse the source messages' prompt-run ids. Keep
    // shared diagnostics until no remaining chat references them.
    promptRuns: promptRuns.filter(
      (run) => remainingChatIds.has(run.chatId) || referencedPromptRunIds.has(run.id),
    ),
    generatedMaps: generatedMaps.filter((artifact) => artifact.chatId !== activeChat.id),
    fallbackChat,
  };
}

function collectReferencedPromptRunIds(chatSessions: ChatSession[]): Set<string> {
  const ids = new Set<string>();
  for (const chat of chatSessions) {
    for (const message of chat.messages) {
      if (message.promptRunId) {
        ids.add(message.promptRunId);
      }
      for (const runId of message.variantRunIds ?? []) {
        if (runId) {
          ids.add(runId);
        }
      }
    }
  }
  return ids;
}

interface ChatSelectionStateResult {
  cards: RuntimeCard[];
  chatSessions: ChatSession[];
  activeChatIds: Record<string, string>;
}

export interface ArchiveActiveChatStateInput {
  activeCard: RuntimeCard;
  activeChat: ChatSession;
  cards: RuntimeCard[];
  chatSessions: ChatSession[];
  activeChatIds: Record<string, string>;
  createFallbackChat: () => ChatSession;
}

export function archiveActiveChatState({
  activeCard,
  activeChat,
  cards,
  chatSessions,
  activeChatIds,
  createFallbackChat,
}: ArchiveActiveChatStateInput): ChatSelectionStateResult {
  const remainingActiveChats = getCardChats(activeCard.id, chatSessions)
    .filter((chat) => chat.id !== activeChat.id);
  const fallbackChat = remainingActiveChats[0] ?? createFallbackChat();
  const archivedSessions = chatSessions.map((chat) =>
    chat.id === activeChat.id ? setChatArchived(chat, true) : chat,
  );

  return {
    cards: cards.map((card) =>
      card.id === activeCard.id ? deriveCardForChat(card, fallbackChat) : card,
    ),
    chatSessions: remainingActiveChats.length > 0
      ? archivedSessions
      : upsertChatSession(archivedSessions, fallbackChat),
    activeChatIds: {
      ...activeChatIds,
      [activeCard.id]: fallbackChat.id,
    },
  };
}

export interface RestoreArchivedChatStateInput {
  activeCard: RuntimeCard;
  archivedChat: ChatSession;
  cards: RuntimeCard[];
  chatSessions: ChatSession[];
  activeChatIds: Record<string, string>;
}

export function restoreArchivedChatState({
  activeCard,
  archivedChat,
  cards,
  chatSessions,
  activeChatIds,
}: RestoreArchivedChatStateInput): ChatSelectionStateResult {
  const restoredChat = setChatArchived(archivedChat, false);
  return {
    cards: cards.map((card) =>
      card.id === activeCard.id ? deriveCardForChat(card, restoredChat) : card,
    ),
    chatSessions: upsertChatSession(chatSessions, restoredChat),
    activeChatIds: {
      ...activeChatIds,
      [activeCard.id]: restoredChat.id,
    },
  };
}
