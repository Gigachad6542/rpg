import type { JsonValue } from "../domain/ids";

const EVENT_SCHEMA_VERSION = 1 as const;
const MAX_EVENT_COUNT = 10_000;
const MAX_ID_LENGTH = 256;
const MAX_TEXT_LENGTH = 32_768;
const MAX_JSON_DEPTH = 12;
const MAX_JSON_COLLECTION_SIZE = 512;

export type PlayerActionOrigin = "typed" | "opening" | "slash" | "imported";
export type ToolResultStatus = "success" | "error";

export interface AuthoritativeEventVariant {
  readonly assistantMessageId: string;
  readonly variantIndex: number;
}

export interface AuthoritativeEventBase {
  readonly schemaVersion: typeof EVENT_SCHEMA_VERSION;
  readonly id: string;
  readonly kind: AuthoritativeGameEvent["kind"];
  readonly chatId: string;
  readonly branchId: string;
  readonly messageId: string;
  readonly occurredAt: string;
  readonly originEventId?: string;
  readonly runId?: string;
  readonly variant?: AuthoritativeEventVariant;
}

export interface PlayerActionEvent extends AuthoritativeEventBase {
  readonly kind: "player_action";
  readonly action: string;
  readonly origin: PlayerActionOrigin;
}

export interface DiceRollRecord {
  readonly notation: string;
  readonly count: number;
  readonly sides: number;
  readonly modifier: number;
  readonly rolls: readonly number[];
  readonly total: number;
}

export interface DiceRolledEvent extends AuthoritativeEventBase {
  readonly kind: "dice_rolled";
  readonly roll: DiceRollRecord;
}

export interface RuleDecisionRecord {
  readonly allowed: boolean;
  readonly warning: string | null;
  readonly triggeredRuleIds: readonly string[];
}

export interface RuleDecisionEvent extends AuthoritativeEventBase {
  readonly kind: "rule_decision";
  readonly action: string;
  readonly engine: string;
  readonly decision: RuleDecisionRecord;
}

export interface ToolResultEvent extends AuthoritativeEventBase {
  readonly kind: "tool_result";
  readonly runId: string;
  readonly variant?: AuthoritativeEventVariant;
  readonly toolName: string;
  readonly callId: string;
  readonly status: ToolResultStatus;
  readonly result?: JsonValue;
  readonly error?: string;
}

export type AuthoritativeStateMutation =
  | { readonly type: "location_set"; readonly location: string }
  | { readonly type: "health_set"; readonly health: string }
  | { readonly type: "inventory_add"; readonly item: string }
  | { readonly type: "inventory_remove"; readonly item: string }
  | { readonly type: "quest_set"; readonly quest: string }
  | { readonly type: "quest_remove"; readonly quest: string }
  | { readonly type: "world_flag_set"; readonly flag: string; readonly value: boolean }
  | { readonly type: "world_flag_remove"; readonly flag: string }
  | { readonly type: "known_place_add"; readonly place: string }
  | { readonly type: "known_place_remove"; readonly place: string };

export interface StateCommittedEvent extends AuthoritativeEventBase {
  readonly kind: "state_committed";
  readonly runId: string;
  readonly variant: AuthoritativeEventVariant;
  readonly proposalIds: readonly string[];
  readonly mutations: readonly AuthoritativeStateMutation[];
}

export type AuthoritativeGameEvent =
  | PlayerActionEvent
  | DiceRolledEvent
  | RuleDecisionEvent
  | ToolResultEvent
  | StateCommittedEvent;

export type AuthoritativeEventStream = readonly AuthoritativeGameEvent[];

interface EventFactoryBaseInput {
  readonly id: string;
  readonly chatId: string;
  readonly branchId: string;
  readonly messageId: string;
  readonly occurredAt: string;
  readonly originEventId?: string;
  readonly runId?: string;
}

export interface CreatePlayerActionEventInput extends EventFactoryBaseInput {
  readonly action: string;
  readonly origin: PlayerActionOrigin;
}

export interface CreateDiceRolledEventInput extends EventFactoryBaseInput {
  readonly roll: DiceRollRecord;
}

export interface CreateRuleDecisionEventInput extends EventFactoryBaseInput {
  readonly action: string;
  readonly engine: string;
  readonly decision: RuleDecisionRecord;
}

interface VariantEventFactoryInput extends EventFactoryBaseInput {
  readonly runId: string;
  readonly variant: AuthoritativeEventVariant;
}

