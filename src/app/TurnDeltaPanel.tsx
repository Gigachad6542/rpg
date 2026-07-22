import { useState } from "react";
import { RotateCcw, ShieldAlert } from "lucide-react";

import type { PromptRun } from "./runtimeTypes";
import { modelReasoningTraceKey, type ModelReasoningTraceMap } from "./reasoningTraces";
import type { TurnEffectProposal, TurnEffectProvenance } from "./turnEffects";

export function TurnDeltaPanel(props: {
  run: PromptRun;
  onUndo: () => void;
  canUndo?: boolean;
  undone?: boolean;
  reasoningTraces?: ModelReasoningTraceMap;
}) {
  const [visibleReasoning, setVisibleReasoning] = useState<ReadonlySet<string>>(() => new Set());
  const proposals = getDisplayProposals(props.run);
  const modelCalls = props.run.modelCalls ?? [];
  if (proposals.length === 0 && modelCalls.length === 0) {
    return null;
  }
  const applied = proposals.filter((proposal) => proposal.applied);
  const blocked = proposals.filter((proposal) => !proposal.applied);
  const combinedTokens = modelCalls.reduce((total, call) => total + call.usage.totalTokens, 0);
  const knownCostUsd = modelCalls.reduce(
    (total, call) => total + (call.cost?.status === "known" ? call.cost.amountUsd : 0),
    0,
  );
  const estimatedCostUsd = modelCalls.reduce((total, call) => total + getEstimatedCostUsd(call.cost), 0);
  const estimatedCostCalls = modelCalls.filter((call) => getCostStatus(call.cost) === "estimated").length;
  const unknownCostCalls = modelCalls.filter((call) => {
    const status = getCostStatus(call.cost);
    return status !== "known" && status !== "estimated";
  }).length;

  return (
    <div className="turn-metadata-panels">
      {modelCalls.length > 0 ? (
        <details className="model-call-panel">
          <summary>
            {modelCalls.length} model calls · {combinedTokens} tokens · {formatCombinedCost(
              knownCostUsd + estimatedCostUsd,
              estimatedCostCalls,
              unknownCostCalls,
            )}
          </summary>
          <p className="model-call-usage-note">
            Each attempted phase retains its own usage, latency, cost status, failure, and proposal count.
          </p>
          <ul className="model-call-list">
            {modelCalls.map((call) => {
              const traceKey = modelReasoningTraceKey(props.run.id, call.phase);
              const reasoningTrace = props.reasoningTraces?.[traceKey];
              const reasoningIsVisible = visibleReasoning.has(traceKey);
              return (
              <li key={call.phase}>
                <div className="model-call-heading">
                  <strong>{formatPhase(call.phase)}</strong>
                  <span className={`model-call-status ${call.status}`}>{formatStatus(call.status)}</span>
                </div>
                <span>{call.provider} / {call.model}</span>
                <span>
                  {call.usage.inputTokens} input · {call.usage.outputTokens} output · {call.usage.totalTokens} total ({call.usageSource ?? "legacy"})
                </span>
                {call.inputBudgetTokens && call.inputBudgetTokens > 0 ? (
                  <span>{formatInputBudgetUsage(call.usage.inputTokens, call.inputBudgetTokens)}</span>
                ) : null}
                <span>{Math.round(call.durationMs)} ms phase duration</span>
                <span>{formatCallCost(call.cost)}</span>
                <span>{call.stateProposalCount ?? 0} state proposals</span>
                <span>{formatReasoningStatus(call.reasoning)}</span>
                {reasoningTrace?.trace ? (
                  <div className="model-reasoning-disclosure">
                    <button
                      aria-expanded={reasoningIsVisible}
                      className="secondary-button compact-button"
                      type="button"
                      onClick={() => setVisibleReasoning((current) => toggleSetValue(current, traceKey))}
                    >
                      {reasoningIsVisible ? "Hide" : "Show"} model reasoning (private / spoilers)
                    </button>
                    {reasoningIsVisible ? (
                      <div className="model-reasoning-trace">
                        <p role="note">This may expose private memory, hidden plot facts, or instructions.</p>
                        <pre>{reasoningTrace.trace}</pre>
                      </div>
                    ) : null}
                  </div>
                ) : call.reasoning?.traceAvailable ? (
                  <span>Private reasoning trace is unavailable after this app session.</span>
                ) : null}
                {call.failure ? <span>{call.failure.category}: {call.failure.message}</span> : null}
              </li>
              );
            })}
          </ul>
        </details>
      ) : null}
      {proposals.length > 0 ? (
        <details className="turn-delta-panel">
          <summary>
            State changes ({applied.length} applied, {blocked.length} blocked)
          </summary>
          <ul className="turn-delta-list">
            {proposals.map((proposal, index) => (
              <li className={proposal.applied ? "applied" : "blocked"} key={`${proposal.kind}-${proposal.summary}-${index}`}>
                <span className="turn-delta-status" aria-label={proposal.applied ? "Applied" : "Blocked"}>
                  {proposal.applied ? <RotateCcw size={13} /> : <ShieldAlert size={13} />}
                </span>
                <span>{proposal.summary}</span>
                <span className="turn-delta-provenance">{formatProvenance(proposal.provenance)}</span>
              </li>
            ))}
          </ul>
          {props.undone ? (
            <p className="turn-delta-undone" role="status">State changes undone.</p>
          ) : applied.length > 0 && props.canUndo !== false ? (
            <button className="secondary-button compact-button" type="button" onClick={props.onUndo}>
              <RotateCcw size={14} />
              Undo state changes
            </button>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}

function toggleSetValue(current: ReadonlySet<string>, value: string): ReadonlySet<string> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function formatReasoningStatus(reasoning: NonNullable<PromptRun["modelCalls"]>[number]["reasoning"]): string;
function formatReasoningStatus(reasoning: undefined): string;
function formatReasoningStatus(
  reasoning: NonNullable<PromptRun["modelCalls"]>[number]["reasoning"] | undefined,
): string {
  if (!reasoning) return "Reasoning telemetry unavailable (legacy)";
  const encrypted = reasoning.encrypted ? " · encrypted trace" : "";
  if (reasoning.request === "disabled") {
    return reasoning.observed ? `Reasoning returned despite being disabled${encrypted}` : "Reasoning off";
  }
  if (reasoning.tokenCount !== undefined) {
    if (reasoning.tokenCount === 0) {
      const requestStatus = reasoning.request === "enabled"
        ? "Reasoning requested"
        : "Reasoning not explicitly requested";
      return `${requestStatus} · provider reported 0 reasoning tokens${encrypted}`;
    }
    const source = reasoning.request === "enabled" ? "" : " by provider default";
    return `Reasoning confirmed${source} · ${reasoning.tokenCount} reasoning tokens${encrypted}`;
  }
  if (reasoning.observed) {
    return `Reasoning observed · token count unavailable${encrypted}`;
  }
  return reasoning.request === "enabled"
    ? "Reasoning requested · not observable"
    : "Reasoning not requested or observed";
}

function formatInputBudgetUsage(inputTokens: number, inputBudgetTokens: number): string {
  const utilization = Math.round((inputTokens / inputBudgetTokens) * 100);
  return `${inputTokens} / ${inputBudgetTokens} input tokens · ${utilization}% used`;
}

function formatCombinedCost(totalCostUsd: number, estimatedCostCalls: number, unknownCostCalls: number): string {
  const estimateLabel = estimatedCostCalls > 0 ? ` (${estimatedCostCalls} estimated)` : "";
  const priced = `$${totalCostUsd.toFixed(6)}${estimateLabel}`;
  return unknownCostCalls > 0 ? `${priced} + ${unknownCostCalls} unknown` : priced;
}

function formatCallCost(cost: NonNullable<PromptRun["modelCalls"]>[number]["cost"]): string;
function formatCallCost(cost: undefined): string;
function formatCallCost(cost: NonNullable<PromptRun["modelCalls"]>[number]["cost"] | undefined): string {
  if (cost?.status === "known") {
    return `$${cost.amountUsd.toFixed(6)} USD`;
  }
  const displayCost = cost as DisplayableCost | undefined;
  return displayCost?.status === "estimated" && typeof displayCost.amountUsd === "number"
    ? `$${displayCost.amountUsd.toFixed(6)} USD estimated`
    : "Cost unknown";
}

type DisplayableCost = {
  readonly status: string;
  readonly amountUsd?: number;
};

function getCostStatus(cost: NonNullable<PromptRun["modelCalls"]>[number]["cost"] | undefined): string | undefined {
  return (cost as DisplayableCost | undefined)?.status;
}

function getEstimatedCostUsd(cost: NonNullable<PromptRun["modelCalls"]>[number]["cost"] | undefined): number {
  const displayCost = cost as DisplayableCost | undefined;
  return displayCost?.status === "estimated" && typeof displayCost.amountUsd === "number"
    ? displayCost.amountUsd
    : 0;
}

function getDisplayProposals(run: PromptRun): TurnEffectProposal[] {
  if (run.stateProposals && run.stateProposals.length > 0) {
    return run.stateProposals;
  }
  return run.stateChanges.map((change) => {
    const match = change.match(/^\[([a-z-]+)]\s*(.*)$/i);
    return {
      kind: "memory",
      summary: match?.[2] || change,
      provenance: parseProvenance(match?.[1]),
      applied: true,
    };
  });
}

function parseProvenance(value: string | undefined): TurnEffectProvenance {
  return value === "player-action" ||
    value === "pre-turn-state" ||
    value === "tool-result" ||
    value === "model-narration"
    ? value
    : "model-narration";
}

function formatProvenance(value: TurnEffectProvenance): string {
  return value.replace(/-/g, " ");
}

function formatPhase(phase: NonNullable<PromptRun["modelCalls"]>[number]["phase"]): string {
  if (phase === "memory-evidence") return "Memory evidence brief";
  if (phase === "hidden-continuity") return "Legacy continuity preparation";
  return "Visible response";
}

function formatStatus(status: NonNullable<PromptRun["modelCalls"]>[number]["status"]): string {
  return status === "success" ? "Success" : "Error";
}
