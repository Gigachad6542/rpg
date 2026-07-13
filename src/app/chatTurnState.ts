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
import {
  appendAuthoritativeEvent,
  branchAuthoritativeEventStream,
  parseAuthoritativeEventStream,
  replayAuthoritativeEvents,
  replayAuthoritativeRpgState,
  type AuthoritativeRpgState,
  type AuthoritativeEventStream,
} from "../runtime/authoritativeEventStream";
import { branchRollingSummary } from "../runtime/rollingSummary";

export interface SwitchChatMessageVariantResult {
  chat: ChatSession;
  changed: boolean;
  reason?: string;
}

export type ChatTurnMutationResult = SwitchChatMessageVariantResult;

export interface ChatAuthoritativeContinuityVerification {
  status: "unavailable" | "verified" | "mismatch";
  reconstructedRpg?: AuthoritativeRpgState;
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
    authoritativeEvents: parseAuthoritativeEventStream(
      (chat.authoritativeEvents ?? []).filter((event) => event.kind !== "state_committed"),
    ),
    rollingSummary: undefined,
    updatedAt: new Date().toISOString(),
  };
}

export function deriveCardForChat(card: RuntimeCard, chat: ChatSession): RuntimeCard {
  const derived = deriveRuntimeTurnCard(card, chat.messages, readChatTurnLineage(chat, card));
  const verification = verifyChatAuthoritativeContinuity(card, chat, derived);
  if (verification.status !== "verified" || !verification.reconstructedRpg || !derived.rpg) {
    return derived;
  }
  return {
    ...derived,
    rpg: {
      ...derived.rpg,
      ...verification.reconstructedRpg,
      inventory: [...verification.reconstructedRpg.inventory],
      quests: [...verification.reconstructedRpg.quests],
      flags: { ...verification.reconstructedRpg.flags },
      knownPlaces: [...verification.reconstructedRpg.knownPlaces],
    },
  };
}

export function verifyChatAuthoritativeContinuity(
  card: RuntimeCard,
  chat: ChatSession,
  derivedCard?: RuntimeCard,
): ChatAuthoritativeContinuityVerification {
  const lineage = readChatTurnLineage(chat, card);
  if (!lineage.baseState.rpg || !card.rpg) {
    return { status: "unavailable" };
  }
  const expectedVariants = new Set<string>();
  for (const message of chat.messages) {
    if (message.role !== "assistant" || message.undoneVariantIndices?.includes(message.activeVariantIndex ?? -1)) {
      continue;
    }
    const commit = lineage.ledger[message.id];
    if (!commit || commit.variants.length === 0) {
      continue;
    }
    const activeVariantIndex = message.activeVariantIndex ?? commit.variants[commit.variants.length - 1].variantIndex;
    if (commit.variants.some((variant) => variant.variantIndex === activeVariantIndex)) {
      expectedVariants.add(`${message.id}\u0000${activeVariantIndex}`);
    }
  }
  if (expectedVariants.size === 0) {
    return { status: "unavailable" };
  }
  const replayInput = { chatId: chat.id, branchId: chat.id, messages: chat.messages };
  const stateEvents = replayAuthoritativeEvents(chat.authoritativeEvents ?? [], replayInput)
    .filter((event) => event.kind === "state_committed");
  const recordedVariants = new Set(
    stateEvents.map((event) => `${event.variant.assistantMessageId}\u0000${event.variant.variantIndex}`),
  );
  if ([...expectedVariants].some((key) => !recordedVariants.has(key))) {
    return { status: "unavailable" };
  }
  const reconstructedRpg = replayAuthoritativeRpgState(lineage.baseState.rpg, chat.authoritativeEvents ?? [], replayInput);
  const expectedRpg = (derivedCard ?? deriveRuntimeTurnCard(card, chat.messages, lineage)).rpg;
  if (!expectedRpg || !sameAuthoritativeRpgState(reconstructedRpg, expectedRpg)) {
    return { status: "mismatch", reconstructedRpg };
  }
  return { status: "verified", reconstructedRpg };
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
    authoritativeEvents: remapRegeneratedAuthoritativeEvents(
      input.chat.authoritativeEvents ?? [],
      input.replacedAssistantMessageId,
      input.replacementAssistantMessageId,
    ),
    turnLineage: recordRuntimeTurnVariant(
      lineage,
      input.replacementAssistantMessageId,
      input.variantIndex,
      input.effects,
    ),
  };
}

function remapRegeneratedAuthoritativeEvents(
  stream: AuthoritativeEventStream,
  replacedAssistantMessageId: string,
  replacementAssistantMessageId: string,
): AuthoritativeEventStream {
  let result = stream;
  let copiedIndex = 0;
  for (const event of stream) {
    if (
      event.messageId !== replacedAssistantMessageId &&
      event.variant?.assistantMessageId !== replacedAssistantMessageId
    ) {
      continue;
    }
    const rawCopy = {
      ...event,
      id: `${event.id.slice(0, 150)}__regen_${copiedIndex}`.slice(0, 256),
      originEventId: event.id,
      messageId: event.messageId === replacedAssistantMessageId
        ? replacementAssistantMessageId
        : event.messageId,
      ...(event.variant
        ? {
            variant: {
              ...event.variant,
              assistantMessageId: event.variant.assistantMessageId === replacedAssistantMessageId
                ? replacementAssistantMessageId
                : event.variant.assistantMessageId,
            },
          }
        : {}),
    };
    const [copy] = parseAuthoritativeEventStream([rawCopy]);
    if (copy) {
      result = appendAuthoritativeEvent(result, copy);
      copiedIndex += 1;
    }
  }
  return result;
}

