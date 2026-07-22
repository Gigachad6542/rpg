import type { TextReasoningObservation } from "../providers/TextModelAdapter";
import type { ModelCallRecord } from "./runtimeTypes";

/** Session-only reasoning traces. This map is deliberately outside persisted runtime state. */
export type ModelReasoningTraceMap = Readonly<Record<string, TextReasoningObservation>>;

export const MAX_SESSION_REASONING_TRACES = 24;

export function addReasoningTrace(
  current: ModelReasoningTraceMap,
  key: string,
  observation: TextReasoningObservation,
): ModelReasoningTraceMap {
  const entries = Object.entries(current).filter(([existingKey]) => existingKey !== key);
  entries.push([key, observation]);
  return Object.fromEntries(entries.slice(-MAX_SESSION_REASONING_TRACES));
}

export function modelReasoningTraceKey(runId: string, phase: ModelCallRecord["phase"]): string {
  return `${runId}:${phase}`;
}
