export interface RollingSummaryMessage {
  readonly id: string;
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface RollingSummaryScope {
  readonly cardId: string;
  readonly chatId: string;
  readonly branchId: string;
}

export interface RollingSummary {
  readonly scope: RollingSummaryScope;
  readonly text: string;
  /** Bounded tail of covered IDs used for cheap local diagnostics. */
  readonly coveredMessageIds: readonly string[];
  readonly coveredMessageFingerprints: readonly string[];
  /** Total message-prefix length processed by this summary. */
  readonly coveredMessageCount?: number;
  /** Digest of the complete covered prefix, including content and roles. */
  readonly coverageFingerprint?: string;
  readonly throughMessageId: string;
  readonly updatedAt: string;
}

export interface AdvanceRollingSummaryRequest {
  readonly previous: RollingSummary | null;
  readonly messages: readonly RollingSummaryMessage[];
  readonly scope: RollingSummaryScope;
  readonly retainRecentMessages: number;
  readonly maxCharacters: number;
  readonly now: string;
}

export const MAX_ROLLING_SUMMARY_CHARACTERS = 6_000;
export const MAX_STORED_ROLLING_SUMMARY_MESSAGES = 512;
const MAX_LEGACY_COVERED_MESSAGES = 10_000;
const MAX_COVERED_MESSAGE_COUNT = 1_000_000;

export function parseRollingSummary(value: unknown): RollingSummary | null {
  if (!isRecord(value) || !isRecord(value.scope)) {
    return null;
  }
  const parsedScope = {
    cardId: readBoundedString(value.scope.cardId, 256),
    chatId: readBoundedString(value.scope.chatId, 256),
    branchId: readBoundedString(value.scope.branchId, 256),
  };
  const text = readBoundedString(value.text, MAX_ROLLING_SUMMARY_CHARACTERS);
  const throughMessageId = readBoundedString(value.throughMessageId, 256);
  const coveredMessageCount = value.coveredMessageCount === undefined
    ? undefined
    : typeof value.coveredMessageCount === "number" &&
        Number.isInteger(value.coveredMessageCount) &&
        value.coveredMessageCount > 0 &&
        value.coveredMessageCount <= MAX_COVERED_MESSAGE_COUNT
      ? value.coveredMessageCount
      : null;
  const coverageFingerprint = value.coverageFingerprint === undefined
    ? undefined
    : typeof value.coverageFingerprint === "string" && /^[0-9a-f]{16}$/.test(value.coverageFingerprint)
      ? value.coverageFingerprint
      : null;
  if (
    !parsedScope.cardId ||
    !parsedScope.chatId ||
    !parsedScope.branchId ||
    !text ||
    !throughMessageId ||
    typeof value.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.updatedAt)) ||
    !Array.isArray(value.coveredMessageIds) ||
    !Array.isArray(value.coveredMessageFingerprints) ||
    value.coveredMessageIds.length === 0 ||
    value.coveredMessageIds.length > MAX_LEGACY_COVERED_MESSAGES ||
    value.coveredMessageIds.length !== value.coveredMessageFingerprints.length ||
    !value.coveredMessageIds.every((id) => readBoundedString(id, 256) !== null) ||
    !value.coveredMessageFingerprints.every(
      (fingerprint) => typeof fingerprint === "string" && /^[0-9a-f]{8}$/.test(fingerprint),
    ) ||
    value.coveredMessageIds[value.coveredMessageIds.length - 1] !== throughMessageId ||
    coveredMessageCount === null ||
    coverageFingerprint === null ||
    (coveredMessageCount !== undefined && coveredMessageCount < value.coveredMessageIds.length) ||
    (coveredMessageCount !== undefined && coveredMessageCount > value.coveredMessageIds.length && !coverageFingerprint)
  ) {
    return null;
  }
  return {
    scope: parsedScope as RollingSummaryScope,
    text,
    coveredMessageIds: [...value.coveredMessageIds] as string[],
    coveredMessageFingerprints: [...value.coveredMessageFingerprints] as string[],
    ...(coveredMessageCount === undefined ? {} : { coveredMessageCount }),
    ...(coverageFingerprint === undefined ? {} : { coverageFingerprint }),
    throughMessageId,
    updatedAt: value.updatedAt,
  };
}