export interface CreateToolResultEventInput extends EventFactoryBaseInput {
  readonly runId: string;
  readonly variant?: AuthoritativeEventVariant;
  readonly toolName: string;
  readonly callId: string;
  readonly status: ToolResultStatus;
  readonly result?: JsonValue;
  readonly error?: string;
}

export interface CreateStateCommittedEventInput extends VariantEventFactoryInput {
  readonly proposalIds: readonly string[];
  readonly mutations: readonly AuthoritativeStateMutation[];
}

export interface EventReplayMessage {
  readonly id: string;
  readonly role: "system" | "user" | "assistant";
  readonly activeVariantIndex?: number;
  readonly undoneVariantIndices?: readonly number[];
}

export interface ReplayAuthoritativeEventsInput {
  readonly chatId: string;
  readonly branchId: string;
  readonly messages: readonly EventReplayMessage[];
}

export interface AuthoritativeRpgState {
  readonly location: string;
  readonly health: string;
  readonly inventory: readonly string[];
  readonly quests: readonly string[];
  readonly flags: Readonly<Record<string, boolean>>;
  readonly knownPlaces: readonly string[];
}

export interface BranchAuthoritativeEventStreamInput {
  readonly sourceChatId: string;
  readonly sourceBranchId: string;
  readonly targetChatId: string;
  readonly targetBranchId: string;
  readonly messageIdMap: ReadonlyMap<string, string>;
  readonly createEventId: (event: AuthoritativeGameEvent, index: number) => string;
}

export function createPlayerActionEvent(input: CreatePlayerActionEventInput): PlayerActionEvent {
  return requireParsedEvent({
    ...eventBase(input, "player_action"),
    action: input.action,
    origin: input.origin,
  }, "player action") as PlayerActionEvent;
}

export function createDiceRolledEvent(input: CreateDiceRolledEventInput): DiceRolledEvent {
  return requireParsedEvent({
    ...eventBase(input, "dice_rolled"),
    roll: input.roll,
  }, "dice roll") as DiceRolledEvent;
}

export function createRuleDecisionEvent(input: CreateRuleDecisionEventInput): RuleDecisionEvent {
  return requireParsedEvent({
    ...eventBase(input, "rule_decision"),
    action: input.action,
    engine: input.engine,
    decision: input.decision,
  }, "rule decision") as RuleDecisionEvent;
}

export function createToolResultEvent(input: CreateToolResultEventInput): ToolResultEvent {
  return requireParsedEvent({
    ...eventBase(input, "tool_result"),
    runId: input.runId,
    ...(input.variant ? { variant: input.variant } : {}),
    toolName: input.toolName,
    callId: input.callId,
    status: input.status,
    ...(input.result !== undefined ? { result: input.result } : {}),
    ...(input.error !== undefined ? { error: input.error } : {}),
  }, "tool result") as ToolResultEvent;
}

export function createStateCommittedEvent(input: CreateStateCommittedEventInput): StateCommittedEvent {
  return requireParsedEvent({
    ...eventBase(input, "state_committed"),
    runId: input.runId,
    variant: input.variant,
    proposalIds: input.proposalIds,
    mutations: input.mutations,
  }, "state commit") as StateCommittedEvent;
}

/**
 * Appends a defensively copied event. Existing snapshots are never modified,
 * and duplicate ids fail loudly because replacement would rewrite history.
 */
export function appendAuthoritativeEvent(
  stream: AuthoritativeEventStream,
  event: AuthoritativeGameEvent,
): AuthoritativeEventStream {
  if (stream.some((candidate) => candidate.id === event.id)) {
    throw new Error(`Duplicate authoritative event id: ${event.id}`);
  }
  if (stream.length >= MAX_EVENT_COUNT) {
    throw new Error(`Authoritative event stream exceeds ${MAX_EVENT_COUNT} events.`);
  }
  const parsedEvent = parseEvent(event);
  if (!parsedEvent) {
    throw new Error("Invalid authoritative event.");
  }
  return Object.freeze([...stream, parsedEvent]);
}

/**
 * Parses persisted or imported history fail-closed. Unknown kinds, malformed
 * payloads, invalid dice, and duplicate ids are discarded.
 */
