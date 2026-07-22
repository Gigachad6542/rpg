import type {
  TextReasoningFormat,
  TextReasoningObservation,
} from "./TextModelAdapter";

const MAX_REASONING_TRACE_CHARACTERS = 64_000;
const MAX_REASONING_DETAILS = 128;
const MAX_REASONING_TOKENS = 10_000_000;

export function extractReasoningObservation(payload: unknown): TextReasoningObservation | undefined {
  if (!isRecord(payload)) return undefined;
  const choice = Array.isArray(payload.choices) && isRecord(payload.choices[0])
    ? payload.choices[0]
    : undefined;
  const message = choice && isRecord(choice.message)
    ? choice.message
    : choice && isRecord(choice.delta)
      ? choice.delta
      : undefined;
  const directTrace = firstBoundedString(message?.reasoning, message?.reasoning_content);
  const detailResult = readReasoningDetails(message?.reasoning_details);
  const trace = directTrace ?? detailResult.trace;
  const encrypted = detailResult.encrypted;
  const tokenCount = readReasoningTokenCount(payload.usage);
  if (!trace && !encrypted && tokenCount === undefined) return undefined;

  return {
    ...(trace ? { trace } : {}),
    format: directTrace ? "text" : detailResult.format,
    encrypted,
    ...(tokenCount === undefined ? {} : { tokenCount }),
  };
}

export function mergeReasoningObservations(
  current: TextReasoningObservation | undefined,
  next: TextReasoningObservation | undefined,
): TextReasoningObservation | undefined {
  if (!current) return next;
  if (!next) return current;
  const combinedTrace = `${current.trace ?? ""}${next.trace ?? ""}`.slice(0, MAX_REASONING_TRACE_CHARACTERS);
  return {
    ...(combinedTrace ? { trace: combinedTrace } : {}),
    format: mergeFormats(current.format, next.format),
    encrypted: current.encrypted || next.encrypted,
    ...(next.tokenCount !== undefined
      ? { tokenCount: next.tokenCount }
      : current.tokenCount !== undefined
        ? { tokenCount: current.tokenCount }
        : {}),
  };
}

function readReasoningDetails(value: unknown): {
  trace?: string;
  format: TextReasoningFormat;
  encrypted: boolean;
} {
  if (!Array.isArray(value)) {
    return { format: "unavailable", encrypted: false };
  }
  const parts: string[] = [];
  const formats = new Set<TextReasoningFormat>();
  let encrypted = false;
  for (const detail of value.slice(0, MAX_REASONING_DETAILS)) {
    if (!isRecord(detail)) continue;
    if (detail.type === "reasoning.encrypted") {
      encrypted = true;
      formats.add("encrypted");
      continue;
    }
    if (detail.type === "reasoning.text") {
      const text = boundedString(detail.text);
      if (text) {
        parts.push(text);
        formats.add("text");
      }
      continue;
    }
    if (detail.type === "reasoning.summary") {
      const summary = boundedString(detail.summary);
      if (summary) {
        parts.push(summary);
        formats.add("summary");
      }
    }
  }
  const trace = parts.join("").slice(0, MAX_REASONING_TRACE_CHARACTERS);
  return {
    ...(trace ? { trace } : {}),
    format: formats.size > 1 ? "mixed" : formats.values().next().value ?? "unavailable",
    encrypted,
  };
}

function readReasoningTokenCount(value: unknown): number | undefined {
  if (!isRecord(value) || !isRecord(value.completion_tokens_details)) return undefined;
  const count = value.completion_tokens_details.reasoning_tokens;
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 && count <= MAX_REASONING_TOKENS
    ? count
    : undefined;
}

function firstBoundedString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = boundedString(value);
    if (text) return text;
  }
  return undefined;
}

function boundedString(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  return value.slice(0, MAX_REASONING_TRACE_CHARACTERS);
}

function mergeFormats(left: TextReasoningFormat, right: TextReasoningFormat): TextReasoningFormat {
  if (left === "unavailable") return right;
  if (right === "unavailable") return left;
  return left === right ? left : "mixed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
