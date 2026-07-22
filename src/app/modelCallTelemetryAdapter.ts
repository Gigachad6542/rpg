import type {
  TextChunk,
  TextGenerationRequest,
  TextGenerationResponse,
  TextModelAdapter,
} from "../providers/TextModelAdapter";
import { mergeReasoningObservations } from "../providers/reasoningObservation";
import type { resolveModelCallBudget } from "../runtime/modelCallBudget";
import {
  calculateModelCallCost,
  classifyModelCallFailure,
  type resolveModelPricing,
} from "../runtime/modelCallTelemetry";
import { estimateTextTokens } from "../runtime/tokenBudget";
import type { ModelCallRecord } from "./runtimeTypes";

export type TextModelCallOutcome =
  | { response: TextGenerationResponse }
  | { error: unknown; response?: TextGenerationResponse };

export function createModelCallCaptureAdapter(
  adapter: TextModelAdapter,
  capture: (outcome: TextModelCallOutcome) => void,
): TextModelAdapter {
  const captureAdapter: TextModelAdapter = {
    id: adapter.id,
    displayName: adapter.displayName,
    listModels: () => adapter.listModels(),
    async generateText(request) {
      try {
        const response = await adapter.generateText(request);
        capture({ response });
        return response;
      } catch (error) {
        capture({ error });
        throw error;
      }
    },
  };
  if (adapter.streamText) {
    captureAdapter.streamText = (request) => captureStream(adapter, request, capture);
  }
  return captureAdapter;
}

async function* captureStream(
  adapter: TextModelAdapter,
  request: TextGenerationRequest,
  capture: (outcome: TextModelCallOutcome) => void,
) {
  let text = "";
  let terminalChunk: TextChunk | undefined;
  let reasoning: TextGenerationResponse["reasoning"];
  try {
    for await (const chunk of adapter.streamText?.(request) ?? []) {
      text += chunk.text;
      reasoning = mergeReasoningObservations(reasoning, chunk.reasoning);
      if (chunk.done) terminalChunk = chunk;
      yield chunk;
    }
    if (terminalChunk) {
      const estimatedInputTokens = estimateTextTokens(
        [request.systemPrompt, request.prompt].filter(Boolean).join("\n\n"),
      );
      const estimatedOutputTokens = estimateTextTokens(text);
      const usage = terminalChunk.usage ?? {
        inputTokens: estimatedInputTokens,
        outputTokens: estimatedOutputTokens,
        totalTokens: estimatedInputTokens + estimatedOutputTokens,
      };
      capture({
        response: {
          providerId: adapter.id,
          model: request.model,
          text,
          finishReason: terminalChunk.finishReason ?? "stop",
          usage,
          usageSource: terminalChunk.usage
            ? terminalChunk.usageSource ?? "provider"
            : "estimated",
          ...(reasoning ? { reasoning } : {}),
          raw: { streamed: true },
        },
      });
    }
  } catch (error) {
    capture({ error });
    throw error;
  }
}

export function toModelCallRecord(input: {
  phase: ModelCallRecord["phase"];
  fallbackProvider: string;
  fallbackModel: string;
  budget: ReturnType<typeof resolveModelCallBudget>;
  durationMs: number;
  outcome?: TextModelCallOutcome;
  pricing?: ReturnType<typeof resolveModelPricing>;
  reasoningRequest?: "enabled" | "disabled" | "unspecified";
  stateProposalCount: number;
}): ModelCallRecord {
  const response = input.outcome && "response" in input.outcome
    ? input.outcome.response
    : undefined;
  const usage = response
    ? { ...response.usage }
    : { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const explicitError = input.outcome && "error" in input.outcome
    ? input.outcome.error
    : undefined;
  const failed = explicitError !== undefined || !response || response.finishReason === "error" || response.text.trim().length === 0;
  const failure = failed
    ? classifyModelCallFailure(
        explicitError !== undefined
          ? explicitError
          : new Error(
              response?.text.trim().length === 0
                ? "Provider returned an empty response."
                : "Provider returned an error finish reason.",
            ),
      )
    : undefined;
  const usageSource = response ? response.usageSource ?? "provider" : "unavailable";
  const reasoning = toReasoningRecord(input.reasoningRequest ?? "unspecified", response?.reasoning, usage.outputTokens);
  return {
    phase: input.phase,
    provider: response?.providerId ?? input.fallbackProvider,
    model: response?.model ?? input.fallbackModel,
    usage,
    inputBudgetTokens: input.budget.inputBudgetTokens,
    effectiveContextWindowTokens: input.budget.effectiveContextWindowTokens,
    budgetSource: input.budget.source,
    durationMs: input.durationMs,
    status: failed ? "error" : "success",
    usageSource,
    cost: calculateModelCallCost(usage, input.pricing, usageSource),
    ...(failure ? { failure } : {}),
    reasoning,
    stateProposalCount: input.stateProposalCount,
  };
}

function toReasoningRecord(
  request: "enabled" | "disabled" | "unspecified",
  observation: TextGenerationResponse["reasoning"],
  outputTokens: number,
): NonNullable<ModelCallRecord["reasoning"]> {
  const tokenCount = observation?.tokenCount !== undefined && observation.tokenCount <= outputTokens
    ? observation.tokenCount
    : undefined;
  return {
    request,
    observed: Boolean(observation?.trace || observation?.encrypted || tokenCount !== undefined),
    traceAvailable: Boolean(observation?.trace),
    encrypted: observation?.encrypted ?? false,
    ...(tokenCount === undefined ? {} : { tokenCount }),
  };
}

export function readMonotonicMilliseconds(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

export function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(readMonotonicMilliseconds() - startedAt));
}
