import type { ModelCallRecord } from "./runtimeTypes";

const MAX_MODEL_CALLS_PER_TURN = 2;
const MAX_MODEL_CALL_TEXT_LENGTH = 300;
const MAX_FAILURE_MESSAGE_LENGTH = 240;

export function parsePersistedModelCallRecords(value: unknown): ModelCallRecord[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MODEL_CALLS_PER_TURN) {
    return undefined;
  }

  const parsed = value.map(parsePersistedModelCallRecord);
  if (parsed.some((call) => call === undefined)) {
    return undefined;
  }

  const calls = parsed as ModelCallRecord[];
  const phases = calls.map((call) => call.phase);
  if (new Set(phases).size !== phases.length) {
    return undefined;
  }
  if (phases.length === 2 && phases[0] !== "hidden-continuity") {
    return undefined;
  }
  return calls;
}

export function isConsistentModelCallRecord(value: unknown): boolean {
  return parsePersistedModelCallRecord(value) !== undefined;
}

export function sanitizePromptRunModelCalls<PromptRun>(promptRuns: PromptRun[]): PromptRun[] {
  let changed = false;
  const sanitizedRuns = promptRuns.map((run) => {
    if (!isRecord(run) || !("modelCalls" in run)) {
      return run;
    }
    const modelCalls = parsePersistedModelCallRecords(run.modelCalls);
    if (modelCalls) {
      changed = true;
      return { ...run, modelCalls } as PromptRun;
    }
    changed = true;
    const sanitized = { ...run };
    delete sanitized.modelCalls;
    return sanitized as PromptRun;
  });
  return changed ? sanitizedRuns : promptRuns;
}

export function containsSecretLikeTelemetry(value: string): boolean {
  return /\bBearer\s+\S+/i.test(value) ||
    /\bsk-[A-Za-z0-9_-]{8,}\b/.test(value) ||
    /\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{16,}\b/i.test(value) ||
    /\bAKIA[A-Z0-9]{16}\b/.test(value) ||
    /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(value) ||
    /-----BEGIN[ _-]+(?:RSA[ _-]+|EC[ _-]+|OPENSSH[ _-]+)?PRIVATE[ _-]+KEY-----/i.test(value) ||
    /\b(api[_ -]?key|access[_ -]?key(?:[_ -]?id)?|token|session[_ -]?token|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|private[_ -]?key|password|secret)\s*[:=]\s*\S+/i.test(value);
}

function parsePersistedModelCallRecord(value: unknown): ModelCallRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const phase = value.phase;
  const status = value.status;
  if (
    (phase !== "hidden-continuity" && phase !== "visible-response") ||
    (status !== "success" && status !== "error") ||
    !isBoundedNonEmptyString(value.provider) ||
    !isBoundedNonEmptyString(value.model) ||
    !isNonnegativeFiniteNumber(value.durationMs)
  ) {
    return undefined;
  }

  const usage = readUsage(value.usage);
  if (!usage) {
    return undefined;
  }
  const inputBudgetTokens = readOptionalNonnegativeInteger(value.inputBudgetTokens);
  const effectiveContextWindowTokens = readOptionalPositiveInteger(value.effectiveContextWindowTokens, 4_096_000);
  const budgetSource = value.budgetSource === "model-metadata" || value.budgetSource === "conservative-fallback"
    ? value.budgetSource
    : undefined;
  const usageSource = value.usageSource === "provider" || value.usageSource === "estimated" || value.usageSource === "unavailable"
    ? value.usageSource
    : undefined;
  const stateProposalCount = readOptionalNonnegativeInteger(value.stateProposalCount, 10_000);
  const failure = readFailure(value.failure);

  if (
    (value.inputBudgetTokens !== undefined && inputBudgetTokens === undefined) ||
    (value.effectiveContextWindowTokens !== undefined && effectiveContextWindowTokens === undefined) ||
    (value.budgetSource !== undefined && budgetSource === undefined) ||
    (value.usageSource !== undefined && usageSource === undefined) ||
    (value.stateProposalCount !== undefined && stateProposalCount === undefined) ||
    (value.failure !== undefined && failure === undefined)
  ) {
    return undefined;
  }

  const cost = readCost(value.cost, value.model, usage, usageSource);
  if (value.cost !== undefined && !cost) {
    return undefined;
  }

  return {
    phase,
    provider: value.provider,
    model: value.model,
    usage,
    ...(inputBudgetTokens === undefined ? {} : { inputBudgetTokens }),
    ...(effectiveContextWindowTokens === undefined ? {} : { effectiveContextWindowTokens }),
    ...(budgetSource === undefined ? {} : { budgetSource }),
    durationMs: value.durationMs,
    status,
    ...(usageSource === undefined ? {} : { usageSource }),
    ...(cost === undefined ? {} : { cost }),
    ...(failure === undefined ? {} : { failure }),
    ...(stateProposalCount === undefined ? {} : { stateProposalCount }),
  };
}

