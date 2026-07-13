import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  PHASE11_LIVE_MODES,
  assertLongSessionCampaignCoverage,
  parseLongSessionCampaignFixtures,
  parsePhase11LiveArtifact,
  parsePhase11LiveConfig,
  redactPhase11Text,
  scorePhase11LiveArtifact,
} from "../../src/evals/phase11Eval";

const LIVE_CONFIG_URL = new URL("../../evals/phase1.1/live-config.example.json", import.meta.url);
const CAMPAIGNS_URL = new URL("../../evals/phase1.1/long-session-campaigns.json", import.meta.url);

describe("Phase 1.1 live-model A/B contract", () => {
  it("defines three target classes, all three call modes, and exact per-model price snapshots", () => {
    const config = parsePhase11LiveConfig(readFileSync(LIVE_CONFIG_URL, "utf8"));

    expect(config.profiles.map((profile) => profile.class).sort()).toEqual([
      "economical-hosted",
      "local-openai-compatible",
      "strong-hosted",
    ]);
    expect(config.modes).toEqual(PHASE11_LIVE_MODES);
    for (const profile of config.profiles) {
      expect(profile.pricing.some((snapshot) => snapshot.model === profile.visibleModel)).toBe(true);
      expect(profile.pricing.some((snapshot) => snapshot.model === profile.economicalModel)).toBe(true);
    }
  });

  it("accepts only the one-call/two-call contract and reports hidden and visible phases separately", () => {
    const artifact = parsePhase11LiveArtifact(JSON.stringify({
      schemaVersion: 1,
      experimentId: "phase11-test",
      createdAt: "2026-07-13T12:00:00.000Z",
      redacted: true,
      runs: [
        run("off", [call("visible-response", "strong-model", 900, 0.001)], 3),
        run("economical", [
          call("hidden-continuity", "economical-model", 400, 0.0001),
          call("visible-response", "strong-model", 850, 0.001),
        ], 4),
        run("full", [
          call("hidden-continuity", "strong-model", 700, 0.0008),
          call("visible-response", "strong-model", 800, 0.001),
        ], 4.5),
      ],
    }));
    const scorecard = scorePhase11LiveArtifact(artifact);

    expect(scorecard.modes.off.calls["hidden-continuity"].attempts).toBe(0);
    expect(scorecard.modes.economical.calls["hidden-continuity"].attempts).toBe(1);
    expect(scorecard.modes.full.calls["visible-response"].attempts).toBe(1);
    expect(scorecard.modes.full.qualityMean).toBe(4.5);
    expect(scorecard.modes.full.qualityGainVsOff).toBe(1.5);
    expect(scorecard.modes.full.totalCostUsd).toBeCloseTo(0.0018);

    expect(() => parsePhase11LiveArtifact(JSON.stringify({
      ...artifact,
      runs: [{ ...artifact.runs[0], calls: [] }],
    }))).toThrow(/exactly one visible/i);
  });

  it("redacts credential-like material before an artifact can be serialized", () => {
    const redacted = redactPhase11Text(
      "Authorization: Bearer secret-token-value api_key=super-private-value https://user:pass@example.test/v1",
    );

    expect(redacted).not.toMatch(/secret-token|super-private|user:pass/i);
    expect(redacted).toMatch(/REDACTED/);
  });
});

describe("Phase 1.1 long-session fixtures", () => {
  it("provides three 50-100-turn campaigns with edit, regeneration, branch, restart, and model-switch coverage", () => {
    const campaigns = parseLongSessionCampaignFixtures(readFileSync(CAMPAIGNS_URL, "utf8"));

    expect(campaigns).toHaveLength(3);
    expect(() => assertLongSessionCampaignCoverage(campaigns)).not.toThrow();
    for (const campaign of campaigns) {
      expect(campaign.turns.length).toBeGreaterThanOrEqual(50);
      expect(campaign.turns.length).toBeLessThanOrEqual(100);
    }
  });
});

function run(mode: "off" | "economical" | "full", calls: ReturnType<typeof call>[], qualityScore: number) {
  return {
    id: `run-${mode}`,
    blindId: `blind-${mode}`,
    scenarioId: "scenario-1",
    profileId: "strong-hosted",
    mode,
    visibleOutput: `Synthetic ${mode} output`,
    qualityScore,
    calls,
  };
}

function call(phase: "hidden-continuity" | "visible-response", model: string, durationMs: number, amountUsd: number) {
  return {
    phase,
    provider: "openai-compatible",
    model,
    status: "success" as const,
    timeToFirstTokenMs: phase === "visible-response" ? 120 : null,
    durationMs,
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, source: "provider" as const },
    cost: { status: "known" as const, currency: "USD" as const, amountUsd },
    failure: null,
    proposalCount: phase === "hidden-continuity" ? 2 : 0,
  };
}
