import { deriveCardForChat } from "./chatTurnState";
import { getCardChats } from "./chatSessions";
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

  return {
    cards: cards.map((card) =>
      card.id === activeCard.id ? deriveCardForChat(card, fallbackChat) : card,
    ),
    chatSessions: [
      ...chatSessions.filter((chat) => chat.id !== activeChat.id),
      ...(shouldAppendFallback ? [fallbackChat] : []),
    ],
    activeChatIds: {
      ...activeChatIds,
      [activeCard.id]: fallbackChat.id,
    },
    promptRuns: promptRuns.filter((run) => run.chatId !== activeChat.id),
    generatedMaps: generatedMaps.filter((artifact) => artifact.chatId !== activeChat.id),
    fallbackChat,
  };
}