function sameScope(left: RollingSummaryScope, right: RollingSummaryScope): boolean {
  return left.cardId === right.cardId && left.chatId === right.chatId && left.branchId === right.branchId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBoundedString(value: unknown, maximum: number): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum ? value : null;
}

function assertCompleteScope(scope: RollingSummaryScope): void {
  if (
    !scope ||
    typeof scope.cardId !== "string" ||
    !scope.cardId.trim() ||
    typeof scope.chatId !== "string" ||
    !scope.chatId.trim() ||
    typeof scope.branchId !== "string" ||
    !scope.branchId.trim()
  ) {
    throw new Error("Rolling summaries require complete card, chat, and branch scope boundaries.");
  }
}

function fingerprintMessage(message: RollingSummaryMessage): string {
  const value = `${message.id}\u0000${message.role}\u0000${message.content}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function fingerprintHistory(messages: readonly RollingSummaryMessage[]): string {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (const message of messages) {
    const fingerprint = fingerprintMessage(message);
    for (let index = 0; index < fingerprint.length; index += 1) {
      const code = fingerprint.charCodeAt(index);
      left ^= code;
      left = Math.imul(left, 0x01000193);
      right ^= code + index;
      right = Math.imul(right, 0x85ebca6b);
    }
  }
  return `${(left >>> 0).toString(16).padStart(8, "0")}${(right >>> 0).toString(16).padStart(8, "0")}`;
}

function formatMessage(message: RollingSummaryMessage): string {
  const role = message.role === "assistant" ? "Assistant" : message.role === "user" ? "Player" : "System";
  return `${role}: ${message.content.trim()}`;
}

/** Keeps the newest extractive facts when bounded; this is not an abstractive model summary. */
function constrainText(value: string, maxCharacters: number): string {
  if (value.length <= maxCharacters) {
    return value;
  }
  if (maxCharacters === 1) {
    return ".";
  }
  const marker = maxCharacters >= 4 ? "..." : ".";
  return `${marker}${value.slice(value.length - (maxCharacters - marker.length)).trimStart()}`;
}

export function reconcileRollingSummaryForHistory(
  summary: RollingSummary | null,
  messages: readonly RollingSummaryMessage[],
  scope: RollingSummaryScope,
): RollingSummary | null {
  assertCompleteScope(scope);
  if (!summary || !sameScope(summary.scope, scope)) {
    return null;
  }
  const coveredMessageCount = summary.coveredMessageCount ?? summary.coveredMessageIds.length;
  if (
    summary.coveredMessageIds.length === 0 ||
    summary.coveredMessageIds.length !== summary.coveredMessageFingerprints.length ||
    coveredMessageCount < summary.coveredMessageIds.length ||
    coveredMessageCount > messages.length
  ) {
    return null;
  }
  const coverageWindowStart = coveredMessageCount - summary.coveredMessageIds.length;
  for (let index = 0; index < summary.coveredMessageIds.length; index += 1) {
    const message = messages[coverageWindowStart + index];
    if (
      !message ||
      message.id !== summary.coveredMessageIds[index] ||
      fingerprintMessage(message) !== summary.coveredMessageFingerprints[index]
    ) {
      return null;
    }
  }
  if (
    summary.throughMessageId !== messages[coveredMessageCount - 1]?.id ||
    (summary.coverageFingerprint !== undefined &&
      summary.coverageFingerprint !== fingerprintHistory(messages.slice(0, coveredMessageCount)))
  ) {
    return null;
  }
  return summary;
}

export function advanceRollingSummary(request: AdvanceRollingSummaryRequest): RollingSummary | null {
  assertCompleteScope(request.scope);
  if (!Number.isFinite(request.maxCharacters) || request.maxCharacters < 1) {
    throw new Error("Rolling summary maxCharacters must be at least 1.");
  }
  if (!Number.isFinite(request.retainRecentMessages) || request.retainRecentMessages < 0) {
    throw new Error("Rolling summary retainRecentMessages must be zero or greater.");
  }

  const retainRecentMessages = Math.trunc(request.retainRecentMessages);
  const coveredCount = Math.max(0, request.messages.length - retainRecentMessages);
  const eligibleMessages = request.messages.slice(0, coveredCount);
  if (eligibleMessages.length === 0) {
    return null;
  }

  const validPrevious = reconcileRollingSummaryForHistory(request.previous, request.messages, request.scope);
  const previousCoveredCount = Math.min(
    validPrevious?.coveredMessageCount ?? validPrevious?.coveredMessageIds.length ?? 0,
    eligibleMessages.length,
  );
  const newlyCovered = eligibleMessages.slice(previousCoveredCount);
  const maximumCharacters = Math.min(Math.trunc(request.maxCharacters), MAX_ROLLING_SUMMARY_CHARACTERS);
  if (validPrevious && newlyCovered.length === 0) {
    if (validPrevious.text.length <= maximumCharacters) {
      return validPrevious;
    }
    return { ...validPrevious, text: constrainText(validPrevious.text, maximumCharacters), updatedAt: request.now };
  }

  const fragments = [validPrevious?.text ?? "", ...newlyCovered.map(formatMessage)].filter(Boolean);
  const coverageMessages = eligibleMessages.slice(-MAX_STORED_ROLLING_SUMMARY_MESSAGES);
  return {
    scope: { ...request.scope },
    text: constrainText(fragments.join("\n"), maximumCharacters),
    coveredMessageIds: coverageMessages.map((message) => message.id),
    coveredMessageFingerprints: coverageMessages.map(fingerprintMessage),
    coveredMessageCount: eligibleMessages.length,
    coverageFingerprint: fingerprintHistory(eligibleMessages),
    throughMessageId: eligibleMessages[eligibleMessages.length - 1].id,
    updatedAt: request.now,
  };
}

/** Re-scopes a summary only when the branch copied its covered prefix unchanged. */
export function branchRollingSummary(
  summary: RollingSummary | null,
  parentMessages: readonly RollingSummaryMessage[],
  branchMessages: readonly RollingSummaryMessage[],
  branchScope: RollingSummaryScope,
  now: string,
): RollingSummary | null {
  assertCompleteScope(branchScope);
  if (!summary || !reconcileRollingSummaryForHistory(summary, parentMessages, summary.scope)) {
    return null;
  }
  const coveredMessageCount = summary.coveredMessageCount ?? summary.coveredMessageIds.length;
  if (branchMessages.length < coveredMessageCount) {
    return null;
  }
  for (let index = 0; index < coveredMessageCount; index += 1) {
    if (
      parentMessages[index]?.role !== branchMessages[index]?.role ||
      parentMessages[index]?.content !== branchMessages[index]?.content
    ) {
      return null;
    }
  }
  const coveredBranchMessages = branchMessages.slice(0, coveredMessageCount);
  const coverageMessages = coveredBranchMessages.slice(-MAX_STORED_ROLLING_SUMMARY_MESSAGES);
  return {
    scope: { ...branchScope },
    text: summary.text,
    coveredMessageIds: coverageMessages.map((message) => message.id),
    coveredMessageFingerprints: coverageMessages.map(fingerprintMessage),
    coveredMessageCount,
    coverageFingerprint: fingerprintHistory(coveredBranchMessages),
    throughMessageId: coveredBranchMessages[coveredBranchMessages.length - 1].id,
    updatedAt: now,
  };
}
