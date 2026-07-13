import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  assertPhase1EvalReleaseThresholds,
  parsePhase1EvalCorpusJsonl,
  scorePhase1EvalCorpus,
  validateRecordedPhase1Corpus,
} from "../../src/evals/phase1Eval";
import {
  makePhase1EvalTurn,
  type EvalProviderProfile,
} from "../fixtures/phase1EvalFixtures";

const CORPUS_URL = new URL("../../evals/phase1/corpus.jsonl", import.meta.url);
const REQUIRED_PROVIDER_PROFILES: EvalProviderProfile[] = [
  "mock",
  "openai-compatible",
  "stored-secret-openai-compatible",
];

describe("Phase 1 recorded eval corpus", () => {
  it("matches the committed scorecard and clears the explicit Phase 1 release floor", () => {
    const turns = parsePhase1EvalCorpusJsonl(readFileSync(CORPUS_URL, "utf8"));
    const scorecard = scorePhase1EvalCorpus(turns);
    const baseline = JSON.parse(readFileSync(new URL("../../evals/phase1/baseline.json", import.meta.url), "utf8"));

    expect(scorecard).toEqual(baseline);
    expect(() => assertPhase1EvalReleaseThresholds(scorecard)).not.toThrow();
    expect(() => assertPhase1EvalReleaseThresholds({
      ...scorecard,
      quality: { ...scorecard.quality, mutationPrecision: 0.69 },
    })).toThrow(/mutation precision/i);
  });

  it("contains 30-50 redacted turns across representative provider paths", () => {
    const rawCorpus = readFileSync(CORPUS_URL, "utf8");
    const turns = parsePhase1EvalCorpusJsonl(rawCorpus);

    expect(() => validateRecordedPhase1Corpus(turns)).not.toThrow();
    expect(turns.length).toBeGreaterThanOrEqual(30);
    expect(turns.length).toBeLessThanOrEqual(50);

    const providerCounts = new Map<string, number>();
    for (const turn of turns) {
      providerCounts.set(turn.provider.profile, (providerCounts.get(turn.provider.profile) ?? 0) + 1);
      expect(turn.recording.redacted).toBe(true);
      expect(turn.recording.secretsRemoved).toBe(true);
    }
    for (const profile of REQUIRED_PROVIDER_PROFILES) {
      expect(providerCounts.get(profile) ?? 0).toBeGreaterThanOrEqual(8);
    }

    expect(rawCorpus).not.toMatch(/authorization\s*:/i);
    expect(rawCorpus).not.toMatch(/\b(?:sk|key)-[A-Za-z0-9_-]{12,}\b/);
    expect(rawCorpus).not.toMatch(/bearer\s+[A-Za-z0-9._-]{12,}/i);
  });

  it("records hidden and visible call telemetry without conflating the two phases", () => {
    const turns = parsePhase1EvalCorpusJsonl(readFileSync(CORPUS_URL, "utf8"));

    for (const turn of turns) {
      const hiddenCalls = turn.calls.filter((call) => call.phase === "hidden-continuity");
      const visibleCalls = turn.calls.filter((call) => call.phase === "visible-response");
      expect(visibleCalls).toHaveLength(1);
      expect(hiddenCalls).toHaveLength(turn.hiddenContinuityMode === "off" ? 0 : 1);

      for (const call of turn.calls) {
        expect(call.latencyMs).toBeGreaterThanOrEqual(0);
        expect(call.usage.totalTokens).toBe(call.usage.inputTokens + call.usage.outputTokens);
        expect(["provider", "estimated"]).toContain(call.usage.source);
        expect(call.cost.currency).toBe("USD");
        expect(call.cost.amountUsd === null || call.cost.amountUsd >= 0).toBe(true);
        expect(Array.isArray(call.stateProposals)).toBe(true);
        if (call.status === "error") {
          expect(call.errorCode).toBeTruthy();
        }
      }
    }

    const scorecard = scorePhase1EvalCorpus(turns);
    expect(scorecard.calls["hidden-continuity"].attempts).toBeGreaterThan(0);
    expect(scorecard.calls["visible-response"].attempts).toBe(turns.length);
    expect(scorecard.calls["hidden-continuity"]).toMatchObject({
      inputTokens: expect.any(Number),
      outputTokens: expect.any(Number),
      totalTokens: expect.any(Number),
      totalKnownCostUsd: expect.any(Number),
      unknownCostCalls: expect.any(Number),
      failures: expect.any(Number),
      failureRate: expect.any(Number),
      meanLatencyMs: expect.any(Number),
    });
    expect(scorecard.calls["visible-response"]).toMatchObject({
      inputTokens: expect.any(Number),
      outputTokens: expect.any(Number),
      totalTokens: expect.any(Number),
      totalKnownCostUsd: expect.any(Number),
      unknownCostCalls: expect.any(Number),
      failures: expect.any(Number),
      failureRate: expect.any(Number),
      meanLatencyMs: expect.any(Number),
    });
  });

  it("covers mutation, knowledge, lore, branch, regeneration, and failure scenarios", () => {
    const turns = parsePhase1EvalCorpusJsonl(readFileSync(CORPUS_URL, "utf8"));
    const checkpoints = new Set(turns.map((turn) => turn.expected.continuity.checkpoint));

    expect(turns.some((turn) => turn.expected.acceptedMutationProposalIds.length > 0)).toBe(true);
    expect(turns.some((turn) => turn.expected.knowledgeLeak)).toBe(true);
    expect(turns.some((turn) => turn.expected.loreEntryIds.length > 0)).toBe(true);
    expect(checkpoints).toEqual(new Set(["normal", "branch", "regeneration"]));
    expect(turns.some((turn) => turn.calls.some((call) => call.status === "error"))).toBe(true);
    expect(turns.some((turn) => turn.hiddenContinuityMode === "economical")).toBe(true);
    expect(turns.some((turn) => turn.hiddenContinuityMode === "off")).toBe(true);
  });

  it("rejects malformed telemetry and secret-bearing records", () => {
    const invalidTokens = makePhase1EvalTurn({ id: "invalid-tokens" });
    const [firstCall] = invalidTokens.calls as Array<Record<string, unknown>>;
    firstCall.usage = {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 99,
      source: "provider",
    };

    expect(() => parsePhase1EvalCorpusJsonl(JSON.stringify(invalidTokens))).toThrow(/token/i);

    const leakedSecret = makePhase1EvalTurn({ id: "leaked-secret" });
    (leakedSecret.input as Record<string, unknown>).text = "Authorization: Bearer secret-fixture-value";
    expect(() => parsePhase1EvalCorpusJsonl(JSON.stringify(leakedSecret))).toThrow(/secret|credential|redact/i);
  });
});

