import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  assertPhase1EvalReleaseThresholds,
  createPhase1ArtifactManifest,
  createPhase1EvalProvenance,
  parsePhase1EvalCorpusJsonl,
  parsePhase1PricingManifest,
  recordDeterministicPhase1Corpus,
  scorePhase1EvalCorpus,
  serializePhase1EvalCorpus,
  validateRecordedPhase1Corpus,
} from "../../src/evals/phase1Eval";

const CORPUS_URL = new URL("../../evals/phase1/corpus.jsonl", import.meta.url);
const BASELINE_URL = new URL("../../evals/phase1/baseline.json", import.meta.url);
const PRICING_URL = new URL("../../evals/phase1/pricing.json", import.meta.url);
const MANIFEST_URL = new URL("../../evals/phase1/manifest.json", import.meta.url);

function loadArtifacts() {
  const corpusRaw = readFileSync(CORPUS_URL, "utf8");
  const pricingRaw = readFileSync(PRICING_URL, "utf8");
  const pricing = parsePhase1PricingManifest(pricingRaw);
  const turns = validateRecordedPhase1Corpus(parsePhase1EvalCorpusJsonl(corpusRaw), pricing);
  const provenance = createPhase1EvalProvenance(corpusRaw, pricingRaw);
  return { corpusRaw, pricingRaw, pricing, turns, provenance };
}

describe("Phase 1 runtime-derived corpus", () => {
  it("re-records deterministically through all three real adapter code paths", async () => {
    const artifacts = loadArtifacts();
    const recorded = await recordDeterministicPhase1Corpus(artifacts.pricing);

    expect(serializePhase1EvalCorpus(recorded)).toBe(artifacts.corpusRaw);
    expect(recorded).toHaveLength(36);
    expect(new Set(recorded.map((turn) => turn.recording.adapterPath))).toEqual(new Set([
      "mock-text-provider",
      "openai-compatible-fetch",
      "tauri-stored-secret-invoke",
    ]));
    expect(recorded.every((turn) => turn.recording.source === "deterministic-runtime")).toBe(true);
    expect(recorded.every((turn) => turn.calls.every((call) => call.latencySource === "simulated"))).toBe(true);
    expect(recorded.some((turn) => turn.calls.some((call) => call.usage.source === "provider"))).toBe(true);
    expect(recorded.some((turn) => turn.hiddenContinuityMode === "off" && turn.calls.length === 1)).toBe(true);
    expect(recorded.some((turn) => turn.calls.some((call) => call.phase === "visible-response" && call.status === "error"))).toBe(true);
    expect(recorded.some((turn) =>
      turn.provider.profile === "mock" &&
      turn.calls.some((call) => call.status === "error" && call.failureOrigin === "offline-injected"),
    )).toBe(true);
  });

  it("derives observations from runtime output, extraction policy, lore engine, and event replay", () => {
    const { turns, provenance, pricing } = loadArtifacts();
    const scorecard = scorePhase1EvalCorpus(turns, provenance);
    const blanked = structuredClone(turns);
    for (const turn of blanked) {
      turn.output.visibleText = "";
    }
    const blankedScorecard = scorePhase1EvalCorpus(blanked, provenance);

    expect(blankedScorecard.quality.knowledgeLeakDetectionRecall).not.toBe(
      scorecard.quality.knowledgeLeakDetectionRecall,
    );
    expect(scorecard.quality.lorePrecision).toBeLessThan(1);
    expect(scorecard.quality.loreRecall).toBeGreaterThan(0);
    expect(scorecard.quality.trueOutputLeakRate).toBeGreaterThan(0);
    expect(scorecard.quality.branchAndRegenerationContinuity).toBeGreaterThan(0);

    const tamperedProposals = structuredClone(turns);
    const mutationTurn = tamperedProposals.find((turn) => turn.expected.acceptedMutationProposalIds.length > 0);
    expect(mutationTurn).toBeDefined();
    const visibleCall = mutationTurn?.calls.find((call) => call.phase === "visible-response");
    if (visibleCall) visibleCall.stateProposals = [];
    expect(() => validateRecordedPhase1Corpus(tamperedProposals, pricing)).toThrow(/proposal evidence/i);
  });

  it("rejects spoofed provider provenance and insufficient scenario diversity", () => {
    const { turns, pricing } = loadArtifacts();
    const spoofed = structuredClone(turns);
    spoofed[0].recording.source = "live-provider";
    spoofed[0].provider.profile = "stored-secret-openai-compatible";
    expect(() => validateRecordedPhase1Corpus(spoofed, pricing)).toThrow(/provider|provenance/i);

    const duplicated = structuredClone(turns);
    for (const turn of duplicated) turn.scenarioKind = "mutation-grounded";
    expect(() => validateRecordedPhase1Corpus(duplicated, pricing)).toThrow(/scenario/i);
  });

  it("rejects broader credential formats before parsing or recording", () => {
    const { corpusRaw } = loadArtifacts();
    const firstLine = corpusRaw.trim().split(/\r?\n/, 1)[0];
    const secretSamples = [
      "ghp_abcdefghijklmnopqrstuvwxyz1234567890",
      "AKIAIOSFODNN7EXAMPLE",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturevalue",
      "-----BEGIN PRIVATE KEY-----",
      "https://localhost/?access_token=credentialvalue123",
    ];

    for (const secret of secretSamples) {
      const record = JSON.parse(firstLine) as { input: { text: string } };
      record.input.text = secret;
      expect(() => parsePhase1EvalCorpusJsonl(JSON.stringify(record))).toThrow(/credential|secret|redact/i);
    }
  });
});

