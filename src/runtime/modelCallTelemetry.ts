import type { TextUsage } from "../providers/TextModelAdapter";

export interface ModelPricingSnapshot {
  readonly model: string;
  readonly currency: "USD";
  readonly inputUsdPerMillionTokens: number;
  readonly outputUsdPerMillionTokens: number;
  readonly source: string;
  readonly effectiveDate: string;
}

export type ModelCallCost =
  | {
      readonly status: "known";
      readonly currency: "USD";
      readonly amountUsd: number;
      readonly pricing: ModelPricingSnapshot;
    }
  | {
      readonly status: "estimated";
      readonly currency: "USD";
      readonly amountUsd: number;
      readonly pricing: ModelPricingSnapshot;
    }
  | {
      readonly status: "unknown";
      readonly currency: "USD";
    };

export type ModelCallFailureCategory =
  | "aborted"
  | "authentication"
  | "rate-limit"
  | "network"
  | "validation"
  | "provider"
  | "unknown";

export interface ModelCallFailure {
  readonly category: ModelCallFailureCategory;
  readonly message: string;
}

export function calculateModelCallCost(
  usage: TextUsage,
  pricing: ModelPricingSnapshot | undefined,
  usageSource: "provider" | "estimated" | "unavailable" = "provider",
): ModelCallCost {
  if (!pricing || usageSource === "unavailable") {
    return { status: "unknown", currency: "USD" };
  }

  const inputCost = usage.inputTokens * pricing.inputUsdPerMillionTokens / 1_000_000;
  const outputCost = usage.outputTokens * pricing.outputUsdPerMillionTokens / 1_000_000;
  return {
    status: usageSource === "estimated" ? "estimated" : "known",
    currency: "USD",
    amountUsd: roundUsd(inputCost + outputCost),
    pricing,
  };
}

export function resolveModelPricing(input: {
  providerId: string;
  model: string;
  pricing?: ModelPricingSnapshot;
  pricingSnapshots?: readonly ModelPricingSnapshot[];
}): ModelPricingSnapshot | undefined {
  if (input.providerId === "mock" && input.model === "mock-narrator") {
    return Object.freeze({
      model: input.model,
      currency: "USD",
      inputUsdPerMillionTokens: 0,
      outputUsdPerMillionTokens: 0,
      source: "built-in mock provider",
      effectiveDate: "1970-01-01",
    });
  }

  return input.pricingSnapshots?.find((snapshot) => snapshot.model === input.model)
    ?? (input.pricing?.model === input.model ? input.pricing : undefined);
}

export function classifyModelCallFailure(error: unknown): ModelCallFailure {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = sanitizeFailureMessage(rawMessage);
  const normalized = `${error instanceof Error ? error.name : ""} ${rawMessage}`.toLowerCase();

  if (normalized.includes("abort")) {
    return { category: "aborted", message };
  }
  if (/\b(401|403|unauthori[sz]ed|authentication|api key)\b/.test(normalized)) {
    return { category: "authentication", message };
  }
  if (/\b(429|rate.?limit|too many requests)\b/.test(normalized)) {
    return { category: "rate-limit", message };
  }
  if (/\b(network|connection|fetch failed|timeout|timed out|dns)\b/.test(normalized)) {
    return { category: "network", message };
  }
  if (/\b(400|404|409|422|invalid|validation|malformed|unsupported)\b/.test(normalized)) {
    return { category: "validation", message };
  }
  if (/\b(provider|service unavailable|server error|500|502|503|504)\b/.test(normalized)) {
    return { category: "provider", message };
  }
  return { category: "unknown", message };
}

function sanitizeFailureMessage(value: string): string {
  const redacted = value
    .replace(/-----BEGIN[ _-]+(?:RSA[ _-]+|EC[ _-]+|OPENSSH[ _-]+)?PRIVATE[ _-]+KEY-----[\s\S]*?-----END[ _-]+(?:RSA[ _-]+|EC[ _-]+|OPENSSH[ _-]+)?PRIVATE[ _-]+KEY-----/gi, "[REDACTED_PRIVATE_KEY]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_KEY]")
    .replace(/\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{16,}\b/gi, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\bAKIA[A-Z0-9]{16}\b/g, "[REDACTED_AWS_KEY]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]")
    .replace(/\b(api[_ -]?key|access[_ -]?key(?:[_ -]?id)?|token|session[_ -]?token|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|private[_ -]?key|password|secret)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1=[REDACTED]")
    .trim();
  return (redacted || "Model call failed.").slice(0, 240);
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}
