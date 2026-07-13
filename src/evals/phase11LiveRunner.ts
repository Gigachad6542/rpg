import { OpenAICompatibleTextProvider } from "../providers/openAICompatibleProvider";
import type {
  TextGenerationResponse,
  TextModelAdapter,
  TextUsage,
} from "../providers/TextModelAdapter";
import {
  buildVisibleUserMessageWithHiddenContinuity,
  createEmptyHiddenContinuityResult,
  runHiddenContinuityPass,
  type HiddenContinuityResult,
} from "../runtime/hiddenContinuity";
import { classifyModelCallFailure } from "../runtime/modelCallTelemetry";
import { runTurnPipeline } from "../runtime/turnPipeline";
import {
  parsePhase11LiveArtifact,
  redactPhase11Text,
  type Phase11LiveArtifact,
  type Phase11LiveConfig,
  type Phase11LiveRun,
} from "./phase11Eval";

export interface Phase11LiveRunnerOptions {
  environment: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: () => string;
  monotonicNow?: () => number;
}

type LiveProfile = Phase11LiveConfig["profiles"][number];
type LiveScenario = Phase11LiveConfig["scenarios"][number];
type LiveCall = Phase11LiveRun["calls"][number];

const ZERO_USAGE: TextUsage = Object.freeze({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });

export async function runPhase11LiveExperiment(
  config: Phase11LiveConfig,
  options: Phase11LiveRunnerOptions,
): Promise<Phase11LiveArtifact> {
  assertReadyForPaidRuns(config);
  const now = options.now ?? (() => new Date().toISOString());
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const runs: Phase11LiveRun[] = [];
  let blindIndex = 1;

  for (const profile of config.profiles) {
    const adapter = createProfileAdapter(profile, options);
    for (const scenario of config.scenarios) {
      for (const mode of config.modes) {
        runs.push(await runScenarioMode({
          adapter,
          profile,
          scenario,
          mode,
          blindId: `sample-${String(blindIndex).padStart(4, "0")}`,
          monotonicNow,
        }));
        blindIndex += 1;
      }
    }
  }

  return parsePhase11LiveArtifact(JSON.stringify({
    schemaVersion: 1,
    experimentId: config.experimentId,
    createdAt: now(),
    redacted: true,
    runs,
    pairwisePreferences: [],
  }));
}

async function runScenarioMode(input: {
  adapter: TextModelAdapter;
  profile: LiveProfile;
  scenario: LiveScenario;
  mode: Phase11LiveRun["mode"];
  blindId: string;
  monotonicNow: () => number;
}): Promise<Phase11LiveRun> {
  const calls: LiveCall[] = [];
  const card = {
    id: `eval-card-${input.scenario.id}`,
    name: input.scenario.title,
    kind: "rpg",
    summary: input.scenario.referenceFacts.join(" "),
    memory: input.scenario.referenceFacts.map((fact, index) => ({
      id: `fact-${index + 1}`,
      label: `Reference fact ${index + 1}`,
      detail: fact,
    })),
    rpgState: null,
  };
  let continuity = createEmptyHiddenContinuityResult();

  if (input.mode !== "off") {
    const hiddenModel = input.mode === "economical" ? input.profile.economicalModel : input.profile.visibleModel;
    const hiddenStart = input.monotonicNow();
    let response: TextGenerationResponse | undefined;
    try {
      continuity = await runHiddenContinuityPass({
        modelAdapter: captureGenerateResponse(input.adapter, (captured) => { response = captured; }),
        model: hiddenModel,
        card,
        messages: input.scenario.history,
        latestUserMessage: input.scenario.userMessage,
        activeLoreCount: 0,
        maxOutputTokens: 1_800,
      });
      calls.push(createCall({
        phase: "hidden-continuity",
        provider: input.adapter.id,
        model: hiddenModel,
        durationMs: elapsed(hiddenStart, input.monotonicNow),
        response,
        pricing: exactPricing(input.profile, hiddenModel),
        proposalCount: countHiddenProposals(continuity),
      }));
    } catch (error) {
      continuity = {
        ...createEmptyHiddenContinuityResult(),
        warnings: [`Hidden continuity failed: ${classifyModelCallFailure(error).message}`],
      };
      calls.push(createCall({
        phase: "hidden-continuity",
        provider: input.adapter.id,
        model: hiddenModel,
        durationMs: elapsed(hiddenStart, input.monotonicNow),
        response,
        error,
        pricing: exactPricing(input.profile, hiddenModel),
        proposalCount: 0,
      }));
    }
  }

  const visibleStart = input.monotonicNow();
  let timeToFirstTokenMs: number | null = null;
  let visibleOutput = "";
  try {
    const result = await runTurnPipeline({
      session: {
        id: `eval-session-${input.scenario.id}`,
        title: input.scenario.title,
        mode: "phase1.1-live-eval",
        systemPrompt: input.scenario.systemPrompt,
      },
      card: {
        id: card.id,
        name: card.name,
        kind: card.kind,
        summary: card.summary,
        systemPrompt: input.scenario.systemPrompt,
        knowledgeBoundaries: [
          "Treat these synthetic reference facts as authoritative for this eval:",
          ...input.scenario.referenceFacts.map((fact) => `- ${fact}`),
        ].join("\n"),
      },
      messages: input.scenario.history,
      latestUserMessage: buildVisibleUserMessageWithHiddenContinuity(
        input.scenario.userMessage,
        continuity,
        card,
      ),
      modelAdapter: input.adapter,
      model: input.profile.visibleModel,
      temperature: 0.6,
      maxOutputTokens: 1_800,
      preferStreaming: true,
      onStreamText: (text) => {
        if (timeToFirstTokenMs === null && text.length > 0) {
          timeToFirstTokenMs = elapsed(visibleStart, input.monotonicNow);
        }
      },
      metadata: {
        phase11LiveEval: true,
        mode: input.mode,
        expectedCallCount: input.mode === "off" ? 1 : 2,
      },
    });
    visibleOutput = redactPhase11Text(result.assistantMessageText);
    calls.push(createCall({
      phase: "visible-response",
      provider: input.adapter.id,
      model: input.profile.visibleModel,
      durationMs: elapsed(visibleStart, input.monotonicNow),
      timeToFirstTokenMs,
      response: {
        providerId: result.promptRun.providerId,
        model: result.promptRun.model,
        text: result.assistantMessageText,
        finishReason: result.promptRun.finishReason,
        usage: result.promptRun.usage,
        usageSource: result.promptRun.usageSource,
      },
      pricing: exactPricing(input.profile, input.profile.visibleModel),
      proposalCount: countVisibleProposals(result.stateProposals),
    }));
  } catch (error) {
    calls.push(createCall({
      phase: "visible-response",
      provider: input.adapter.id,
      model: input.profile.visibleModel,
      durationMs: elapsed(visibleStart, input.monotonicNow),
      timeToFirstTokenMs,
      error,
      pricing: exactPricing(input.profile, input.profile.visibleModel),
      proposalCount: 0,
    }));
  }

  return {
    id: `run-${input.profile.id}-${input.scenario.id}-${input.mode}`,
    blindId: input.blindId,
    scenarioId: input.scenario.id,
    profileId: input.profile.id,
    mode: input.mode,
    visibleOutput,
    qualityScore: null,
    calls,
  };
}

