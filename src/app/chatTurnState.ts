import {
  branchRuntimeTurnLineage,
  createRuntimeTurnLineage,
  deriveRuntimePreTurnCard,
  deriveRuntimeTurnCard,
  parseRuntimeTurnLineage,
  recordRuntimeTurnVariant,
  type RuntimeTurnEffects,
  type RuntimeTurnLineage,
} from "../runtime/runtimeTurnLineage";
import { pruneTurnLedger, recordTurnVariant } from "../runtime/turnLedger";
import { cloneMessagesForBranch, createChatSession } from "./chatSessions";
import type { ChatSession, RuntimeCard } from "./runtimeTypes";

export interface SwitchChatMessageVariantResult {
  chat: ChatSession;
  changed: boolean;
  reason?: string;
}

export interface RecordRegeneratedChatVariantInput {
  chat: ChatSession;
  card: RuntimeCard;
  retainedMessages: ChatSession["messages"];
  replacedAssistantMessageId: string;
  replacementAssistantMessageId: string;
  variantIndex: number;
  effects: RuntimeTurnEffects;
}

export function initializeChatTurnState(chat: ChatSession, card: RuntimeCard): ChatSession {
  return {
    ...chat,
    turnLineage: readChatTurnLineage(chat, card),
  };
}

/**
 * Manual state edits become a new synthetic root. Historical text remains,
 * but old variant controls fail closed because their deltas no longer describe
 * the manually revised state.
 */
export function rebaseChatTurnState(chat: ChatSession, card: RuntimeCard): ChatSession {
  return {
    ...chat,
    turnLineage: createRuntimeTurnLineage(card),
    updatedAt: new Date().toISOString(),
  };
}

export function deriveCardForChat(card: RuntimeCard, chat: ChatSession): RuntimeCard {
  return deriveRuntimeTurnCard(card, chat.messages, readChatTurnLineage(chat, card));
}

export function deriveCardForRegeneration(
  card: RuntimeCard,
  chat: ChatSession,
  assistantMessageId: string,
): RuntimeCard {
  return deriveRuntimePreTurnCard(
    card,
    chat.messages,
    readChatTurnLineage(chat, card),
    assistantMessageId,
  );
}

export function recordChatTurnVariant(
  chat: ChatSession,
  card: RuntimeCard,
  assistantMessageId: string,
  variantIndex: number,
  effects: RuntimeTurnEffects,
): ChatSession {
  return {
    ...chat,
    turnLineage: recordRuntimeTurnVariant(
      readChatTurnLineage(chat, card),
      assistantMessageId,
      variantIndex,
      effects,
    ),
  };
}

export function recordRegeneratedChatVariant(input: RecordRegeneratedChatVariantInput): ChatSession {
  const sourceLineage = readChatTurnLineage(input.chat, input.card);
  const retainedIds = new Set(input.retainedMessages.map((message) => message.id));
  let ledger = pruneTurnLedger(sourceLineage.ledger, retainedIds);
  const replacedCommit = sourceLineage.ledger[input.replacedAssistantMessageId];
  if (replacedCommit) {
    for (const variant of replacedCommit.variants) {
      ledger = recordTurnVariant(
        ledger,
        input.replacementAssistantMessageId,
        variant.variantIndex,
        variant.effects,
      );
    }
  }
  const lineage: RuntimeTurnLineage = {
    baseState: sourceLineage.baseState,
    ledger,
  };
  return {
    ...input.chat,
    turnLineage: recordRuntimeTurnVariant(
      lineage,
      input.replacementAssistantMessageId,
      input.variantIndex,
      input.effects,
    ),
  };
}

export function branchChatTurnState(
  parent: ChatSession,
  branch: ChatSession,
  card: RuntimeCard,
): ChatSession {
  return {
    ...branch,
    turnLineage: branchRuntimeTurnLineage(
      readChatTurnLineage(parent, card),
      parent.messages,
      branch.messages,
    ),
  };
}

