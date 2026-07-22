import type { ModelInfo } from "../providers/TextModelAdapter";

export type ModelCallPhase = "hidden-continuity" | "memory-evidence" | "visible-response";
export type ModelCallBudgetSource = "model-metadata" | "conservative-fallback";

export interface ResolveModelCallBudgetRequest {
  providerId: string;
  model: string;
  phase: ModelCallPhase;
  modelInfo?: ModelInfo;
  reasoningEnabled?: boolean;
}

export interface ModelCallBudget {
  effectiveContextWindowTokens: number;
  inputBudgetTokens: number;
  maxOutputTokens: number;
  safetyReserveTokens: number;
  source: ModelCallBudgetSource;
}

export const CONSERVATIVE_CONTEXT_WINDOW_TOKENS = 16_000;
export const MAX_EFFECTIVE_CONTEXT_WINDOW_TOKENS = 32_000;
export const MODEL_CALL_SAFETY_RESERVE_TOKENS = 512;
export const HIDDEN_CONTINUITY_MAX_OUTPUT_TOKENS = 1_800;
export const MEMORY_EVIDENCE_MAX_OUTPUT_TOKENS = 1_000;
export const VISIBLE_RESPONSE_MAX_OUTPUT_TOKENS = 900;
export const VISIBLE_REASONING_MAX_OUTPUT_TOKENS = 4_000;

export function resolveModelCallBudget(request: ResolveModelCallBudgetRequest): ModelCallBudget {
  const advertisedContextWindow = readMatchingContextWindow(request);
  const source: ModelCallBudgetSource = advertisedContextWindow === undefined
    ? "conservative-fallback"
    : "model-metadata";
  const effectiveContextWindowTokens = Math.min(
    advertisedContextWindow ?? CONSERVATIVE_CONTEXT_WINDOW_TOKENS,
    MAX_EFFECTIVE_CONTEXT_WINDOW_TOKENS,
  );
  const desiredOutputTokens = request.phase === "hidden-continuity"
    ? HIDDEN_CONTINUITY_MAX_OUTPUT_TOKENS
    : request.phase === "memory-evidence"
      ? MEMORY_EVIDENCE_MAX_OUTPUT_TOKENS
      : request.reasoningEnabled
        ? VISIBLE_REASONING_MAX_OUTPUT_TOKENS
        : VISIBLE_RESPONSE_MAX_OUTPUT_TOKENS;
  const advertisedMaxOutputTokens = readMatchingMaxOutputTokens(request);
  const maxOutputTokens = Math.min(
    desiredOutputTokens,
    advertisedMaxOutputTokens ?? desiredOutputTokens,
    Math.max(0, effectiveContextWindowTokens - MODEL_CALL_SAFETY_RESERVE_TOKENS),
  );

  return {
    effectiveContextWindowTokens,
    inputBudgetTokens: Math.max(
      0,
      effectiveContextWindowTokens - maxOutputTokens - MODEL_CALL_SAFETY_RESERVE_TOKENS,
    ),
    maxOutputTokens,
    safetyReserveTokens: MODEL_CALL_SAFETY_RESERVE_TOKENS,
    source,
  };
}

function readMatchingContextWindow(request: ResolveModelCallBudgetRequest): number | undefined {
  if (!isMatchingModelInfo(request) || !isPositiveFiniteNumber(request.modelInfo?.contextWindow)) {
    return undefined;
  }
  return Math.floor(request.modelInfo.contextWindow);
}

function readMatchingMaxOutputTokens(request: ResolveModelCallBudgetRequest): number | undefined {
  if (!isMatchingModelInfo(request) || !isPositiveFiniteNumber(request.modelInfo?.maxOutputTokens)) {
    return undefined;
  }
  return Math.floor(request.modelInfo.maxOutputTokens);
}

function isMatchingModelInfo(request: ResolveModelCallBudgetRequest): boolean {
  return request.modelInfo?.id === request.model && request.modelInfo.providerId === request.providerId;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
