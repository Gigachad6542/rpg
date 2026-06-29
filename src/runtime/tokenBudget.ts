export type TokenEstimator = (text: string) => number;

export interface TokenBudget {
  maxInputTokens: number;
  reservedOutputTokens?: number;
}

export interface TrimmedText {
  text: string;
  estimatedTokens: number;
  wasTrimmed: boolean;
}

export function estimateTextTokens(text: string): number {
  if (text.length === 0) {
    return 0;
  }

  return Math.max(1, Math.ceil(text.length / 4));
}

export function getUsableInputTokenLimit(tokenBudget?: TokenBudget): number | undefined {
  if (!tokenBudget) {
    return undefined;
  }

  return Math.max(0, tokenBudget.maxInputTokens - (tokenBudget.reservedOutputTokens ?? 0));
}

export function normalizeTokenEstimate(estimate: number): number {
  if (!Number.isFinite(estimate) || estimate < 0) {
    return 0;
  }

  return Math.ceil(estimate);
}

export function trimTextToTokenLimit(
  text: string,
  maxTokens: number,
  estimator: TokenEstimator = estimateTextTokens,
): TrimmedText {
  const safeMaxTokens = Math.max(0, Math.floor(maxTokens));
  const currentEstimate = normalizeTokenEstimate(estimator(text));

  if (currentEstimate <= safeMaxTokens) {
    return {
      text,
      estimatedTokens: currentEstimate,
      wasTrimmed: false,
    };
  }

  if (safeMaxTokens === 0 || text.length === 0) {
    return {
      text: "",
      estimatedTokens: 0,
      wasTrimmed: text.length > 0,
    };
  }

  let low = 0;
  let high = text.length;
  let best = "";

  while (low <= high) {
    const midpoint = Math.floor((low + high) / 2);
    const candidate = text.slice(0, midpoint);
    const candidateEstimate = normalizeTokenEstimate(estimator(candidate));

    if (candidateEstimate <= safeMaxTokens) {
      best = candidate;
      low = midpoint + 1;
    } else {
      high = midpoint - 1;
    }
  }

  const trimmed = best.trimEnd();

  return {
    text: trimmed,
    estimatedTokens: normalizeTokenEstimate(estimator(trimmed)),
    wasTrimmed: true,
  };
}
