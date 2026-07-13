export type EvalProviderProfile =
  | "mock"
  | "openai-compatible"
  | "stored-secret-openai-compatible";

export type EvalCheckpoint = "normal" | "branch" | "regeneration";

export interface Phase1EvalFixtureOptions {
  id: string;
  providerProfile?: EvalProviderProfile;
  hiddenContinuityMode?: "off" | "economical" | "full";
  checkpoint?: EvalCheckpoint;
  expectedMutationProposalIds?: string[];
  hiddenAppliedProposalIds?: string[];
  visibleAppliedProposalIds?: string[];
  expectedKnowledgeLeak?: boolean;
  detectedKnowledgeLeak?: boolean;
  expectedLoreEntryIds?: string[];
  observedLoreEntryIds?: string[];
  continuityMatches?: boolean;
  hiddenStatus?: "success" | "error";
  visibleStatus?: "success" | "error";
  hiddenInputTokens?: number;
  hiddenOutputTokens?: number;
  visibleInputTokens?: number;
  visibleOutputTokens?: number;
  hiddenLatencyMs?: number;
  visibleLatencyMs?: number;
  hiddenCostUsd?: number | null;
  visibleCostUsd?: number | null;
}

/**
 * Test-only record builder for deterministic scoring examples. The committed
 * Phase 1 corpus is JSONL so it can be appended by an opt-in recorder without
 * importing application code or serializing provider credentials.
 */
export function makePhase1EvalTurn(options: Phase1EvalFixtureOptions): Record<string, unknown> {
  const providerProfile = options.providerProfile ?? "mock";
  const hiddenContinuityMode = options.hiddenContinuityMode ?? "full";
  const checkpoint = options.checkpoint ?? "normal";
  const expectedFingerprint = `state-${options.id}`;
  const actualFingerprint = options.continuityMatches === false
    ? `different-${options.id}`
    : expectedFingerprint;
  const hiddenInputTokens = options.hiddenInputTokens ?? 10;
  const hiddenOutputTokens = options.hiddenOutputTokens ?? 5;
  const visibleInputTokens = options.visibleInputTokens ?? 20;
  const visibleOutputTokens = options.visibleOutputTokens ?? 10;

  const calls: Array<Record<string, unknown>> = [];
  if (hiddenContinuityMode !== "off") {
    calls.push(makeCall({
      id: `${options.id}-hidden`,
      phase: "hidden-continuity",
      providerProfile,
      model: hiddenContinuityMode === "economical" ? "economical-fixture-model" : "fixture-model",
      status: options.hiddenStatus ?? "success",
      latencyMs: options.hiddenLatencyMs ?? 100,
      inputTokens: hiddenInputTokens,
      outputTokens: hiddenOutputTokens,
      costUsd: options.hiddenCostUsd === undefined ? 0.001 : options.hiddenCostUsd,
      appliedProposalIds: options.hiddenAppliedProposalIds ?? [],
    }));
  }
  calls.push(makeCall({
    id: `${options.id}-visible`,
    phase: "visible-response",
    providerProfile,
    model: "fixture-model",
    status: options.visibleStatus ?? "success",
    latencyMs: options.visibleLatencyMs ?? 200,
    inputTokens: visibleInputTokens,
    outputTokens: visibleOutputTokens,
    costUsd: options.visibleCostUsd === undefined ? 0.002 : options.visibleCostUsd,
    appliedProposalIds: options.visibleAppliedProposalIds ?? [],
  }));

  return {
    schemaVersion: 1,
    id: options.id,
    scenarioId: `scenario-${options.id}`,
    turnIndex: 1,
    recordedAt: "2026-07-12T12:00:00.000Z",
    recording: {
      source: "deterministic-replay",
      redacted: true,
      secretsRemoved: true,
    },
    provider: {
      profile: providerProfile,
      providerId: `${providerProfile}-fixture`,
      model: "fixture-model",
    },
    hiddenContinuityMode,
    input: {
      text: "I inspect the north gate.",
      cardId: "card-phase1",
      chatId: "chat-phase1",
      branchId: checkpoint === "branch" ? "branch-fork" : "branch-main",
    },
    output: {
      visibleText: "The north gate stands open.",
    },
    calls,
    expected: {
      acceptedMutationProposalIds: options.expectedMutationProposalIds ?? [],
      knowledgeLeak: options.expectedKnowledgeLeak ?? false,
      loreEntryIds: options.expectedLoreEntryIds ?? [],
      continuity: {
        checkpoint,
        stateFingerprint: expectedFingerprint,
      },
    },
    observed: {
      knowledgeLeakDetected: options.detectedKnowledgeLeak ?? false,
      loreEntryIds: options.observedLoreEntryIds ?? [],
      continuityStateFingerprint: actualFingerprint,
    },
  };
}

interface MakeCallOptions {
  id: string;
  phase: "hidden-continuity" | "visible-response";
  providerProfile: EvalProviderProfile;
  model: string;
  status: "success" | "error";
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  appliedProposalIds: string[];
}

function makeCall(options: MakeCallOptions): Record<string, unknown> {
  return {
    id: options.id,
    phase: options.phase,
    provider: options.providerProfile,
    model: options.model,
    status: options.status,
    ...(options.status === "error" ? { errorCode: "fixture_failure" } : {}),
    latencyMs: options.latencyMs,
    usage: {
      inputTokens: options.inputTokens,
      outputTokens: options.outputTokens,
      totalTokens: options.inputTokens + options.outputTokens,
      source: "provider",
    },
    cost: {
      amountUsd: options.costUsd,
      currency: "USD",
      status: options.costUsd === null ? "unknown" : "computed",
      pricingSnapshotId: options.costUsd === null ? null : "fixture-pricing-2026-07-12",
    },
    stateProposals: options.appliedProposalIds.map((id) => ({
      id,
      kind: "inventory",
      provenance: "player-action",
      applied: true,
    })),
  };
}