export function branchChatTurnState(
  parent: ChatSession,
  branch: ChatSession,
  card: RuntimeCard,
): ChatSession {
  const messageIdMap = new Map<string, string>();
  for (let index = 0; index < Math.min(parent.messages.length, branch.messages.length); index += 1) {
    messageIdMap.set(parent.messages[index].id, branch.messages[index].id);
  }
  const authoritativeEvents = branchAuthoritativeEventStream(parent.authoritativeEvents ?? [], {
    sourceChatId: parent.id,
    sourceBranchId: parent.id,
    targetChatId: branch.id,
    targetBranchId: branch.id,
    messageIdMap,
    createEventId: (event, index) =>
      `${event.id.slice(0, 120)}__branch_${branch.id.slice(-80)}_${index}`.slice(0, 256),
  });
  const rollingSummary = branchRollingSummary(
    parent.rollingSummary ?? null,
    parent.messages,
    branch.messages,
    { cardId: card.id, chatId: branch.id, branchId: branch.id },
    new Date().toISOString(),
  ) ?? undefined;
  return {
    ...branch,
    turnLineage: branchRuntimeTurnLineage(
      readChatTurnLineage(parent, card),
      parent.messages,
      branch.messages,
      { level: "branch", chatId: branch.id, branchId: branch.id },
    ),
    ...(authoritativeEvents.length > 0 ? { authoritativeEvents } : {}),
    rollingSummary,
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
      const {
        variants: _variants,
        activeVariantIndex: _activeVariantIndex,
        promptRunId: _promptRunId,
        variantRunIds: _variantRunIds,
        undoneVariantIndices: _undoneVariantIndices,
        ...withoutVariants
      } = message;
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
  const authoritativeEvents = parseAuthoritativeEventStream(
    (branch.authoritativeEvents ?? []).filter(
      (event) => event.messageId !== clonedTargetId && event.variant?.assistantMessageId !== clonedTargetId,
    ),
  );
  return {
    ...branch,
    authoritativeEvents,
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

export function undoChatTurnEffects(
  chat: ChatSession,
  card: RuntimeCard,
  messageId: string,
): ChatTurnMutationResult {
  const messageIndex = chat.messages.findIndex((message) => message.id === messageId);
  if (messageIndex < 0) {
    return { chat, changed: false, reason: "That message is no longer available." };
  }
  if (chat.messages.slice(messageIndex + 1).some((message) => message.role === "assistant")) {
    return {
      chat,
      changed: false,
      reason: "Cannot undo an earlier turn while dependent downstream turns remain.",
    };
  }
  const message = chat.messages[messageIndex];
  const lineage = readChatTurnLineage(chat, card);
  const commit = lineage.ledger[messageId];
  if (!commit || commit.variants.length === 0) {
    return { chat, changed: false, reason: "This turn has no applied state effects to undo." };
  }
  const activeVariantIndex = message.activeVariantIndex ?? commit.variants[commit.variants.length - 1].variantIndex;
  const remainingVariants = commit.variants.filter((variant) => variant.variantIndex !== activeVariantIndex);
  if (remainingVariants.length === commit.variants.length) {
    return { chat, changed: false, reason: "The active variant has no applied state effects to undo." };
  }

  const ledger = { ...lineage.ledger };
  if (remainingVariants.length === 0) {
    delete ledger[messageId];
  } else {
    ledger[messageId] = { ...commit, variants: remainingVariants };
  }
  return {
    changed: true,
    chat: {
      ...chat,
      messages: chat.messages.map((candidate) =>
        candidate.id === messageId
          ? {
              ...candidate,
              undoneVariantIndices: [
                ...new Set([...(candidate.undoneVariantIndices ?? []), activeVariantIndex]),
              ],
            }
          : candidate,
      ),
      turnLineage: {
        baseState: lineage.baseState,
        ledger,
      },
      updatedAt: new Date().toISOString(),
    },
  };
}

function readChatTurnLineage(chat: ChatSession, card: RuntimeCard): RuntimeTurnLineage {
  return parseRuntimeTurnLineage(chat.turnLineage, card);
}

function sameAuthoritativeRpgState(left: AuthoritativeRpgState, right: NonNullable<RuntimeCard["rpg"]>): boolean {
  return left.location === right.location &&
    left.health === right.health &&
    arraysEqual(left.inventory, right.inventory) &&
    arraysEqual(left.quests, right.quests) &&
    arraysEqual(left.knownPlaces, right.knownPlaces) &&
    JSON.stringify(sortBooleanRecord(left.flags)) === JSON.stringify(sortBooleanRecord(right.flags));
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sortBooleanRecord(value: Readonly<Record<string, boolean>>): Record<string, boolean> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}