export function parseAuthoritativeEventStream(value: unknown): AuthoritativeEventStream {
  if (!Array.isArray(value)) {
    return Object.freeze([]);
  }
  const events: AuthoritativeGameEvent[] = [];
  const seenIds = new Set<string>();
  for (const candidate of value.slice(0, MAX_EVENT_COUNT)) {
    const event = parseEvent(candidate);
    if (!event || seenIds.has(event.id)) {
      continue;
    }
    seenIds.add(event.id);
    events.push(event);
  }
  return Object.freeze(events);
}

/**
 * Projects an append-only stream onto the visible causal chain. Variant-owned
 * events only replay for the selected, non-undone assistant variant.
 */
export function replayAuthoritativeEvents(
  stream: AuthoritativeEventStream,
  input: ReplayAuthoritativeEventsInput,
): AuthoritativeEventStream {
  if (!isBoundedString(input.chatId, MAX_ID_LENGTH) || !isBoundedString(input.branchId, MAX_ID_LENGTH)) {
    return Object.freeze([]);
  }
  const messages = new Map(input.messages.map((message) => [message.id, message]));
  const fallbackVariants = newestVariantByMessage(stream, input.chatId, input.branchId);
  const replayed = stream.filter((event) => {
    if (event.chatId !== input.chatId || event.branchId !== input.branchId) {
      return false;
    }
    const ownsPersistedMessage = messages.has(event.messageId);
    if (!ownsPersistedMessage && !(event.runId && (event.kind === "player_action" || event.kind === "rule_decision"))) {
      return false;
    }
    if (!event.variant) {
      return true;
    }
    const owner = messages.get(event.variant.assistantMessageId);
    if (!owner || owner.role !== "assistant") {
      return false;
    }
    const activeVariant = owner.activeVariantIndex ?? fallbackVariants.get(owner.id);
    if (activeVariant === undefined || activeVariant !== event.variant.variantIndex) {
      return false;
    }
    return !owner.undoneVariantIndices?.includes(activeVariant);
  });
  return parseAuthoritativeEventStream(replayed);
}

/** Reconstructs the typed RPG projection from the active, non-undone state events. */
export function replayAuthoritativeRpgState(
  base: AuthoritativeRpgState,
  stream: AuthoritativeEventStream,
  input: ReplayAuthoritativeEventsInput,
): AuthoritativeRpgState {
  const state = {
    location: base.location,
    health: base.health,
    inventory: [...base.inventory],
    quests: [...base.quests],
    flags: { ...base.flags },
    knownPlaces: [...base.knownPlaces],
  };
  for (const event of replayAuthoritativeEvents(stream, input)) {
    if (event.kind !== "state_committed") {
      continue;
    }
    for (const mutation of event.mutations) {
      switch (mutation.type) {
        case "location_set":
          state.location = mutation.location;
          break;
        case "health_set":
          state.health = mutation.health;
          break;
        case "inventory_add":
          addUnique(state.inventory, mutation.item);
          break;
        case "inventory_remove":
          removeValue(state.inventory, mutation.item);
          break;
        case "quest_set":
          addUnique(state.quests, mutation.quest);
          break;
        case "quest_remove":
          removeValue(state.quests, mutation.quest);
          break;
        case "world_flag_set":
          state.flags[mutation.flag] = mutation.value;
          break;
        case "world_flag_remove":
          delete state.flags[mutation.flag];
          break;
        case "known_place_add":
          addUnique(state.knownPlaces, mutation.place);
          break;
        case "known_place_remove":
          removeValue(state.knownPlaces, mutation.place);
          break;
      }
    }
  }
  return deepFreeze(state);
}

/**
 * Copies only events whose causal message exists in a branch prefix. Both the
 * message owner and any assistant-variant owner are remapped to the branch.
 */
export function branchAuthoritativeEventStream(
  stream: AuthoritativeEventStream,
  input: BranchAuthoritativeEventStreamInput,
): AuthoritativeEventStream {
  let branched: AuthoritativeEventStream = [];
  for (const event of stream) {
    if (event.chatId !== input.sourceChatId || event.branchId !== input.sourceBranchId) {
      continue;
    }
    const targetMessageId = input.messageIdMap.get(event.messageId);
    if (!targetMessageId) {
      continue;
    }
    const targetVariantOwner = event.variant
      ? input.messageIdMap.get(event.variant.assistantMessageId)
      : undefined;
    if (event.variant && !targetVariantOwner) {
      continue;
    }
    const branchIndex = branched.length;
    const branchId = input.createEventId(event, branchIndex);
    const copied = {
      ...event,
      id: branchId,
      originEventId: event.id,
      chatId: input.targetChatId,
      branchId: input.targetBranchId,
      messageId: targetMessageId,
      ...(event.variant
        ? {
            variant: {
              assistantMessageId: targetVariantOwner as string,
              variantIndex: event.variant.variantIndex,
            },
          }
        : {}),
    } as AuthoritativeGameEvent;
    branched = appendAuthoritativeEvent(branched, copied);
  }
  return branched;
}

