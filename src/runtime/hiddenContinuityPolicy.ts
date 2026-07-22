/**
 * `full` and `economical` are accepted only so persisted pre-evidence-brief
 * settings can migrate without breaking a local profile. The live runtime
 * normalizes both to the sole supported two-call behavior.
 */
export type HiddenContinuityMode = "off" | "evidence-brief" | "economical" | "full";
export type ActiveTwoCallMemoryMode = "off" | "evidence-brief";

export const MEMORY_EVIDENCE_RECENT_MESSAGE_COUNT = 4;

export interface HiddenContinuityPlanRequest {
  mode: HiddenContinuityMode;
  selectedModel: string;
  messageCount?: number;
  /** Deprecated and deliberately ignored. The tested tactic uses one model. */
  economicalModel?: string;
}

export interface HiddenContinuityPlan {
  mode: ActiveTwoCallMemoryMode;
  expectedCallCount: 1 | 2;
  analysisModel?: string;
  visibleModel: string;
  recentMessageCount: number;
}

export function resolveHiddenContinuityPlan(request: HiddenContinuityPlanRequest): HiddenContinuityPlan {
  const visibleModel = request.selectedModel.trim();
  if (!visibleModel) {
    throw new Error("A visible response model is required.");
  }

  const mode: ActiveTwoCallMemoryMode = request.mode === "off" ? "off" : "evidence-brief";
  const hasOlderMessages = Math.max(0, Math.floor(request.messageCount ?? 0)) >
    MEMORY_EVIDENCE_RECENT_MESSAGE_COUNT;

  if (mode === "off" || !hasOlderMessages) {
    return {
      mode,
      expectedCallCount: 1,
      recentMessageCount: MEMORY_EVIDENCE_RECENT_MESSAGE_COUNT,
      visibleModel,
    };
  }

  return {
    mode,
    expectedCallCount: 2,
    analysisModel: visibleModel,
    recentMessageCount: MEMORY_EVIDENCE_RECENT_MESSAGE_COUNT,
    visibleModel,
  };
}