describe("Phase 1 scorecard and artifact gate", () => {
  it("matches hashed artifacts, includes provider/phase detail, and clears release thresholds", () => {
    const artifacts = loadArtifacts();
    const scorecard = scorePhase1EvalCorpus(artifacts.turns, artifacts.provenance);
    const baseline = JSON.parse(readFileSync(BASELINE_URL, "utf8"));
    const manifest = JSON.parse(readFileSync(MANIFEST_URL, "utf8"));

    expect(scorecard).toEqual(baseline);
    expect(createPhase1ArtifactManifest(artifacts.turns, artifacts.provenance)).toEqual(manifest);
    expect(scorecard.provenance.corpusSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(scorecard.provenance.pricingManifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(scorecard.calls["hidden-continuity"]).toMatchObject({
      p50LatencyMs: expect.any(Number),
      p95LatencyMs: expect.any(Number),
      stateProposalCount: expect.any(Number),
      appliedProposalCount: expect.any(Number),
    });
    expect(scorecard.calls["hidden-continuity"].stateProposalCount).toBeGreaterThan(0);
    expect(scorecard.calls["hidden-continuity"].appliedProposalCount).toBeGreaterThan(0);
    expect(scorecard.calls["hidden-continuity"].blockedProposalCount).toBeGreaterThan(0);
    expect(scorecard.providers.mock.calls["visible-response"].attempts).toBe(12);
    expect(scorecard.providers["openai-compatible"].quality).toBeDefined();
    expect(() => assertPhase1EvalReleaseThresholds(scorecard)).not.toThrow();
  });

  it("fails when thresholds regress or artifact hashes change", () => {
    const artifacts = loadArtifacts();
    const scorecard = scorePhase1EvalCorpus(artifacts.turns, artifacts.provenance);

    expect(() => assertPhase1EvalReleaseThresholds({
      ...scorecard,
      quality: { ...scorecard.quality, mutationPrecision: 0 },
    })).toThrow(/mutation precision/i);

    const changed = createPhase1EvalProvenance(`${artifacts.corpusRaw}\n`, artifacts.pricingRaw);
    expect(changed.corpusSha256).not.toBe(scorecard.provenance.corpusSha256);
  });

  it("keeps pricing rates auditable and recomputes cost from recorded usage", () => {
    const { pricing, turns } = loadArtifacts();
    expect(pricing.rates["openai-compatible"]).toMatchObject({
      rateKind: "synthetic-offline",
      effectiveDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      source: expect.any(String),
      inputUsdPerMillionTokens: expect.any(Number),
      outputUsdPerMillionTokens: expect.any(Number),
    });

    const call = turns
      .find((turn) => turn.provider.profile === "openai-compatible")
      ?.calls.find((candidate) => candidate.phase === "visible-response");
    expect(call?.cost.status).toBe("computed");
    expect(call?.cost.amountUsd).toBeGreaterThan(0);
  });
});