describe("Phase 1 deterministic scorecard", () => {
  it("computes quality metrics from gold labels and observed results", () => {
    const turns = [
      makePhase1EvalTurn({
        id: "score-1",
        expectedMutationProposalIds: ["m1"],
        hiddenAppliedProposalIds: ["m1", "m2"],
        expectedLoreEntryIds: ["lore-a", "lore-b"],
        observedLoreEntryIds: ["lore-a"],
      }),
      makePhase1EvalTurn({
        id: "score-2",
        checkpoint: "branch",
        expectedMutationProposalIds: ["m3", "m4"],
        visibleAppliedProposalIds: ["m3"],
        expectedKnowledgeLeak: true,
        detectedKnowledgeLeak: true,
        expectedLoreEntryIds: ["lore-c"],
        observedLoreEntryIds: ["lore-c", "lore-extra"],
      }),
      makePhase1EvalTurn({
        id: "score-3",
        checkpoint: "regeneration",
        expectedKnowledgeLeak: false,
        detectedKnowledgeLeak: true,
        continuityMatches: false,
        hiddenStatus: "error",
      }),
      makePhase1EvalTurn({
        id: "score-4",
        checkpoint: "branch",
        expectedMutationProposalIds: ["m5", "m6"],
        visibleAppliedProposalIds: ["m5"],
        expectedKnowledgeLeak: true,
        detectedKnowledgeLeak: false,
        expectedLoreEntryIds: ["lore-e"],
        continuityMatches: false,
        visibleStatus: "error",
      }),
    ];

    const scorecard = scorePhase1EvalCorpus(turns);

    expect(scorecard.turns).toBe(4);
    expect(scorecard.quality.mutationPrecision).toBeCloseTo(0.75, 8);
    expect(scorecard.quality.mutationRecall).toBeCloseTo(0.6, 8);
    expect(scorecard.quality.knowledgeLeakRate).toBeCloseTo(0.5, 8);
    expect(scorecard.quality.knowledgeLeakDetectionPrecision).toBeCloseTo(0.5, 8);
    expect(scorecard.quality.knowledgeLeakDetectionRecall).toBeCloseTo(0.5, 8);
    expect(scorecard.quality.loreHitRate).toBeCloseTo(0.5, 8);
    expect(scorecard.quality.branchContinuity).toBeCloseTo(0.5, 8);
    expect(scorecard.quality.regenerationContinuity).toBeCloseTo(0, 8);
    expect(scorecard.quality.branchAndRegenerationContinuity).toBeCloseTo(1 / 3, 8);
  });

  it("aggregates call usage, cost, latency, and failures by phase", () => {
    const turns = [
      makePhase1EvalTurn({
        id: "telemetry-1",
        hiddenInputTokens: 10,
        hiddenOutputTokens: 2,
        visibleInputTokens: 20,
        visibleOutputTokens: 4,
        hiddenLatencyMs: 100,
        visibleLatencyMs: 300,
        hiddenCostUsd: 0.01,
        visibleCostUsd: 0.03,
      }),
      makePhase1EvalTurn({
        id: "telemetry-2",
        hiddenInputTokens: 30,
        hiddenOutputTokens: 6,
        visibleInputTokens: 40,
        visibleOutputTokens: 8,
        hiddenLatencyMs: 200,
        visibleLatencyMs: 500,
        hiddenCostUsd: null,
        visibleCostUsd: 0.05,
        hiddenStatus: "error",
        visibleStatus: "error",
      }),
    ];

    const scorecard = scorePhase1EvalCorpus(turns);

    expect(scorecard.calls["hidden-continuity"]).toEqual({
      attempts: 2,
      successes: 1,
      failures: 1,
      failureRate: 0.5,
      inputTokens: 40,
      outputTokens: 8,
      totalTokens: 48,
      totalKnownCostUsd: 0.01,
      unknownCostCalls: 1,
      meanLatencyMs: 150,
    });
    expect(scorecard.calls["visible-response"]).toEqual({
      attempts: 2,
      successes: 1,
      failures: 1,
      failureRate: 0.5,
      inputTokens: 60,
      outputTokens: 12,
      totalTokens: 72,
      totalKnownCostUsd: 0.08,
      unknownCostCalls: 0,
      meanLatencyMs: 400,
    });
  });

  it("returns null for ratios whose denominator has no eligible examples", () => {
    const scorecard = scorePhase1EvalCorpus([
      makePhase1EvalTurn({
        id: "empty-denominators",
        hiddenContinuityMode: "off",
      }),
    ]);

    expect(scorecard.quality.mutationPrecision).toBeNull();
    expect(scorecard.quality.mutationRecall).toBeNull();
    expect(scorecard.quality.knowledgeLeakDetectionPrecision).toBeNull();
    expect(scorecard.quality.knowledgeLeakDetectionRecall).toBeNull();
    expect(scorecard.quality.loreHitRate).toBeNull();
    expect(scorecard.quality.branchContinuity).toBeNull();
    expect(scorecard.quality.regenerationContinuity).toBeNull();
    expect(scorecard.quality.branchAndRegenerationContinuity).toBeNull();
  });
});
