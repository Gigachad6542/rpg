import { z } from "zod";

export const PHASE11_STRATEGIES = [
  "single-full",
  "single-window",
  "analysis-discarded-full",
  "legacy-continuity-full",
  "evidence-brief-full",
  "evidence-brief-window",
] as const;

export const PHASE11_CHALLENGES = [
  "knowledge-boundary",
  "knowledge-update",
  "multi-hop",
  "temporal",
  "abstention",
  "constraint-application",
] as const;

const CALL_PHASES = ["analysis", "visible-response"] as const;
const CHECK_TARGETS = ["influence", "visible"] as const;
const CHECK_KINDS = ["must-include-any", "must-include-all", "must-not-include"] as const;

const PricingSnapshotSchema = z.object({
  id: z.string().trim().min(1).max(160),
  currency: z.literal("USD"),
  inputUsdPerMillionTokens: z.number().finite().nonnegative(),
  outputUsdPerMillionTokens: z.number().finite().nonnegative(),
  source: z.string().trim().url().max(2_000),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict();

const ProviderSchema = z.object({
  id: z.literal("openrouter"),
  baseUrl: z.string().url().max(2_000),
  apiKeyEnv: z.string().regex(/^[A-Z][A-Z0-9_]{2,100}$/),
  model: z.string().trim().min(1).max(300),
  pricing: PricingSnapshotSchema,
  requestTimeoutMs: z.number().int().min(1_000).max(300_000),
}).strict().superRefine((provider, context) => {
  const url = new URL(provider.baseUrl);
  if (url.protocol !== "https:") {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "The hosted eval endpoint must use HTTPS.", path: ["baseUrl"] });
  }
  if (url.username || url.password) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Provider URLs may not contain credentials.", path: ["baseUrl"] });
  }
});

const GenerationSchema = z.object({
  baseSeed: z.number().int().min(0).max(2_147_483_647),
  analysisTemperature: z.number().finite().min(0).max(2),
  visibleTemperature: z.number().finite().min(0).max(2),
  analysisMaxOutputTokens: z.number().int().min(64).max(20_000),
  visibleMaxOutputTokens: z.number().int().min(64).max(20_000),
  recentMessageCount: z.number().int().min(2).max(50),
}).strict();

const LimitsSchema = z.object({
  maxCalls: z.number().int().min(1).max(10_000),
  maxEstimatedInputTokens: z.number().int().min(1).max(100_000_000),
  maxEstimatedOutputTokens: z.number().int().min(1).max(100_000_000),
  maxEstimatedCostUsd: z.number().finite().positive().max(10_000),
}).strict();

const CheckSchema = z.object({
  id: z.string().trim().min(1).max(160),
  target: z.enum(CHECK_TARGETS),
  kind: z.enum(CHECK_KINDS),
  values: z.array(z.string().trim().min(1).max(500)).min(1).max(30),
}).strict();

const ScenarioSchema = z.object({
  id: z.string().trim().min(1).max(160),
  title: z.string().trim().min(1).max(300),
  challenge: z.enum(PHASE11_CHALLENGES),
  systemPrompt: z.string().trim().min(1).max(20_000),
  card: z.object({
    name: z.string().trim().min(1).max(300),
    summary: z.string().trim().min(1).max(4_000),
    memory: z.array(z.object({
      label: z.string().trim().min(1).max(300),
      detail: z.string().trim().min(1).max(2_000),
    }).strict()).max(40),
  }).strict(),
  history: z.array(z.object({
    id: z.string().trim().min(1).max(160),
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(20_000),
  }).strict()).min(6).max(100),
  userMessage: z.string().trim().min(1).max(20_000),
  checks: z.array(CheckSchema).min(2).max(50),
  narrativeRubric: z.array(z.string().trim().min(1).max(1_000)).min(1).max(20),
}).strict().superRefine((scenario, context) => {
  assertUnique(scenario.history.map((message) => message.id), "history message", context, ["history"]);
  assertUnique(scenario.checks.map((check) => check.id), "check", context, ["checks"]);
  for (const target of CHECK_TARGETS) {
    if (!scenario.checks.some((check) => check.target === target)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `Scenario needs at least one ${target} check.`, path: ["checks"] });
    }
  }
});

