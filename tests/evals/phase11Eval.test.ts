import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  PHASE11_STRATEGIES,
  applyPhase11QualityJudgments,
  buildPhase11ReviewPacket,
  createPhase11BlindId,
  evaluatePhase11Checks,
  parsePhase11LiveArtifact,
  parsePhase11LiveConfig,
  regradePhase11LiveArtifact,
  redactPhase11Text,
  scorePhase11LiveArtifact,
} from "../../src/evals/phase11Eval";
import { runPhase11LiveExperiment } from "../../src/evals/phase11LiveRunner";

const LIVE_CONFIG_URL = new URL("../../evals/phase1.1/live-config.example.json", import.meta.url);

describe("Phase 1.1 two-pass memory-influence eval", () => {
  it("defines one exact Qwen model, paired strategy controls, repeated trials, and paid-run limits", () => {
    const config = exampleConfig();

    expect(config.provider.model).toBe("qwen/qwen3.7-max");
    expect(config.provider.apiKeyEnv).toBe("PHASE11_OPENROUTER_API_KEY");
    expect(config.strategies).toEqual(PHASE11_STRATEGIES);
    expect(config.repetitions).toBeGreaterThanOrEqual(3);
    expect(config.scenarios.length).toBeGreaterThanOrEqual(6);
    expect(new Set(config.scenarios.map((scenario) => scenario.challenge))).toEqual(new Set([
      "knowledge-boundary",
      "knowledge-update",
      "multi-hop",
      "temporal",
      "abstention",
      "constraint-application",
    ]));
    expect(config.limits.maxCalls).toBeGreaterThan(0);
    expect(config.generation.analysisMaxOutputTokens).toBe(1_000);
    expect(config.limits.maxEstimatedOutputTokens).toBeGreaterThanOrEqual(180_000);
    expect(config.limits.maxEstimatedCostUsd).toBeGreaterThan(0);
    const boundaryScenario = config.scenarios.find((scenario) => scenario.challenge === "knowledge-boundary");
    expect(boundaryScenario?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "influence-tracks-corvin-boundary",
        kind: "must-include-all",
        values: ["corvin", "does_not_know"],
      }),
      expect.objectContaining({
        id: "visible-keeps-corvin-uncertain",
        values: expect.arrayContaining(["fishing", "without proof", "without hard evidence", "what opens", "suspicion"]),
      }),
    ]));
    const temporalScenario = config.scenarios.find((scenario) => scenario.challenge === "temporal");
    expect(temporalScenario?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "visible-rejects-detour",
        values: expect.arrayContaining(["direct walk", "locked gate", "missed deadline"]),
      }),
    ]));
  });

  it("scores the influence brief separately from the visible answer", () => {
    const checks = [
      { id: "brief-current-code", target: "influence" as const, kind: "must-include-any" as const, values: ["frost-4"] },
      { id: "brief-boundary", target: "influence" as const, kind: "must-include-all" as const, values: ["corvin", "does_not_know"] },
      { id: "answer-current-code", target: "visible" as const, kind: "must-include-any" as const, values: ["frost-4"] },
      { id: "answer-rejects-stale-code", target: "visible" as const, kind: "must-not-include" as const, values: ["ember-9"] },
    ];

    const results = evaluatePhase11Checks(checks, {
      influenceText: 'Current evidence says FROST-4 superseded the prior rune. {"entity":"Corvin","does_not_know":["the passphrase"]}',
      visibleOutput: "The current lantern rune is FROST-4.",
    });

    expect(results).toEqual([
      expect.objectContaining({ id: "brief-current-code", passed: true }),
      expect.objectContaining({ id: "brief-boundary", passed: true }),
      expect.objectContaining({ id: "answer-current-code", passed: true }),
      expect.objectContaining({ id: "answer-rejects-stale-code", passed: true }),
    ]);
  });

  it("reports paired rescue, harm, influence transmission, and incremental cost instead of unpaired global means", () => {
    const artifact = parsePhase11LiveArtifact(JSON.stringify({
      schemaVersion: 2,
      experimentId: "paired-test",
      createdAt: "2026-07-19T12:00:00.000Z",
      redacted: true,
      runs: [
        run("single-full", "s1", 1, false, null, [call("visible-response", 100, 0.001)]),
        run("evidence-brief-full", "s1", 1, true, true, [call("analysis", 80, 0.0004), call("visible-response", 100, 0.001)]),
        run("single-full", "s2", 1, true, null, [call("visible-response", 100, 0.001)]),
        run("evidence-brief-full", "s2", 1, false, true, [call("analysis", 80, 0.0004), call("visible-response", 100, 0.001)]),
        run("analysis-discarded-full", "s1", 1, true, true, [call("analysis", 80, 0.0004), call("visible-response", 100, 0.001)]),
      ],
      qualityJudgments: [],
    }));

    const score = scorePhase11LiveArtifact(artifact);
    const evidence = score.strategies["evidence-brief-full"];

    expect(evidence.strictPassRate).toBe(0.5);
    expect(evidence.influencePassRate).toBe(1);
    expect(evidence.influenceTransmissionRate).toBe(0.5);
    expect(evidence.comparison).toMatchObject({
      baselineStrategy: "single-full",
      pairedRuns: 2,
      rescues: 1,
      harms: 1,
      strictPassRateDelta: 0,
      addedTokensMeanPerRun: 80,
      addedCostMeanUsdPerRun: { status: "known", amountUsd: 0.0004 },
    });
    expect(score.strategies["analysis-discarded-full"]).toMatchObject({
      influencePassRate: 1,
      influenceTransmissionRate: null,
    });
  });

  it("builds a strategy-blind review packet and requires complete, same-scenario judgments", () => {
    const config = exampleConfig();
    const artifact = parsePhase11LiveArtifact(JSON.stringify({
      schemaVersion: 2,
      experimentId: config.experimentId,
      createdAt: "2026-07-19T12:00:00.000Z",
      redacted: true,
      runs: [
        run("single-full", config.scenarios[0].id, 1, true, null, [call("visible-response", 100, 0.001)]),
        run("evidence-brief-full", config.scenarios[0].id, 1, true, true, [call("analysis", 80, 0.0004), call("visible-response", 100, 0.001)]),
      ],
      qualityJudgments: [],
    }));

    const packet = buildPhase11ReviewPacket(config, artifact);
    expect(packet.pairs).toHaveLength(1);
    expect(JSON.stringify(packet)).not.toMatch(/single-full|evidence-brief-full|strategy/i);

    expect(() => applyPhase11QualityJudgments(artifact, JSON.stringify({
      schemaVersion: 2,
      ratings: [],
      preferences: [],
    }))).toThrow(/complete rating/i);
  });

  it("keeps provider failures in reliability totals but excludes their pair from causal quality comparison", () => {
    const artifact = parsePhase11LiveArtifact(JSON.stringify({
      schemaVersion: 2,
      experimentId: "infra-exclusion-test",
      createdAt: "2026-07-19T12:00:00.000Z",
      redacted: true,
      runs: [
        run("single-full", "s1", 1, false, null, [call("visible-response", 100, 0.001)]),
        run("evidence-brief-full", "s1", 1, true, true, [call("analysis", 80, 0.0004), call("visible-response", 100, 0.001)]),
        run("single-full", "s2", 1, true, null, [call("visible-response", 100, 0.001)]),
        run("evidence-brief-full", "s2", 1, false, false, [failedCall("analysis"), call("visible-response", 100, 0.001)]),
      ],
      qualityJudgments: [],
    }));

    const evidence = scorePhase11LiveArtifact(artifact).strategies["evidence-brief-full"];
    expect(evidence.runCount).toBe(2);
    expect(evidence.calls.analysis.failures).toBe(1);
    expect(evidence.comparison).toMatchObject({
      pairedRuns: 1,
      rescues: 1,
      harms: 0,
      strictPassRateDelta: 1,
    });
  });

  it("regrades a paid artifact from current scenario checks without changing model outputs or call telemetry", () => {
    const config = exampleConfig();
    const scenario = config.scenarios.find((candidate) => candidate.id === "superseded-lantern-rune")!;
    const originalRun = {
      ...run("single-full", scenario.id, 1, false, null, [call("visible-response", 100, 0.001)]),
      visibleOutput: "You speak FROST-4 and the lantern ignites.",
    };
    const artifact = parsePhase11LiveArtifact(JSON.stringify({
      schemaVersion: 2,
      experimentId: config.experimentId,
      createdAt: "2026-07-19T12:00:00.000Z",
      redacted: true,
      runs: [originalRun],
      qualityJudgments: [],
    }));

    const regraded = regradePhase11LiveArtifact(config, artifact);

    expect(regraded.runs[0]).toMatchObject({
      visibleOutput: originalRun.visibleOutput,
      calls: originalRun.calls,
      strictPassed: true,
      checks: [
        { id: "visible-uses-current-rune", target: "visible", passed: true },
        { id: "visible-omits-obsolete-rune", target: "visible", passed: true },
      ],
    });
  });

  it("passes an evidence brief into call two while the discarded-analysis control withholds it", async () => {
    const config = exampleConfig();
    const requestBodies: Array<{
      messages: Array<{ role: string; content: string }>;
      reasoning?: { enabled?: boolean };
      response_format?: {
        type: string;
        json_schema?: { name?: string; strict?: boolean; schema?: Record<string, unknown> };
      };
    }> = [];
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
      requestBodies.push(body);
      const system = body.messages.find((message) => message.role === "system")?.content ?? "";
      const isAnalysis = /evidence analyst/i.test(system);
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: isAnalysis
              ? JSON.stringify({
                  relevant_evidence: [{ source_id: "m01", fact: "ADVISOR-BRIEF-OMEGA", status: "active" }],
                  knowledge_boundaries: [],
                  uncertainties: [],
                  response_constraints: ["Respect ADVISOR-BRIEF-OMEGA"],
                  response_plan: ["Use the current evidence"],
                })
              : "ADVISOR-BRIEF-OMEGA",
          },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    await runPhase11LiveExperiment({
      ...config,
      readyForPaidRuns: true,
      repetitions: 1,
      scenarios: [config.scenarios[0]],
    }, {
      environment: { PHASE11_OPENROUTER_API_KEY: "unit-test-secret" },
      fetchImpl,
      strategyFilter: ["evidence-brief-full", "analysis-discarded-full"],
      now: () => "2026-07-19T12:00:00.000Z",
      monotonicNow: monotonicClock(),
    });

    const analysisBodies = requestBodies.filter((body) =>
      /evidence analyst/i.test(body.messages.find((message) => message.role === "system")?.content ?? ""));
    expect(analysisBodies).toHaveLength(2);
    expect(analysisBodies[0]).toMatchObject({
      reasoning: { enabled: false },
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "phase11_evidence_brief",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              relevant_evidence: { maxItems: 8 },
              knowledge_boundaries: { maxItems: 6 },
              uncertainties: { maxItems: 4 },
              response_constraints: { maxItems: 6 },
              response_plan: { maxItems: 4 },
            },
            required: [
              "relevant_evidence",
              "knowledge_boundaries",
              "uncertainties",
              "response_constraints",
              "response_plan",
            ],
          },
        },
      },
    });

    const visiblePrompts = requestBodies
      .filter((body) => !/evidence analyst/i.test(body.messages.find((message) => message.role === "system")?.content ?? ""))
      .map((body) => body.messages[body.messages.length - 1]?.content ?? "");
    expect(visiblePrompts).toHaveLength(2);
    expect(visiblePrompts.filter((prompt) => prompt.includes("ADVISOR-BRIEF-OMEGA"))).toHaveLength(1);
  });

  it("keeps paid calls opt-in, rejects the committed config, and redacts credential material", async () => {
    const config = exampleConfig();
    const fetchImpl = vi.fn(() => { throw new Error("fetch must not be reached"); }) as typeof fetch;

    await expect(runPhase11LiveExperiment(config, { environment: {}, fetchImpl })).rejects.toThrow(/readyForPaidRuns/i);
    expect(fetchImpl).not.toHaveBeenCalled();

    const redacted = redactPhase11Text(
      "Authorization: Bearer secret-token-value api_key=super-private-value https://user:pass@example.test/v1",
    );
    expect(redacted).not.toMatch(/secret-token|super-private|user:pass/i);
    expect(redacted).toMatch(/REDACTED/);
  });

  it("records a length-finished educator response as truncation and withholds it from call two", async () => {
    const config = exampleConfig();
    const requestBodies: Array<{ messages: Array<{ role: string; content: string }> }> = [];
    const validBrief = JSON.stringify({
      relevant_evidence: [{ source_id: "m04", fact: "FROST-4 is current.", status: "active" }],
      knowledge_boundaries: [],
      uncertainties: [],
      response_constraints: ["Use FROST-4."],
      response_plan: ["Activate the lantern."],
    });
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
      requestBodies.push(body);
      const system = body.messages.find((message) => message.role === "system")?.content ?? "";
      const isAnalysis = /evidence analyst/i.test(system);
      return new Response(JSON.stringify({
        choices: [{
          message: { content: isAnalysis ? validBrief : "The current rune is FROST-4." },
          finish_reason: isAnalysis ? "length" : "stop",
        }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    const artifact = await runPhase11LiveExperiment({
      ...config,
      readyForPaidRuns: true,
      repetitions: 1,
      scenarios: [config.scenarios[1]],
    }, {
      environment: { PHASE11_OPENROUTER_API_KEY: "unit-test-secret" },
      fetchImpl,
      strategyFilter: ["evidence-brief-full"],
      now: () => "2026-07-19T12:00:00.000Z",
      monotonicNow: monotonicClock(),
    });

    expect(artifact.runs[0].influenceText).toBeNull();
    expect(artifact.runs[0].calls[0]).toMatchObject({
      phase: "analysis",
      status: "error",
      failure: { message: expect.stringMatching(/truncat|length/i) },
    });
    const visiblePrompt = requestBodies[1].messages[requestBodies[1].messages.length - 1]?.content ?? "";
    expect(visiblePrompt).not.toContain("FROST-4 is current");
  });

  it("validates full multi-run artifacts without truncating them during the credential scan", () => {
    const longOutput = "x".repeat(60_000);
    const artifact = parsePhase11LiveArtifact(JSON.stringify({
      schemaVersion: 2,
      experimentId: "large-artifact-test",
      createdAt: "2026-07-19T12:00:00.000Z",
      redacted: true,
      runs: [
        { ...run("single-full", "s1", 1, true, null, [call("visible-response", 100, 0.001)]), visibleOutput: longOutput },
        { ...run("single-full", "s2", 1, true, null, [call("visible-response", 100, 0.001)]), visibleOutput: longOutput },
      ],
      qualityJudgments: [],
    }));

    expect(artifact.runs).toHaveLength(2);
  });
});

function exampleConfig() {
  return parsePhase11LiveConfig(readFileSync(LIVE_CONFIG_URL, "utf8"));
}

function run(
  strategy: (typeof PHASE11_STRATEGIES)[number],
  scenarioId: string,
  repetition: number,
  strictPassed: boolean,
  influencePassed: boolean | null,
  calls: Array<ReturnType<typeof call> | ReturnType<typeof failedCall>>,
) {
  const influenceChecks = influencePassed === null ? [] : [{ id: "influence", target: "influence", passed: influencePassed }];
  return {
    id: `run-${strategy}-${scenarioId}-${repetition}`,
    blindId: createPhase11BlindId(`test:${strategy}:${scenarioId}:${String(repetition)}`),
    scenarioId,
    challenge: "knowledge-update" as const,
    strategy,
    repetition,
    executionOrder: 1,
    influenceText: influencePassed === null ? null : "redacted influence",
    visibleOutput: "redacted output",
    checks: [
      ...influenceChecks,
      { id: "visible", target: "visible", passed: strictPassed },
    ],
    strictPassed,
    calls,
  };
}

function call(phase: "analysis" | "visible-response", totalTokens: number, amountUsd: number) {
  return {
    phase,
    provider: "openrouter",
    model: "qwen/qwen3.7-max",
    status: "success" as const,
    durationMs: phase === "analysis" ? 400 : 800,
    usage: { inputTokens: totalTokens - 20, outputTokens: 20, totalTokens, source: "provider" as const },
    cost: { status: "known" as const, currency: "USD" as const, amountUsd, pricingSnapshotId: "qwen-2026-07-19" },
    failure: null,
  };
}

function failedCall(phase: "analysis" | "visible-response") {
  return {
    phase,
    provider: "openrouter",
    model: "qwen/qwen3.7-max",
    status: "error" as const,
    durationMs: 400,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, source: "unavailable" as const },
    cost: { status: "unknown" as const, currency: "USD" as const },
    failure: { category: "rate-limit" as const, message: "Provider returned HTTP 429." },
  };
}

function monotonicClock(): () => number {
  let value = 0;
  return () => {
    value += 100;
    return value;
  };
}