function readUsage(value: unknown): ModelCallRecord["usage"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { inputTokens, outputTokens, totalTokens } = value;
  if (
    !isNonnegativeInteger(inputTokens) ||
    !isNonnegativeInteger(outputTokens) ||
    !isNonnegativeInteger(totalTokens) ||
    totalTokens !== inputTokens + outputTokens
  ) {
    return undefined;
  }
  return { inputTokens, outputTokens, totalTokens };
}

function readCost(
  value: unknown,
  model: string,
  usage: ModelCallRecord["usage"],
  usageSource: ModelCallRecord["usageSource"],
): ModelCallRecord["cost"] | undefined {
  if (!isRecord(value) || value.currency !== "USD") {
    return undefined;
  }
  if (value.status === "unknown") {
    return { status: "unknown", currency: "USD" };
  }
  if (
    (value.status !== "known" && value.status !== "estimated") ||
    !isNonnegativeFiniteNumber(value.amountUsd) ||
    !isRecord(value.pricing)
  ) {
    return undefined;
  }
  const pricing = value.pricing;
  if (
    pricing.model !== model ||
    pricing.currency !== "USD" ||
    !isNonnegativeFiniteNumber(pricing.inputUsdPerMillionTokens) ||
    !isNonnegativeFiniteNumber(pricing.outputUsdPerMillionTokens) ||
    !isBoundedNonEmptyString(pricing.source, 200) ||
    typeof pricing.effectiveDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(pricing.effectiveDate)
  ) {
    return undefined;
  }
  if (
    usageSource === "unavailable" ||
    (usageSource === "estimated" && value.status !== "estimated") ||
    (usageSource !== "estimated" && value.status === "estimated")
  ) {
    return undefined;
  }
  const expectedAmount = roundUsd(
    usage.inputTokens * pricing.inputUsdPerMillionTokens / 1_000_000 +
    usage.outputTokens * pricing.outputUsdPerMillionTokens / 1_000_000,
  );
  if (Math.abs(value.amountUsd - expectedAmount) > 1e-12) {
    return undefined;
  }
  return {
    status: value.status,
    currency: "USD",
    amountUsd: value.amountUsd,
    pricing: {
      model: pricing.model,
      currency: "USD",
      inputUsdPerMillionTokens: pricing.inputUsdPerMillionTokens,
      outputUsdPerMillionTokens: pricing.outputUsdPerMillionTokens,
      source: pricing.source,
      effectiveDate: pricing.effectiveDate,
    },
  };
}

function readFailure(value: unknown): ModelCallRecord["failure"] | undefined {
  if (!isRecord(value) || !isBoundedNonEmptyString(value.message, MAX_FAILURE_MESSAGE_LENGTH)) {
    return undefined;
  }
  const category = value.category;
  if (
    category !== "aborted" &&
    category !== "authentication" &&
    category !== "rate-limit" &&
    category !== "network" &&
    category !== "validation" &&
    category !== "provider" &&
    category !== "unknown"
  ) {
    return undefined;
  }
  if (containsSecretLikeTelemetry(value.message)) {
    return undefined;
  }
  return { category, message: value.message };
}

function readOptionalNonnegativeInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number | undefined {
  return value === undefined
    ? undefined
    : isNonnegativeInteger(value) && value <= maximum
      ? value
      : undefined;
}

function readOptionalPositiveInteger(value: unknown, maximum: number): number | undefined {
  return value === undefined
    ? undefined
    : Number.isInteger(value) && typeof value === "number" && value > 0 && value <= maximum
      ? value
      : undefined;
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNonnegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isBoundedNonEmptyString(value: unknown, maximum = MAX_MODEL_CALL_TEXT_LENGTH): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}
