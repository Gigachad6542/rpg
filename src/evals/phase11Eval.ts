import { z } from "zod";

import {
  LORE_LITERAL_MATCH_BEHAVIORS,
  LORE_MATCH_MODES,
  selectActiveLorebookEntries,
  type LoreTriggerBook,
  type LoreTriggerEntry,
} from "../runtime/loreTriggerEngine";

export const PHASE11_LIVE_MODES = ["off", "economical", "full"] as const;
const CALL_PHASES = ["hidden-continuity", "visible-response"] as const;
const PROFILE_CLASSES = ["strong-hosted", "economical-hosted", "local-openai-compatible"] as const;

const PricingSnapshotSchema = z.object({
  id: z.string().trim().min(1).max(160),
  model: z.string().trim().min(1).max(300),
  currency: z.literal("USD"),
  inputUsdPerMillionTokens: z.number().finite().nonnegative(),
  outputUsdPerMillionTokens: z.number().finite().nonnegative(),
  source: z.string().trim().min(1).max(500),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict();

const LiveProfileSchema = z.object({
  id: z.string().trim().min(1).max(160),
  class: z.enum(PROFILE_CLASSES),
  baseUrl: z.string().url().max(2_000),
  apiKeyEnv: z.string().regex(/^[A-Z][A-Z0-9_]{2,100}$/).optional(),
  visibleModel: z.string().trim().min(1).max(300),
  economicalModel: z.string().trim().min(1).max(300),
  pricing: z.array(PricingSnapshotSchema).min(1).max(16),
}).strict().superRefine((profile, context) => {
  for (const model of new Set([profile.visibleModel, profile.economicalModel])) {
    if (!profile.pricing.some((snapshot) => snapshot.model === model)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Profile ${profile.id} needs an exact pricing snapshot for ${model}.`,
        path: ["pricing"],
      });
    }
  }
  const url = new URL(profile.baseUrl);
  if (url.username || url.password) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Provider URLs may not contain credentials.", path: ["baseUrl"] });
  }
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (profile.class === "local-openai-compatible" && !loopback) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Local profiles must use a loopback URL.", path: ["baseUrl"] });
  }
  if (profile.class !== "local-openai-compatible" && url.protocol !== "https:") {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Hosted profiles must use HTTPS.", path: ["baseUrl"] });
  }
});

const LiveScenarioSchema = z.object({
  id: z.string().trim().min(1).max(160),
  title: z.string().trim().min(1).max(300),
  systemPrompt: z.string().trim().min(1).max(20_000),
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1).max(20_000),
  }).strict()).min(2).max(100),
  userMessage: z.string().trim().min(1).max(20_000),
  referenceFacts: z.array(z.string().trim().min(1).max(2_000)).min(1).max(100),
}).strict();

const LiveConfigSchema = z.object({
  schemaVersion: z.literal(1),
  experimentId: z.string().trim().min(1).max(160),
  readyForPaidRuns: z.boolean(),
  modes: z.array(z.enum(PHASE11_LIVE_MODES)).length(3),
  profiles: z.array(LiveProfileSchema).length(3),
  scenarios: z.array(LiveScenarioSchema).min(3).max(100),
}).strict().superRefine((config, context) => {
  if (config.modes.some((mode, index) => mode !== PHASE11_LIVE_MODES[index])) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Modes must be off, economical, full in canonical order.", path: ["modes"] });
  }
  if (new Set(config.profiles.map((profile) => profile.class)).size !== PROFILE_CLASSES.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Profiles must cover all three model classes.", path: ["profiles"] });
  }
  assertUnique(config.profiles.map((profile) => profile.id), "profile", context, ["profiles"]);
  assertUnique(config.scenarios.map((scenario) => scenario.id), "scenario", context, ["scenarios"]);
});

const UsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().max(50_000_000),
  outputTokens: z.number().int().nonnegative().max(50_000_000),
  totalTokens: z.number().int().nonnegative().max(100_000_000),
  source: z.enum(["provider", "estimated", "unavailable"]),
}).strict().superRefine((usage, context) => {
  if (usage.totalTokens !== usage.inputTokens + usage.outputTokens) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Token totals must reconcile.", path: ["totalTokens"] });
  }
});

const CallCostSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.enum(["known", "estimated"]),
    currency: z.literal("USD"),
    amountUsd: z.number().finite().nonnegative(),
    pricingSnapshotId: z.string().trim().min(1).max(160).optional(),
  }).strict(),
  z.object({ status: z.literal("unknown"), currency: z.literal("USD") }).strict(),
]);

const FailureSchema = z.object({
  category: z.enum(["aborted", "authentication", "rate-limit", "network", "validation", "provider", "unknown"]),
  message: z.string().trim().min(1).max(240),
}).strict();

const LiveCallSchema = z.object({
  phase: z.enum(CALL_PHASES),
  provider: z.string().trim().min(1).max(160),
  model: z.string().trim().min(1).max(300),
  status: z.enum(["success", "error"]),
  timeToFirstTokenMs: z.number().finite().nonnegative().max(3_600_000).nullable(),
  durationMs: z.number().finite().nonnegative().max(3_600_000),
  usage: UsageSchema,
  cost: CallCostSchema,
  failure: FailureSchema.nullable(),
  proposalCount: z.number().int().nonnegative().max(100_000),
}).strict().superRefine((call, context) => {
  if ((call.status === "error") !== (call.failure !== null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Call status and failure must agree.", path: ["failure"] });
  }
});

const LiveRunSchema = z.object({
  id: z.string().trim().min(1).max(160),
  blindId: z.string().trim().min(1).max(160),
  scenarioId: z.string().trim().min(1).max(160),
  profileId: z.string().trim().min(1).max(160),
  mode: z.enum(PHASE11_LIVE_MODES),
  visibleOutput: z.string().max(100_000),
  qualityScore: z.number().finite().min(1).max(5).nullable(),
  calls: z.array(LiveCallSchema).min(1).max(2),
}).strict().superRefine((run, context) => {
  const visible = run.calls.filter((call) => call.phase === "visible-response");
  const hidden = run.calls.filter((call) => call.phase === "hidden-continuity");
  const expectedHidden = run.mode === "off" ? 0 : 1;
  if (visible.length !== 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Each run must contain exactly one visible call.", path: ["calls"] });
  }
  if (hidden.length !== expectedHidden) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: `${run.mode} requires exactly ${expectedHidden} hidden call(s).`, path: ["calls"] });
  }
  if (expectedHidden === 1 && run.calls[0]?.phase !== "hidden-continuity") {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "The hidden call must precede the visible call.", path: ["calls"] });
  }
});

const PairwisePreferenceSchema = z.object({
  scenarioId: z.string().trim().min(1).max(160),
  profileId: z.string().trim().min(1).max(160),
  winnerBlindId: z.string().trim().min(1).max(160),
  loserBlindId: z.string().trim().min(1).max(160),
}).strict().refine((preference) => preference.winnerBlindId !== preference.loserBlindId, {
  message: "A pairwise preference needs two different blind outputs.",
});

const LiveArtifactSchema = z.object({
  schemaVersion: z.literal(1),
  experimentId: z.string().trim().min(1).max(160),
  createdAt: z.string().datetime(),
  redacted: z.literal(true),
  runs: z.array(LiveRunSchema).min(1).max(100_000),
  pairwisePreferences: z.array(PairwisePreferenceSchema).max(100_000).default([]),
}).strict().superRefine((artifact, context) => {
  const blindIds = new Set(artifact.runs.map((run) => run.blindId));
  artifact.pairwisePreferences.forEach((preference, index) => {
    if (!blindIds.has(preference.winnerBlindId) || !blindIds.has(preference.loserBlindId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Pairwise preferences must reference recorded blind ids.", path: ["pairwisePreferences", index] });
    }
  });
});

export type Phase11LiveConfig = z.infer<typeof LiveConfigSchema>;
export type Phase11LiveArtifact = z.infer<typeof LiveArtifactSchema>;
export type Phase11LiveRun = z.infer<typeof LiveRunSchema>;

export function parsePhase11LiveConfig(raw: string): Phase11LiveConfig {
  assertNoRawCredentialFields(raw);
  return LiveConfigSchema.parse(JSON.parse(raw));
}

export function parsePhase11LiveArtifact(raw: string): Phase11LiveArtifact {
  assertNoCredentialMaterial(raw);
  return LiveArtifactSchema.parse(JSON.parse(raw));
}

const QualityJudgmentsSchema = z.object({
  schemaVersion: z.literal(1),
  ratings: z.array(z.object({
    blindId: z.string().trim().min(1).max(160),
    coherence: z.number().finite().min(1).max(5),
    agency: z.number().finite().min(1).max(5),
    repetition: z.number().finite().min(1).max(5),
    pacing: z.number().finite().min(1).max(5),
    characterConsistency: z.number().finite().min(1).max(5),
  }).strict()).max(100_000),
  preferences: z.array(z.object({
    winnerBlindId: z.string().trim().min(1).max(160),
    loserBlindId: z.string().trim().min(1).max(160),
  }).strict()).max(100_000),
}).strict();

export function applyPhase11QualityJudgments(
  artifact: Phase11LiveArtifact,
  rawJudgments: string,
): Phase11LiveArtifact {
  const judgments = QualityJudgmentsSchema.parse(JSON.parse(rawJudgments));
  const runs = new Map(artifact.runs.map((run) => [run.blindId, run]));
  const ratings = new Map(judgments.ratings.map((rating) => [rating.blindId, rating]));
  for (const blindId of [...ratings.keys(), ...judgments.preferences.flatMap((item) => [item.winnerBlindId, item.loserBlindId])]) {
    if (!runs.has(blindId)) {
      throw new Error(`Judgment references unknown blind id ${blindId}.`);
    }
  }
  const updated: Phase11LiveArtifact = {
    ...artifact,
    runs: artifact.runs.map((run) => {
      const rating = ratings.get(run.blindId);
      if (!rating) return run;
      return {
        ...run,
        qualityScore: round((rating.coherence + rating.agency + rating.repetition + rating.pacing + rating.characterConsistency) / 5),
      };
    }),
    pairwisePreferences: judgments.preferences.map((preference) => {
      const winner = runs.get(preference.winnerBlindId)!;
      const loser = runs.get(preference.loserBlindId)!;
      if (winner.scenarioId !== loser.scenarioId || winner.profileId !== loser.profileId) {
        throw new Error("Pairwise judgments must compare the same scenario and profile.");
      }
      return {
        scenarioId: winner.scenarioId,
        profileId: winner.profileId,
        winnerBlindId: preference.winnerBlindId,
        loserBlindId: preference.loserBlindId,
      };
    }),
  };
  return LiveArtifactSchema.parse(updated);
}

export interface Phase11CallSummary {
  attempts: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  durationMeanMs: number | null;
  timeToFirstTokenMeanMs: number | null;
  proposalCount: number;
}

export interface Phase11ModeSummary {
  runCount: number;
  calls: Record<(typeof CALL_PHASES)[number], Phase11CallSummary>;
  totalCostUsd: number;
  unknownCostCalls: number;
  qualityMean: number | null;
  qualityGainVsOff: number | null;
  pairwiseWinRateVsOff: number | null;
  comparisonVsOff: Phase11ComparisonVsOff | null;
}

export interface Phase11ComparisonVsOff {
  addedTokensMeanPerRun: number;
  addedDurationMeanMsPerRun: number;
  addedCostMeanUsdPerRun:
    | { status: "known" | "estimated"; amountUsd: number }
    | { status: "unknown" };
}

export interface Phase11LiveScorecard {
  modes: Record<(typeof PHASE11_LIVE_MODES)[number], Phase11ModeSummary>;
  profiles: Record<string, Record<(typeof PHASE11_LIVE_MODES)[number], Phase11ModeSummary>>;
}

export function scorePhase11LiveArtifact(artifact: Phase11LiveArtifact): Phase11LiveScorecard {
  const modes = summarizeModes(artifact.runs, artifact.pairwisePreferences);
  const profiles: Phase11LiveScorecard["profiles"] = {};
  for (const profileId of new Set(artifact.runs.map((run) => run.profileId))) {
    const profileRuns = artifact.runs.filter((run) => run.profileId === profileId);
    const blindIds = new Set(profileRuns.map((run) => run.blindId));
    profiles[profileId] = summarizeModes(
      profileRuns,
      artifact.pairwisePreferences.filter((preference) =>
        blindIds.has(preference.winnerBlindId) && blindIds.has(preference.loserBlindId)),
    );
  }
  return { modes, profiles };
}

export function redactPhase11Text(value: string): string {
  return value
    .replace(/-----BEGIN[ _-]+(?:RSA[ _-]+|EC[ _-]+|OPENSSH[ _-]+)?PRIVATE[ _-]+KEY-----[\s\S]*?-----END[ _-]+(?:RSA[ _-]+|EC[ _-]+|OPENSSH[ _-]+)?PRIVATE[ _-]+KEY-----/gi, "[REDACTED_PRIVATE_KEY]")
    .replace(/\bAuthorization\s*:\s*Bearer\s+[^\s,;]+/gi, "Authorization: Bearer [REDACTED]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk-|gh[pousr]_)[A-Za-z0-9_-]{8,}\b/gi, "[REDACTED_TOKEN]")
    .replace(/\b(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|password|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/https?:\/\/[^\s/:@]+:[^\s/@]+@/gi, "https://[REDACTED]@")
    .slice(0, 100_000);
}

const CampaignTurnSchema = z.object({
  index: z.number().int().positive().max(100),
  operation: z.enum(["play", "edit", "regenerate", "branch", "restart", "model-switch"]),
  input: z.string().trim().min(1).max(5_000),
  expected: z.array(z.string().trim().min(1).max(2_000)).min(1).max(30),
}).strict();

const CampaignSchema = z.object({
  id: z.string().trim().min(1).max(160),
  title: z.string().trim().min(1).max(300),
  turns: z.array(CampaignTurnSchema).min(50).max(100),
}).strict().superRefine((campaign, context) => {
  campaign.turns.forEach((turn, index) => {
    if (turn.index !== index + 1) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Campaign turn indices must be contiguous.", path: ["turns", index, "index"] });
    }
  });
});

const CompactCampaignSchema = z.object({
  id: z.string().trim().min(1).max(160),
  title: z.string().trim().min(1).max(300),
  turnCount: z.number().int().min(50).max(100),
  defaultInput: z.string().trim().min(1).max(5_000),
  defaultExpected: z.array(z.string().trim().min(1).max(2_000)).min(1).max(30),
  milestones: z.array(CampaignTurnSchema).min(5).max(100),
}).strict();

const CampaignFixtureSchema = z.object({
  schemaVersion: z.literal(1),
  campaigns: z.array(CompactCampaignSchema).length(3),
}).strict();

export type LongSessionCampaign = z.infer<typeof CampaignSchema>;

export function parseLongSessionCampaignFixtures(raw: string): LongSessionCampaign[] {
  return CampaignFixtureSchema.parse(JSON.parse(raw)).campaigns.map((fixture) => {
    const milestones = new Map(fixture.milestones.map((turn) => [turn.index, turn]));
    return CampaignSchema.parse({
      id: fixture.id,
      title: fixture.title,
      turns: Array.from({ length: fixture.turnCount }, (_, index) => milestones.get(index + 1) ?? {
        index: index + 1,
        operation: "play",
        input: `${fixture.defaultInput} [turn ${index + 1}]`,
        expected: fixture.defaultExpected,
      }),
    });
  });
}

export function assertLongSessionCampaignCoverage(campaigns: readonly LongSessionCampaign[]): void {
  if (campaigns.length !== 3) {
    throw new Error("Phase 1.1 requires exactly three long-session campaign fixtures.");
  }
  const required = new Set(["edit", "regenerate", "branch", "restart", "model-switch"]);
  for (const campaign of campaigns) {
    const operations = new Set(campaign.turns.map((turn) => turn.operation));
    const missing = [...required].filter((operation) => !operations.has(operation as LongSessionCampaign["turns"][number]["operation"]));
    if (missing.length > 0) {
      throw new Error(`Campaign ${campaign.id} is missing operations: ${missing.join(", ")}.`);
    }
  }
}

const LoreDecisionSchema = z.object({
  text: z.string().min(1).max(20_000),
  expectedActive: z.boolean(),
}).strict();

const LoreCaseSchema = z.object({
  id: z.string().trim().min(1).max(160),
  keys: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
  aliases: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  secondaryKeys: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  matchMode: z.enum(LORE_MATCH_MODES).default("literal"),
  literalMatchBehavior: z.enum(LORE_LITERAL_MATCH_BEHAVIORS).optional(),
  wholeWord: z.boolean().default(false),
  decisions: z.array(LoreDecisionSchema).min(1).max(10),
}).strict();

const LoreCorpusSchema = z.object({
  schemaVersion: z.literal(1),
  cases: z.array(LoreCaseSchema).min(1).max(120),
}).strict();

export type LoreDecisionCorpus = z.infer<typeof LoreCorpusSchema>;

export function parseLoreDecisionCorpus(raw: string): LoreDecisionCorpus {
  return LoreCorpusSchema.parse(JSON.parse(raw));
}

export function scoreLoreDecisionCorpus(corpus: LoreDecisionCorpus) {
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let trueNegative = 0;
  for (const testCase of corpus.cases) {
    const entry: LoreTriggerEntry = {
      id: testCase.id,
      title: testCase.id,
      keys: [...testCase.keys],
      aliases: [...testCase.aliases],
      secondaryKeys: [...testCase.secondaryKeys],
      content: `Lore for ${testCase.id}`,
      insertionOrder: 100,
      priority: 0,
      enabled: true,
      constant: false,
      probability: 100,
      matchMode: testCase.matchMode,
      wholeWord: testCase.wholeWord,
      literalMatchBehavior: testCase.literalMatchBehavior,
    };
    const book: LoreTriggerBook = {
      id: `book-${testCase.id}`,
      enabled: true,
      scanDepth: 4,
      tokenBudget: 2_000,
      recursiveScanning: false,
      entries: [entry],
    };
    for (const decision of testCase.decisions) {
      const predicted = selectActiveLorebookEntries({ lorebooks: [book], messages: [], draft: decision.text }).length > 0;
      if (predicted && decision.expectedActive) truePositive += 1;
      else if (predicted) falsePositive += 1;
      else if (decision.expectedActive) falseNegative += 1;
      else trueNegative += 1;
    }
  }
  return {
    decisionCount: truePositive + falsePositive + falseNegative + trueNegative,
    truePositive,
    falsePositive,
    falseNegative,
    trueNegative,
    precision: ratio(truePositive, truePositive + falsePositive),
    recall: ratio(truePositive, truePositive + falseNegative),
  };
}

function summarizeModes(
  runs: readonly Phase11LiveRun[],
  preferences: readonly z.infer<typeof PairwisePreferenceSchema>[],
): Record<(typeof PHASE11_LIVE_MODES)[number], Phase11ModeSummary> {
  const runByBlindId = new Map(runs.map((run) => [run.blindId, run]));
  const result = {} as Record<(typeof PHASE11_LIVE_MODES)[number], Phase11ModeSummary>;
  for (const mode of PHASE11_LIVE_MODES) {
    const modeRuns = runs.filter((run) => run.mode === mode);
    const calls = modeRuns.flatMap((run) => run.calls);
    const quality = modeRuns.map((run) => run.qualityScore).filter((score): score is number => score !== null);
    result[mode] = {
      runCount: modeRuns.length,
      calls: {
        "hidden-continuity": summarizeCalls(calls.filter((call) => call.phase === "hidden-continuity")),
        "visible-response": summarizeCalls(calls.filter((call) => call.phase === "visible-response")),
      },
      totalCostUsd: round(calls.reduce((total, call) => total + (call.cost.status === "unknown" ? 0 : call.cost.amountUsd), 0)),
      unknownCostCalls: calls.filter((call) => call.cost.status === "unknown").length,
      qualityMean: mean(quality),
      qualityGainVsOff: null,
      pairwiseWinRateVsOff: null,
      comparisonVsOff: null,
    };
  }
  const offRuns = runs.filter((run) => run.mode === "off");
  const offComparisonInput = summarizeComparisonInput(offRuns);
  const offQuality = result.off.qualityMean;
  for (const mode of PHASE11_LIVE_MODES) {
    result[mode].qualityGainVsOff = offQuality === null || result[mode].qualityMean === null
      ? null
      : round(result[mode].qualityMean - offQuality);
    const comparisons = preferences.filter((preference) => {
      const winner = runByBlindId.get(preference.winnerBlindId);
      const loser = runByBlindId.get(preference.loserBlindId);
      return winner && loser && new Set([winner.mode, loser.mode]).size === 2 &&
        [winner.mode, loser.mode].includes("off") && [winner.mode, loser.mode].includes(mode);
    });
    result[mode].pairwiseWinRateVsOff = mode === "off" || comparisons.length === 0
      ? null
      : round(comparisons.filter((preference) => runByBlindId.get(preference.winnerBlindId)?.mode === mode).length / comparisons.length);
    if (mode !== "off") {
      const modeComparisonInput = summarizeComparisonInput(runs.filter((run) => run.mode === mode));
      if (offComparisonInput && modeComparisonInput) {
        result[mode].comparisonVsOff = {
          addedTokensMeanPerRun: round(modeComparisonInput.tokensMeanPerRun - offComparisonInput.tokensMeanPerRun),
          addedDurationMeanMsPerRun: round(modeComparisonInput.durationMeanMsPerRun - offComparisonInput.durationMeanMsPerRun),
          addedCostMeanUsdPerRun: subtractCostMeans(modeComparisonInput.costMeanUsdPerRun, offComparisonInput.costMeanUsdPerRun),
        };
      }
    }
  }
  return result;
}

function summarizeComparisonInput(runs: readonly Phase11LiveRun[]): {
  tokensMeanPerRun: number;
  durationMeanMsPerRun: number;
  costMeanUsdPerRun: { status: "known" | "estimated"; amountUsd: number } | { status: "unknown" };
} | null {
  if (runs.length === 0) {
    return null;
  }
  const calls = runs.flatMap((run) => run.calls);
  const hasUnknownCost = calls.some((call) => call.cost.status === "unknown");
  const recordedCost = calls.reduce(
    (total, call) => total + (call.cost.status === "unknown" ? 0 : call.cost.amountUsd),
    0,
  );
  return {
    tokensMeanPerRun: round(mean(runs.map((run) =>
      run.calls.reduce((total, call) => total + call.usage.totalTokens, 0))) ?? 0),
    durationMeanMsPerRun: round(mean(runs.map((run) =>
      run.calls.reduce((total, call) => total + call.durationMs, 0))) ?? 0),
    costMeanUsdPerRun: hasUnknownCost
      ? { status: "unknown" }
      : {
          status: calls.some((call) => call.cost.status === "estimated") ? "estimated" : "known",
          amountUsd: round(recordedCost / runs.length),
        },
  };
}

function subtractCostMeans(
  current: { status: "known" | "estimated"; amountUsd: number } | { status: "unknown" },
  baseline: { status: "known" | "estimated"; amountUsd: number } | { status: "unknown" },
): Phase11ComparisonVsOff["addedCostMeanUsdPerRun"] {
  if (current.status === "unknown" || baseline.status === "unknown") {
    return { status: "unknown" };
  }
  return {
    status: current.status === "estimated" || baseline.status === "estimated" ? "estimated" : "known",
    amountUsd: round(current.amountUsd - baseline.amountUsd),
  };
}

function summarizeCalls(calls: Phase11LiveRun["calls"]): Phase11CallSummary {
  return {
    attempts: calls.length,
    failures: calls.filter((call) => call.status === "error").length,
    inputTokens: calls.reduce((total, call) => total + call.usage.inputTokens, 0),
    outputTokens: calls.reduce((total, call) => total + call.usage.outputTokens, 0),
    durationMeanMs: mean(calls.map((call) => call.durationMs)),
    timeToFirstTokenMeanMs: mean(calls.flatMap((call) => call.timeToFirstTokenMs ?? [])),
    proposalCount: calls.reduce((total, call) => total + call.proposalCount, 0),
  };
}

function assertNoRawCredentialFields(raw: string): void {
  if (/"(?:apiKey|authorization|token|password|secret)"\s*:/i.test(raw)) {
    throw new Error("Live eval config may name an API-key environment variable but may not contain raw credentials.");
  }
}

function assertNoCredentialMaterial(raw: string): void {
  if (redactPhase11Text(raw) !== raw) {
    throw new Error("Live eval artifact contains credential-like material and must be redacted.");
  }
}

function assertUnique(values: readonly string[], label: string, context: z.RefinementCtx, path: (string | number)[]): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: `${label} ids must be unique.`, path });
  }
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : round(values.reduce((total, value) => total + value, 0) / values.length);
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : round(numerator / denominator);
}

function round(value: number): number {
  return Number(value.toFixed(12));
}