function eventBase(input: EventFactoryBaseInput, kind: AuthoritativeGameEvent["kind"]): Record<string, unknown> {
  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    id: input.id,
    kind,
    chatId: input.chatId,
    branchId: input.branchId,
    messageId: input.messageId,
    occurredAt: input.occurredAt,
    ...(input.originEventId ? { originEventId: input.originEventId } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
  };
}

function requireParsedEvent(value: unknown, label: string): AuthoritativeGameEvent {
  const parsed = parseEvent(value);
  if (!parsed) {
    throw new Error(`Invalid authoritative ${label} event.`);
  }
  return parsed;
}

function parseEvent(value: unknown): AuthoritativeGameEvent | null {
  if (!isRecord(value) || value.schemaVersion !== EVENT_SCHEMA_VERSION) {
    return null;
  }
  const base = parseEventBase(value);
  if (!base) {
    return null;
  }
  switch (value.kind) {
    case "player_action": {
      if (!isBoundedString(value.action, MAX_TEXT_LENGTH) || !isPlayerActionOrigin(value.origin)) {
        return null;
      }
      return freezeEvent({ ...base, kind: "player_action", action: value.action, origin: value.origin });
    }
    case "dice_rolled": {
      const roll = parseDiceRoll(value.roll);
      return roll ? freezeEvent({ ...base, kind: "dice_rolled", roll }) : null;
    }
    case "rule_decision": {
      const decision = parseRuleDecision(value.decision);
      if (!decision || !isBoundedString(value.action, MAX_TEXT_LENGTH) || !isBoundedString(value.engine, MAX_ID_LENGTH)) {
        return null;
      }
      return freezeEvent({ ...base, kind: "rule_decision", action: value.action, engine: value.engine, decision });
    }
    case "tool_result": {
      const variant = value.variant === undefined ? undefined : parseVariant(value.variant);
      if (
        (value.variant !== undefined && !variant) ||
        !isBoundedString(value.runId, MAX_ID_LENGTH) ||
        !isBoundedString(value.toolName, MAX_ID_LENGTH) ||
        !isBoundedString(value.callId, MAX_ID_LENGTH) ||
        containsSecretLikeValue(value.runId) ||
        containsSecretLikeValue(value.toolName) ||
        containsSecretLikeValue(value.callId) ||
        (value.status !== "success" && value.status !== "error") ||
        (value.error !== undefined && (!isBoundedString(value.error, MAX_TEXT_LENGTH) || containsSecretLikeValue(value.error)))
      ) {
        return null;
      }
      let result: JsonCloneResult | undefined;
      if (value.result !== undefined) {
        result = cloneJsonValue(value.result, 0);
        if (!result.ok) {
          return null;
        }
      }
      return freezeEvent({
        ...base,
        kind: "tool_result",
        runId: value.runId,
        ...(variant ? { variant } : {}),
        toolName: value.toolName,
        callId: value.callId,
        status: value.status,
        ...(result?.ok ? { result: result.value } : {}),
        ...(value.error !== undefined ? { error: value.error } : {}),
      });
    }
    case "state_committed": {
      const variant = parseVariant(value.variant);
      const proposalIds = parseStringArray(value.proposalIds, MAX_ID_LENGTH);
      const mutations = parseStateMutations(value.mutations);
      if (!variant || !isBoundedString(value.runId, MAX_ID_LENGTH) || !proposalIds || !mutations) {
        return null;
      }
      return freezeEvent({
        ...base,
        kind: "state_committed",
        runId: value.runId,
        variant,
        proposalIds,
        mutations,
      });
    }
    default:
      return null;
  }
}