/**
 * Editing a past message always creates a branch so the original causal chain
 * remains recoverable. Descendants are removed. If generated assistant text is
 * edited, its old effects and variant controls are removed as well because the
 * custom text no longer proves the model-generated delta.
 */
export function forkChatForMessageEdit(
  parent: ChatSession,
  card: RuntimeCard,
  messageId: string,
  content: string,
  branchId: string,
): ChatSession | null {
  const targetIndex = parent.messages.findIndex((message) => message.id === messageId);
  const trimmed = content.trim();
  if (targetIndex < 0 || !trimmed) {
    return null;
  }

  const sourceMessages = parent.messages.slice(0, targetIndex + 1);
  const clonedMessages = cloneMessagesForBranch(sourceMessages, branchId);
  const target = sourceMessages[targetIndex];
  const clonedTargetId = clonedMessages[targetIndex].id;
  const editedMessages = clonedMessages.map((message) => {
    if (message.id !== clonedTargetId) {
      return message;
    }
    if (target.role === "assistant") {
      const { variants: _variants, activeVariantIndex: _activeVariantIndex, ...withoutVariants } = message;
      return { ...withoutVariants, content: trimmed };
    }
    return { ...message, content: trimmed };
  });
  const branchDraft = createChatSession(card.id, `${parent.title || card.name} branch`, {
    id: branchId,
    branchOfId: parent.id,
    branchedFromMessageId: messageId,
    messages: editedMessages,
  });
  const branch = branchChatTurnState(parent, branchDraft, card);
  const keepIds = branch.messages
    .filter((message) => message.role === "assistant" && message.id !== (target.role === "assistant" ? clonedTargetId : ""))
    .map((message) => message.id);
  const lineage = readChatTurnLineage(branch, card);
  return {
    ...branch,
    turnLineage: {
      baseState: lineage.baseState,
      ledger: pruneTurnLedger(lineage.ledger, keepIds),
    },
  };
}

/**
 * A previous assistant variant may be selected only when no later assistant
 * turn depends on it. Earlier selection needs an explicit fork/replay flow;
 * refusing here prevents visible history and state from silently diverging.
 */
export function switchChatMessageVariant(
  chat: ChatSession,
  card: RuntimeCard,
  messageId: string,
  direction: -1 | 1,
): SwitchChatMessageVariantResult {
  const messageIndex = chat.messages.findIndex((message) => message.id === messageId);
  if (messageIndex < 0) {
    return { chat, changed: false, reason: "That message is no longer available." };
  }
  const message = chat.messages[messageIndex];
  if (!message.variants || message.variants.length < 2) {
    return { chat, changed: false, reason: "That response has no alternate variants." };
  }
  const lineage = readChatTurnLineage(chat, card);
  const commit = lineage.ledger[messageId];
  if (!commit || !message.variants.every((_, index) => commit.variants.some((variant) => variant.variantIndex === index))) {
    return {
      chat,
      changed: false,
      reason: "State history is unavailable for one or more variants, so switching would be unsafe.",
    };
  }
  if (chat.messages.slice(messageIndex + 1).some((candidate) => candidate.role === "assistant")) {
    return {
      chat,
      changed: false,
      reason: "Cannot switch an earlier response while dependent downstream turns remain. Branch or regenerate from that point first.",
    };
  }

  const currentIndex = message.activeVariantIndex ?? message.variants.length - 1;
  const nextIndex = (currentIndex + direction + message.variants.length) % message.variants.length;
  return {
    changed: true,
    chat: {
      ...chat,
      messages: chat.messages.map((candidate) =>
        candidate.id === messageId
          ? { ...candidate, content: message.variants?.[nextIndex] ?? candidate.content, activeVariantIndex: nextIndex }
          : candidate,
      ),
      updatedAt: new Date().toISOString(),
    },
  };
}

function readChatTurnLineage(chat: ChatSession, card: RuntimeCard): RuntimeTurnLineage {
  return parseRuntimeTurnLineage(chat.turnLineage, card);
}