const LiveConfigSchema = z.object({
  schemaVersion: z.literal(2),
  experimentId: z.string().trim().min(1).max(160),
  readyForPaidRuns: z.boolean(),
  provider: ProviderSchema,
  repetitions: z.number().int().min(1).max(20),
  strategies: z.array(z.enum(PHASE11_STRATEGIES)).length(PHASE11_STRATEGIES.length),
  generation: GenerationSchema,
  limits: LimitsSchema,
  scenarios: z.array(ScenarioSchema).min(PHASE11_CHALLENGES.length).max(100),
}).strict().superRefine((config, context) => {
  if (config.strategies.some((strategy, index) => strategy !== PHASE11_STRATEGIES[index])) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Strategies must be present once in canonical order.", path: ["strategies"] });
  }
  if (new Set(config.scenarios.map((scenario) => scenario.challenge)).size !== PHASE11_CHALLENGES.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Scenarios must cover every memory challenge.", path: ["scenarios"] });
  }
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
    pricingSnapshotId: z.string().trim().min(1).max(160),
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
  durationMs: z.number().finite().nonnegative().max(3_600_000),
  usage: UsageSchema,
  cost: CallCostSchema,
  failure: FailureSchema.nullable(),
}).strict().superRefine((call, context) => {
  if ((call.status === "error") !== (call.failure !== null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Call status and failure must agree.", path: ["failure"] });
  }
});

const CheckResultSchema = z.object({
  id: z.string().trim().min(1).max(160),
  target: z.enum(CHECK_TARGETS),
  passed: z.boolean(),
}).strict();

const LiveRunSchema = z.object({
  id: z.string().trim().min(1).max(300),
  blindId: z.string().trim().min(1).max(160),
  scenarioId: z.string().trim().min(1).max(160),
  challenge: z.enum(PHASE11_CHALLENGES),
  strategy: z.enum(PHASE11_STRATEGIES),
  repetition: z.number().int().positive().max(20),
  executionOrder: z.number().int().positive().max(PHASE11_STRATEGIES.length),
  influenceText: z.string().max(100_000).nullable(),
  visibleOutput: z.string().max(100_000),
  checks: z.array(CheckResultSchema).min(1).max(100),
  strictPassed: z.boolean(),
  calls: z.array(LiveCallSchema).min(1).max(2),
}).strict().superRefine((run, context) => {
  const visibleCalls = run.calls.filter((call) => call.phase === "visible-response");
  const analysisCalls = run.calls.filter((call) => call.phase === "analysis");
  const expectedAnalysis = isSingleCallStrategy(run.strategy) ? 0 : 1;
  if (visibleCalls.length !== 1 || analysisCalls.length !== expectedAnalysis) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${run.strategy} requires exactly ${expectedAnalysis} analysis call(s) and one visible call.`,
      path: ["calls"],
    });
  }
  if (expectedAnalysis === 1 && run.calls[0]?.phase !== "analysis") {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Analysis must precede the visible call.", path: ["calls"] });
  }
  const visibleChecks = run.checks.filter((check) => check.target === "visible");
  if (visibleChecks.length === 0 || run.strictPassed !== visibleChecks.every((check) => check.passed)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "strictPassed must equal all visible checks passing.", path: ["strictPassed"] });
  }
});

const QualityRatingSchema = z.object({
  blindId: z.string().trim().min(1).max(160),
  memoryFidelity: z.number().finite().min(1).max(5),
  continuity: z.number().finite().min(1).max(5),
  characterConsistency: z.number().finite().min(1).max(5),
  agency: z.number().finite().min(1).max(5),
  proseQuality: z.number().finite().min(1).max(5),
}).strict();

const PreferenceSchema = z.object({
  pairId: z.string().trim().min(1).max(300),
  leftBlindId: z.string().trim().min(1).max(160),
  rightBlindId: z.string().trim().min(1).max(160),
  preferredBlindId: z.string().trim().min(1).max(160).nullable(),
}).strict().superRefine((preference, context) => {
  if (preference.leftBlindId === preference.rightBlindId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "A preference needs two different outputs." });
  }
  if (preference.preferredBlindId !== null && ![preference.leftBlindId, preference.rightBlindId].includes(preference.preferredBlindId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "The preference must select the left output, right output, or tie.", path: ["preferredBlindId"] });
  }
});

const LiveArtifactSchema = z.object({
  schemaVersion: z.literal(2),
  experimentId: z.string().trim().min(1).max(160),
  createdAt: z.string().datetime(),
  redacted: z.literal(true),
  runs: z.array(LiveRunSchema).min(1).max(100_000),
  qualityJudgments: z.array(QualityRatingSchema).max(100_000).default([]),
  pairwisePreferences: z.array(PreferenceSchema).max(100_000).default([]),
}).strict().superRefine((artifact, context) => {
  assertUnique(artifact.runs.map((run) => run.id), "run", context, ["runs"]);
  assertUnique(artifact.runs.map((run) => run.blindId), "blind", context, ["runs"]);
  assertUnique(artifact.qualityJudgments.map((rating) => rating.blindId), "quality rating", context, ["qualityJudgments"]);
  assertUnique(artifact.pairwisePreferences.map((preference) => preference.pairId), "preference pair", context, ["pairwisePreferences"]);
  const blindIds = new Set(artifact.runs.map((run) => run.blindId));
  artifact.qualityJudgments.forEach((rating, index) => {
    if (!blindIds.has(rating.blindId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Rating references an unknown blind id.", path: ["qualityJudgments", index] });
    }
  });
  artifact.pairwisePreferences.forEach((preference, index) => {
    if (!blindIds.has(preference.leftBlindId) || !blindIds.has(preference.rightBlindId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Preference references an unknown blind id.", path: ["pairwisePreferences", index] });
    }
  });
});

const QualityJudgmentsSchema = z.object({
  schemaVersion: z.literal(2),
  ratings: z.array(QualityRatingSchema).max(100_000),
  preferences: z.array(PreferenceSchema).max(100_000),
}).strict();

export type Phase11Strategy = (typeof PHASE11_STRATEGIES)[number];
export type Phase11Challenge = (typeof PHASE11_CHALLENGES)[number];
export type Phase11Check = z.infer<typeof CheckSchema>;
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

export function evaluatePhase11Checks(
  checks: readonly Phase11Check[],
  output: { influenceText: string | null; visibleOutput: string },
): Array<z.infer<typeof CheckResultSchema>> {
  return checks.flatMap((check) => {
    if (check.target === "influence" && output.influenceText === null) {
      return [];
    }
    const text = normalizeComparableText(check.target === "influence" ? output.influenceText ?? "" : output.visibleOutput);
    const values = check.values.map(normalizeComparableText);
    const passed = check.kind === "must-include-any"
      ? values.some((value) => text.includes(value))
      : check.kind === "must-include-all"
        ? values.every((value) => text.includes(value))
        : values.every((value) => !text.includes(value));
    return [{ id: check.id, target: check.target, passed }];
  });
}

export function regradePhase11LiveArtifact(
  config: Phase11LiveConfig,
  artifact: Phase11LiveArtifact,
): Phase11LiveArtifact {
  if (artifact.experimentId !== config.experimentId) {
    throw new Error("Cannot regrade an artifact with a different experiment id.");
  }
  const scenarios = new Map(config.scenarios.map((scenario) => [scenario.id, scenario]));
  const runs = artifact.runs.map((run) => {
    const scenario = scenarios.get(run.scenarioId);
    if (!scenario || scenario.challenge !== run.challenge) {
      throw new Error(`Cannot regrade unknown or mismatched scenario ${run.scenarioId}.`);
    }
    const influenceText = isSingleCallStrategy(run.strategy) ? null : run.influenceText ?? "";
    const checks = evaluatePhase11Checks(scenario.checks, {
      influenceText,
      visibleOutput: run.visibleOutput,
    });
    const visibleChecks = checks.filter((check) => check.target === "visible");
    return {
      ...run,
      checks,
      strictPassed: visibleChecks.length > 0 && visibleChecks.every((check) => check.passed),
    };
  });
  return LiveArtifactSchema.parse({ ...artifact, runs });
}

export function applyPhase11QualityJudgments(
  artifact: Phase11LiveArtifact,
  rawJudgments: string,
): Phase11LiveArtifact {
  const judgments = QualityJudgmentsSchema.parse(JSON.parse(rawJudgments));
  const runs = new Map(artifact.runs.map((run) => [run.blindId, run]));
  const ratingIds = judgments.ratings.map((rating) => rating.blindId);
  if (new Set(ratingIds).size !== ratingIds.length) {
    throw new Error("Quality judgments contain duplicate ratings.");
  }
  if (ratingIds.length !== artifact.runs.length || ratingIds.some((blindId) => !runs.has(blindId))) {
    throw new Error("Quality judgments require one complete rating for every recorded output.");
  }
  for (const preference of judgments.preferences) {
    const left = runs.get(preference.leftBlindId);
    const right = runs.get(preference.rightBlindId);
    if (!left || !right) {
      throw new Error("Quality preference references an unknown blind id.");
    }
    if (left.scenarioId !== right.scenarioId || left.repetition !== right.repetition) {
      throw new Error("Pairwise judgments must compare the same scenario and repetition.");
    }
  }
  return LiveArtifactSchema.parse({
    ...artifact,
    qualityJudgments: judgments.ratings,
    pairwisePreferences: judgments.preferences,
  });
}

export interface Phase11ReviewPacket {
  schemaVersion: 2;
  experimentId: string;
  pairs: Array<{
    pairId: string;
    scenarioId: string;
    repetition: number;
    title: string;
    context: Array<{ role: "user" | "assistant"; content: string }>;
    userMessage: string;
    narrativeRubric: string[];
    left: { blindId: string; output: string };
    right: { blindId: string; output: string };
  }>;
}

export function buildPhase11ReviewPacket(
  config: Phase11LiveConfig,
  artifact: Phase11LiveArtifact,
): Phase11ReviewPacket {
  const scenarios = new Map(config.scenarios.map((scenario) => [scenario.id, scenario]));
  const runsByKey = new Map(artifact.runs.map((run) => [pairKey(run.scenarioId, run.repetition, run.strategy), run]));
  const pairs: Phase11ReviewPacket["pairs"] = [];
  for (const run of artifact.runs) {
    const baselineStrategy = baselineForStrategy(run.strategy);
    if (!baselineStrategy) continue;
    const baseline = runsByKey.get(pairKey(run.scenarioId, run.repetition, baselineStrategy));
    const scenario = scenarios.get(run.scenarioId);
    if (!baseline || !scenario) continue;
    const pairId = `pair-${stableHash(`${artifact.experimentId}:${run.id}:${baseline.id}`)}`;
    const candidates = [baseline, run];
    if (stableHash(pairId).charCodeAt(0) % 2 === 1) candidates.reverse();
    pairs.push({
      pairId,
      scenarioId: run.scenarioId,
      repetition: run.repetition,
      title: scenario.title,
      context: scenario.history.map((message) => ({ role: message.role, content: message.content })),
      userMessage: scenario.userMessage,
      narrativeRubric: [...scenario.narrativeRubric],
      left: { blindId: candidates[0].blindId, output: candidates[0].visibleOutput },
      right: { blindId: candidates[1].blindId, output: candidates[1].visibleOutput },
    });
  }
  return { schemaVersion: 2, experimentId: artifact.experimentId, pairs };
}

export interface Phase11CallSummary {
  attempts: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  durationMeanMs: number | null;
}

export interface Phase11Comparison {
  baselineStrategy: Phase11Strategy;
  pairedRuns: number;
  rescues: number;
  harms: number;
  strictPassRateDelta: number;
  addedTokensMeanPerRun: number;
  addedDurationMeanMsPerRun: number;
  addedCostMeanUsdPerRun: { status: "known" | "estimated"; amountUsd: number } | { status: "unknown" };
}

export interface Phase11StrategySummary {
  runCount: number;
  strictPassRate: number | null;
  visibleCheckPassRate: number | null;
  influencePassRate: number | null;
  influenceTransmissionRate: number | null;
  qualityMean: number | null;
  pairwiseWinRateVsBaseline: number | null;
  calls: Record<(typeof CALL_PHASES)[number], Phase11CallSummary>;
  totalCostUsd: number;
  unknownCostCalls: number;
  comparison: Phase11Comparison | null;
}

export interface Phase11LiveScorecard {
  strategies: Record<Phase11Strategy, Phase11StrategySummary>;
  challenges: Record<string, Partial<Record<Phase11Strategy, { runs: number; strictPassRate: number }>>>;
}

export function scorePhase11LiveArtifact(artifact: Phase11LiveArtifact): Phase11LiveScorecard {
  const ratings = new Map(artifact.qualityJudgments.map((rating) => [rating.blindId, qualityMean(rating)]));
  const runByBlindId = new Map(artifact.runs.map((run) => [run.blindId, run]));
  const strategies = {} as Record<Phase11Strategy, Phase11StrategySummary>;
  for (const strategy of PHASE11_STRATEGIES) {
    const runs = artifact.runs.filter((run) => run.strategy === strategy);
    const calls = runs.flatMap((run) => run.calls);
    const influenceRuns = runs.filter((run) => run.checks.some((check) => check.target === "influence"));
    const validInfluenceRuns = influenceRuns.filter((run) =>
      run.checks.filter((check) => check.target === "influence").every((check) => check.passed),
    );
    const quality = runs.flatMap((run) => ratings.get(run.blindId) ?? []);
    const baseline = baselineForStrategy(strategy);
    strategies[strategy] = {
      runCount: runs.length,
      strictPassRate: mean(runs.map((run) => Number(run.strictPassed))),
      visibleCheckPassRate: mean(runs.flatMap((run) => run.checks.filter((check) => check.target === "visible").map((check) => Number(check.passed)))),
      influencePassRate: influenceRuns.length === 0
        ? null
        : mean(influenceRuns.map((run) => Number(run.checks.filter((check) => check.target === "influence").every((check) => check.passed)))),
      influenceTransmissionRate: strategy === "analysis-discarded-full" || validInfluenceRuns.length === 0
        ? null
        : mean(validInfluenceRuns.map((run) => Number(run.strictPassed))),
      qualityMean: mean(quality),
      pairwiseWinRateVsBaseline: baseline
        ? pairwiseWinRate(strategy, baseline, artifact.pairwisePreferences, runByBlindId)
        : null,
      calls: {
        analysis: summarizeCalls(calls.filter((call) => call.phase === "analysis")),
        "visible-response": summarizeCalls(calls.filter((call) => call.phase === "visible-response")),
      },
      totalCostUsd: round(calls.reduce((total, call) => total + (call.cost.status === "unknown" ? 0 : call.cost.amountUsd), 0)),
      unknownCostCalls: calls.filter((call) => call.cost.status === "unknown").length,
      comparison: baseline ? comparePairedRuns(runs, artifact.runs.filter((run) => run.strategy === baseline), baseline) : null,
    };
  }

  const challenges: Phase11LiveScorecard["challenges"] = {};
  for (const challenge of PHASE11_CHALLENGES) {
    const challengeRuns = artifact.runs.filter((run) => run.challenge === challenge);
    if (challengeRuns.length === 0) continue;
    challenges[challenge] = {};
    for (const strategy of PHASE11_STRATEGIES) {
      const runs = challengeRuns.filter((run) => run.strategy === strategy);
      if (runs.length > 0) {
        challenges[challenge][strategy] = { runs: runs.length, strictPassRate: mean(runs.map((run) => Number(run.strictPassed))) ?? 0 };
      }
    }
  }
  return { strategies, challenges };
}

export function createPhase11BlindId(runId: string): string {
  return `blind-${stableHash(runId)}`;
}

export function redactPhase11Text(value: string): string {
  return redactCredentialMaterial(value)
    .slice(0, 100_000);
}

function redactCredentialMaterial(value: string): string {
  return value
    .replace(/-----BEGIN[ _-]+(?:RSA[ _-]+|EC[ _-]+|OPENSSH[ _-]+)?PRIVATE[ _-]+KEY-----[\s\S]*?-----END[ _-]+(?:RSA[ _-]+|EC[ _-]+|OPENSSH[ _-]+)?PRIVATE[ _-]+KEY-----/gi, "[REDACTED_PRIVATE_KEY]")
    .replace(/\bAuthorization\s*:\s*Bearer\s+[^\s,;]+/gi, "Authorization: Bearer [REDACTED]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk-|gh[pousr]_)[A-Za-z0-9_-]{8,}\b/gi, "[REDACTED_TOKEN]")
    .replace(/\b(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|password|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/https?:\/\/[^\s/:@]+:[^\s/@]+@/gi, "https://[REDACTED]@");
}

export function baselineForStrategy(strategy: Phase11Strategy): Phase11Strategy | null {
  switch (strategy) {
    case "analysis-discarded-full":
    case "legacy-continuity-full":
    case "evidence-brief-full":
      return "single-full";
    case "evidence-brief-window":
      return "single-window";
    default:
      return null;
  }
}

export function isSingleCallStrategy(strategy: Phase11Strategy): boolean {
  return strategy === "single-full" || strategy === "single-window";
}

function comparePairedRuns(
  strategyRuns: readonly Phase11LiveRun[],
  baselineRuns: readonly Phase11LiveRun[],
  baselineStrategy: Phase11Strategy,
): Phase11Comparison | null {
  const baselineByPair = new Map(baselineRuns.map((run) => [pairKey(run.scenarioId, run.repetition, baselineStrategy), run]));
  const pairs = strategyRuns.flatMap((run) => {
    const baseline = baselineByPair.get(pairKey(run.scenarioId, run.repetition, baselineStrategy));
    return baseline ? [{ run, baseline }] : [];
  }).filter(({ run, baseline }) =>
    run.calls.every((call) => call.status === "success") &&
    baseline.calls.every((call) => call.status === "success"));
  if (pairs.length === 0) return null;
  const costPairs = pairs.map(({ run, baseline }) => [runCost(run), runCost(baseline)] as const);
  const hasUnknownCost = costPairs.some(([current, prior]) => current.status === "unknown" || prior.status === "unknown");
  const estimatedCost = costPairs.some(([current, prior]) => current.status === "estimated" || prior.status === "estimated");
  return {
    baselineStrategy,
    pairedRuns: pairs.length,
    rescues: pairs.filter(({ run, baseline }) => run.strictPassed && !baseline.strictPassed).length,
    harms: pairs.filter(({ run, baseline }) => !run.strictPassed && baseline.strictPassed).length,
    strictPassRateDelta: round((mean(pairs.map(({ run }) => Number(run.strictPassed))) ?? 0) - (mean(pairs.map(({ baseline }) => Number(baseline.strictPassed))) ?? 0)),
    addedTokensMeanPerRun: round(mean(pairs.map(({ run, baseline }) => runTokens(run) - runTokens(baseline))) ?? 0),
    addedDurationMeanMsPerRun: round(mean(pairs.map(({ run, baseline }) => runDuration(run) - runDuration(baseline))) ?? 0),
    addedCostMeanUsdPerRun: hasUnknownCost
      ? { status: "unknown" }
      : {
          status: estimatedCost ? "estimated" : "known",
          amountUsd: round(mean(costPairs.map(([current, prior]) => current.amountUsd - prior.amountUsd)) ?? 0),
        },
  };
}

function runCost(run: Phase11LiveRun): { status: "known" | "estimated" | "unknown"; amountUsd: number } {
  if (run.calls.some((call) => call.cost.status === "unknown")) return { status: "unknown", amountUsd: 0 };
  return {
    status: run.calls.some((call) => call.cost.status === "estimated") ? "estimated" : "known",
    amountUsd: run.calls.reduce((total, call) => total + (call.cost.status === "unknown" ? 0 : call.cost.amountUsd), 0),
  };
}

function pairwiseWinRate(
  strategy: Phase11Strategy,
  baseline: Phase11Strategy,
  preferences: Phase11LiveArtifact["pairwisePreferences"],
  runs: Map<string, Phase11LiveRun>,
): number | null {
  const relevant = preferences.filter((preference) => {
    const left = runs.get(preference.leftBlindId);
    const right = runs.get(preference.rightBlindId);
    return left && right && new Set([left.strategy, right.strategy]).size === 2 &&
      [left.strategy, right.strategy].includes(strategy) && [left.strategy, right.strategy].includes(baseline);
  });
  if (relevant.length === 0) return null;
  const wins = relevant.reduce((total, preference) => {
    if (preference.preferredBlindId === null) return total + 0.5;
    return total + Number(runs.get(preference.preferredBlindId)?.strategy === strategy);
  }, 0);
  return round(wins / relevant.length);
}

function summarizeCalls(calls: Phase11LiveRun["calls"]): Phase11CallSummary {
  return {
    attempts: calls.length,
    failures: calls.filter((call) => call.status === "error").length,
    inputTokens: calls.reduce((total, call) => total + call.usage.inputTokens, 0),
    outputTokens: calls.reduce((total, call) => total + call.usage.outputTokens, 0),
    durationMeanMs: mean(calls.map((call) => call.durationMs)),
  };
}

function qualityMean(rating: z.infer<typeof QualityRatingSchema>): number {
  return round((rating.memoryFidelity + rating.continuity + rating.characterConsistency + rating.agency + rating.proseQuality) / 5);
}

function runTokens(run: Phase11LiveRun): number {
  return run.calls.reduce((total, call) => total + call.usage.totalTokens, 0);
}

function runDuration(run: Phase11LiveRun): number {
  return run.calls.reduce((total, call) => total + call.durationMs, 0);
}

function pairKey(scenarioId: string, repetition: number, strategy: Phase11Strategy): string {
  return `${scenarioId}\u0000${String(repetition)}\u0000${strategy}`;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

function normalizeComparableText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function assertNoRawCredentialFields(raw: string): void {
  if (/"(?:apiKey|authorization|token|password|secret)"\s*:/i.test(raw)) {
    throw new Error("Live eval config may name an API-key environment variable but may not contain raw credentials.");
  }
}

function assertNoCredentialMaterial(raw: string): void {
  if (redactCredentialMaterial(raw) !== raw) {
    throw new Error("Live eval artifact contains credential-like material and must be redacted.");
  }
}

function assertUnique(
  values: readonly string[],
  label: string,
  context: z.RefinementCtx,
  path: (string | number)[],
): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: `${label} ids must be unique.`, path });
  }
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : round(values.reduce((total, value) => total + value, 0) / values.length);
}

function round(value: number): number {
  return Number(value.toFixed(12));
}