function parseEventBase(value: Record<string, unknown>): Omit<AuthoritativeEventBase, "kind"> | null {
  if (
    !isBoundedString(value.id, MAX_ID_LENGTH) ||
    !isBoundedString(value.chatId, MAX_ID_LENGTH) ||
    !isBoundedString(value.branchId, MAX_ID_LENGTH) ||
    !isBoundedString(value.messageId, MAX_ID_LENGTH) ||
    !isIsoTimestamp(value.occurredAt) ||
    (value.originEventId !== undefined && !isBoundedString(value.originEventId, MAX_ID_LENGTH)) ||
    (value.runId !== undefined && !isBoundedString(value.runId, MAX_ID_LENGTH))
  ) {
    return null;
  }
  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    id: value.id,
    chatId: value.chatId,
    branchId: value.branchId,
    messageId: value.messageId,
    occurredAt: value.occurredAt,
    ...(value.originEventId !== undefined ? { originEventId: value.originEventId } : {}),
    ...(value.runId !== undefined ? { runId: value.runId } : {}),
  };
}

function parseDiceRoll(value: unknown): DiceRollRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const { count, sides, modifier, total } = value;
  if (
    !isBoundedString(value.notation, 64) ||
    !isIntegerInRange(count, 1, 100) ||
    !isIntegerInRange(sides, 2, 1_000) ||
    !isIntegerInRange(modifier, -100_000, 100_000) ||
    !Array.isArray(value.rolls) ||
    value.rolls.length !== count ||
    !value.rolls.every((roll) => isIntegerInRange(roll, 1, sides)) ||
    !Number.isSafeInteger(total)
  ) {
    return null;
  }
  const rolls = value.rolls as number[];
  if (rolls.reduce((sum, roll) => sum + roll, 0) + modifier !== total) {
    return null;
  }
  return {
    notation: value.notation,
    count,
    sides,
    modifier,
    rolls: [...rolls],
    total,
  };
}

function parseRuleDecision(value: unknown): RuleDecisionRecord | null {
  if (!isRecord(value) || typeof value.allowed !== "boolean") {
    return null;
  }
  if (value.warning !== null && !isBoundedString(value.warning, MAX_TEXT_LENGTH)) {
    return null;
  }
  const triggeredRuleIds = parseStringArray(value.triggeredRuleIds, MAX_ID_LENGTH);
  return triggeredRuleIds
    ? { allowed: value.allowed, warning: value.warning, triggeredRuleIds }
    : null;
}

function parseVariant(value: unknown): AuthoritativeEventVariant | null {
  if (
    !isRecord(value) ||
    !isBoundedString(value.assistantMessageId, MAX_ID_LENGTH) ||
    !isIntegerInRange(value.variantIndex, 0, Number.MAX_SAFE_INTEGER)
  ) {
    return null;
  }
  return { assistantMessageId: value.assistantMessageId, variantIndex: value.variantIndex };
}

function parseStateMutations(value: unknown): AuthoritativeStateMutation[] | null {
  if (!Array.isArray(value) || value.length > MAX_JSON_COLLECTION_SIZE) {
    return null;
  }
  const mutations: AuthoritativeStateMutation[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)) {
      return null;
    }
    let mutation: AuthoritativeStateMutation | null;
    switch (candidate.type) {
      case "location_set":
        mutation = isBoundedString(candidate.location, MAX_TEXT_LENGTH)
          ? { type: "location_set", location: candidate.location }
          : null;
        break;
      case "health_set":
        mutation = isBoundedString(candidate.health, MAX_TEXT_LENGTH)
          ? { type: "health_set", health: candidate.health }
          : null;
        break;
      case "inventory_add":
        mutation = isBoundedString(candidate.item, MAX_TEXT_LENGTH)
          ? { type: "inventory_add", item: candidate.item }
          : null;
        break;
      case "inventory_remove":
        mutation = isBoundedString(candidate.item, MAX_TEXT_LENGTH)
          ? { type: "inventory_remove", item: candidate.item }
          : null;
        break;
      case "quest_set":
        mutation = isBoundedString(candidate.quest, MAX_TEXT_LENGTH)
          ? { type: "quest_set", quest: candidate.quest }
          : null;
        break;
      case "quest_remove":
        mutation = isBoundedString(candidate.quest, MAX_TEXT_LENGTH)
          ? { type: "quest_remove", quest: candidate.quest }
          : null;
        break;
      case "world_flag_set":
        mutation = isBoundedString(candidate.flag, MAX_ID_LENGTH) && typeof candidate.value === "boolean"
          ? { type: "world_flag_set", flag: candidate.flag, value: candidate.value }
          : null;
        break;
      case "world_flag_remove":
        mutation = isBoundedString(candidate.flag, MAX_ID_LENGTH)
          ? { type: "world_flag_remove", flag: candidate.flag }
          : null;
        break;
      case "known_place_add":
        mutation = isBoundedString(candidate.place, MAX_TEXT_LENGTH)
          ? { type: "known_place_add", place: candidate.place }
          : null;
        break;
      case "known_place_remove":
        mutation = isBoundedString(candidate.place, MAX_TEXT_LENGTH)
          ? { type: "known_place_remove", place: candidate.place }
          : null;
        break;
      default:
        return null;
    }
    if (!mutation) {
      return null;
    }
    mutations.push(mutation);
  }
  return mutations;
}