function createProfileAdapter(profile: LiveProfile, options: Phase11LiveRunnerOptions): TextModelAdapter {
  const apiKey = profile.apiKeyEnv ? options.environment[profile.apiKeyEnv]?.trim() : undefined;
  if (profile.class !== "local-openai-compatible" && !apiKey) {
    throw new Error(`Missing required API key environment variable ${profile.apiKeyEnv ?? "(not configured)"}.`);
  }
  return new OpenAICompatibleTextProvider({
    id: profile.id,
    displayName: `Phase 1.1 ${profile.class}`,
    baseUrl: profile.baseUrl,
    apiKey,
    allowUnauthenticated: profile.class === "local-openai-compatible",
    requestTimeoutMs: 300_000,
    fetchImpl: options.fetchImpl,
  });
}

function captureGenerateResponse(adapter: TextModelAdapter, capture: (response: TextGenerationResponse) => void): TextModelAdapter {
  return {
    id: adapter.id,
    displayName: adapter.displayName,
    listModels: () => adapter.listModels(),
    generateText: async (request) => {
      const response = await adapter.generateText(request);
      capture(response);
      return response;
    },
    ...(adapter.streamText ? { streamText: (request: Parameters<NonNullable<TextModelAdapter["streamText"]>>[0]) => adapter.streamText!(request) } : {}),
  };
}

function createCall(input: {
  phase: LiveCall["phase"];
  provider: string;
  model: string;
  durationMs: number;
  timeToFirstTokenMs?: number | null;
  response?: TextGenerationResponse;
  error?: unknown;
  pricing: LiveProfile["pricing"][number];
  proposalCount: number;
}): LiveCall {
  const usageSource = input.response?.usageSource ?? (input.response ? "estimated" : "unavailable");
  const usage = input.response?.usage ?? ZERO_USAGE;
  const failure = input.error === undefined ? null : classifyModelCallFailure(input.error);
  return {
    phase: input.phase,
    provider: input.provider,
    model: input.model,
    status: failure ? "error" : "success",
    timeToFirstTokenMs: input.timeToFirstTokenMs ?? null,
    durationMs: Math.max(0, input.durationMs),
    usage: { ...usage, source: usageSource },
    cost: usageSource === "unavailable"
      ? { status: "unknown", currency: "USD" }
      : {
          status: usageSource === "provider" ? "known" : "estimated",
          currency: "USD",
          amountUsd: roundUsd(
            usage.inputTokens * input.pricing.inputUsdPerMillionTokens / 1_000_000 +
            usage.outputTokens * input.pricing.outputUsdPerMillionTokens / 1_000_000,
          ),
          pricingSnapshotId: input.pricing.id,
        },
    failure,
    proposalCount: input.proposalCount,
  };
}

function exactPricing(profile: LiveProfile, model: string): LiveProfile["pricing"][number] {
  const pricing = profile.pricing.find((snapshot) => snapshot.model === model);
  if (!pricing) {
    throw new Error(`No exact pricing snapshot exists for ${profile.id}/${model}.`);
  }
  return pricing;
}

function assertReadyForPaidRuns(config: Phase11LiveConfig): void {
  if (!config.readyForPaidRuns) {
    throw new Error("Live eval config is not marked readyForPaidRuns after pricing and endpoint review.");
  }
  for (const profile of config.profiles) {
    if (profile.visibleModel.startsWith("replace-") || profile.economicalModel.startsWith("replace-")) {
      throw new Error(`Profile ${profile.id} still contains placeholder model ids.`);
    }
    if (profile.pricing.some((snapshot) => /example only|replace with/i.test(snapshot.source))) {
      throw new Error(`Profile ${profile.id} still contains placeholder pricing.`);
    }
  }
}

function countHiddenProposals(result: HiddenContinuityResult): number {
  return result.memoryUpdates.length + result.entityUpdates.length + result.knowledgeUpdates.length;
}

function countVisibleProposals(value: object): number {
  return Object.values(value).reduce<number>(
    (total, item: unknown) => total + (Array.isArray(item) ? item.length : 0),
    0,
  );
}

function elapsed(start: number, now: () => number): number {
  return Math.max(0, now() - start);
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}
