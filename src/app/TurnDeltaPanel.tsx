import { RotateCcw, ShieldAlert } from "lucide-react";

import type { PromptRun } from "./runtimeTypes";
import type { TurnEffectProposal, TurnEffectProvenance } from "./turnEffects";

export function TurnDeltaPanel(props: {
  run: PromptRun;
  onUndo: () => void;
  canUndo?: boolean;
  undone?: boolean;
}) {
  const proposals = getDisplayProposals(props.run);
  const modelCalls = props.run.modelCalls ?? [];
  if (proposals.length === 0 && modelCalls.length === 0) {
    return null;
  }
  const applied = proposals.filter((proposal) => proposal.applied);
  const blocked = proposals.filter((proposal) => !proposal.applied);
  const combinedTokens = modelCalls.reduce((total, call) => total + call.usage.totalTokens, 0);

  return (
    <div className="turn-metadata-panels">
      {modelCalls.length > 0 ? (
        <details className="model-call-panel">
          <summary>{modelCalls.length} model calls · {combinedTokens} tokens</summary>
          <ul className="model-call-list">
            {modelCalls.map((call) => (
              <li key={call.phase}>
                <div className="model-call-heading">
                  <strong>{formatPhase(call.phase)}</strong>
                  <span className={`model-call-status ${call.status}`}>{formatStatus(call.status)}</span>
                </div>
                <span>{call.provider} / {call.model}</span>
                <span>{call.usage.inputTokens} input · {call.usage.outputTokens} output · {call.usage.totalTokens} total</span>
                <span>{Math.round(call.durationMs)} ms</span>
              </li>
            ))}
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
  return phase === "hidden-continuity" ? "Continuity preparation" : "Visible response";
}

function formatStatus(status: NonNullable<PromptRun["modelCalls"]>[number]["status"]): string {
  return status === "success" ? "Success" : "Error";
}
