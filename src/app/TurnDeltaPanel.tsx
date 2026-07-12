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
  if (proposals.length === 0) {
    return null;
  }
  const applied = proposals.filter((proposal) => proposal.applied);
  const blocked = proposals.filter((proposal) => !proposal.applied);

  return (
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