function newestVariantByMessage(
  stream: AuthoritativeEventStream,
  chatId: string,
  branchId: string,
): Map<string, number> {
  const result = new Map<string, number>();
  for (const event of stream) {
    if (event.chatId !== chatId || event.branchId !== branchId || !event.variant) {
      continue;
    }
    const previous = result.get(event.variant.assistantMessageId) ?? -1;
    result.set(event.variant.assistantMessageId, Math.max(previous, event.variant.variantIndex));
  }
  return result;
}

function addUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function removeValue(values: string[], value: string): void {
  let index = values.indexOf(value);
  while (index >= 0) {
    values.splice(index, 1);
    index = values.indexOf(value);
  }
}

function parseStringArray(value: unknown, maxLength: number): string[] | null {
  if (
    !Array.isArray(value) ||
    value.length > MAX_JSON_COLLECTION_SIZE ||
    !value.every((item) => isBoundedString(item, maxLength))
  ) {
    return null;
  }
  return [...value] as string[];
}

type JsonCloneResult = { readonly ok: true; readonly value: JsonValue } | { readonly ok: false };

function cloneJsonValue(value: unknown, depth: number): JsonCloneResult {
  if (depth > MAX_JSON_DEPTH) {
    return { ok: false };
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return typeof value === "string" && (value.length > MAX_TEXT_LENGTH || containsSecretLikeValue(value))
      ? { ok: false }
      : { ok: true, value };
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? { ok: true, value } : { ok: false };
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_JSON_COLLECTION_SIZE) {
      return { ok: false };
    }
    const result: JsonValue[] = [];
    for (const item of value) {
      const cloned = cloneJsonValue(item, depth + 1);
      if (!cloned.ok) {
        return cloned;
      }
      result.push(cloned.value);
    }
    return { ok: true, value: result };
  }
  if (!isRecord(value)) {
    return { ok: false };
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_JSON_COLLECTION_SIZE) {
    return { ok: false };
  }
  const result: Record<string, JsonValue> = {};
  for (const [key, item] of entries) {
    if (!isSafeJsonKey(key) || isSecretJsonKey(key)) {
      return { ok: false };
    }
    const cloned = cloneJsonValue(item, depth + 1);
    if (!cloned.ok) {
      return cloned;
    }
    result[key] = cloned.value;
  }
  return { ok: true, value: result };
}

function freezeEvent<Event extends AuthoritativeGameEvent>(event: Event): Event {
  return deepFreeze(event);
}

function deepFreeze<Value>(value: Value): Value {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function isPlayerActionOrigin(value: unknown): value is PlayerActionOrigin {
  return value === "typed" || value === "opening" || value === "slash" || value === "imported";
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function isIsoTimestamp(value: unknown): value is string {
  return isBoundedString(value, 64) && Number.isFinite(Date.parse(value));
}

function isSafeJsonKey(value: string): boolean {
  return value.length > 0 && value.length <= MAX_ID_LENGTH && value !== "__proto__" && value !== "prototype" && value !== "constructor";
}

function isSecretJsonKey(value: string): boolean {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized === "token" ||
    normalized.endsWith("token") ||
    normalized.includes("apikey") ||
    normalized.includes("authorization") ||
    normalized.includes("accesskey") ||
    normalized.includes("password") ||
    normalized.includes("secret") ||
    normalized.includes("privatekey") ||
    normalized.includes("credential");
}

function containsSecretLikeValue(value: string): boolean {
  return /\bBearer\s+\S+/i.test(value) ||
    /\bsk-[A-Za-z0-9_-]{8,}\b/.test(value) ||
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/.test(value) ||
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/.test(value) ||
    /\bAKIA[A-Z0-9]{16}\b/.test(value) ||
    /\bAIza[A-Za-z0-9_-]{20,}\b/.test(value) ||
    /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(value) ||
    /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----/.test(value) ||
    /\b(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret)\s*[:=]\s*\S+/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
