export type HiddenContinuityMode = "off" | "economical" | "full";

export interface HiddenContinuityPlanRequest {
  mode: HiddenContinuityMode;
  selectedModel: string;
  economicalModel?: string;
}

export interface HiddenContinuityPlan {
  mode: HiddenContinuityMode;
  expectedCallCount: 1 | 2;
  hiddenModel?: string;
  visibleModel: string;
}

export function resolveHiddenContinuityPlan(request: HiddenContinuityPlanRequest): HiddenContinuityPlan {
  const visibleModel = request.selectedModel.trim();
  if (!visibleModel) {
    throw new Error("A visible response model is required.");
  }

  if (request.mode === "off") {
    return { mode: request.mode, expectedCallCount: 1, visibleModel };
  }

  if (request.mode === "economical") {
    const economicalModel = request.economicalModel?.trim();
    if (!economicalModel) {
      throw new Error("Select an economical model before enabling economical hidden continuity.");
    }
    return {
      mode: request.mode,
      expectedCallCount: 2,
      hiddenModel: economicalModel,
      visibleModel,
    };
  }

  return {
    mode: request.mode,
    expectedCallCount: 2,
    hiddenModel: visibleModel,
    visibleModel,
  };
}
