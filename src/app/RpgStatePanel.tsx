import { CheckCircle2, Sparkles } from "lucide-react";
import type { RpgCardState } from "./runtimeTypes";
import { formatFlagsForInput, parseFlags, parseList } from "./appUtils";

export function RpgStatePanel(props: {
  rpg: RpgCardState;
  updateRpgState: (patch: Partial<RpgCardState>) => void;
}) {
  return (
    <section className="tab-panel" aria-label="RPG state">
      <div className="section-title">
        <Sparkles size={17} />
        <h3>RPG State</h3>
      </div>
      <dl className="compact-dl">
        <div>
          <dt>Location</dt>
          <dd>{props.rpg.location}</dd>
        </div>
        <div>
          <dt>Health</dt>
          <dd>{props.rpg.health}</dd>
        </div>
        <div>
          <dt>Inventory</dt>
          <dd>{props.rpg.inventory.join(", ") || "none"}</dd>
        </div>
      </dl>
      <div className="rpg-editor-grid">
        <label className="field">
          <span>Location</span>
          <input
            value={props.rpg.location}
            onChange={(event) => props.updateRpgState({ location: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Health or status</span>
          <input
            value={props.rpg.health}
            onChange={(event) => props.updateRpgState({ health: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Inventory</span>
          <textarea
            value={props.rpg.inventory.join("\n")}
            onChange={(event) => props.updateRpgState({ inventory: parseList(event.target.value) })}
            rows={4}
          />
        </label>
        <label className="field">
          <span>Quests</span>
          <textarea
            value={props.rpg.quests.join("\n")}
            onChange={(event) => props.updateRpgState({ quests: parseList(event.target.value) })}
            rows={4}
          />
        </label>
        <label className="field">
          <span>Known places</span>
          <textarea
            value={props.rpg.knownPlaces.join("\n")}
            onChange={(event) => props.updateRpgState({ knownPlaces: parseList(event.target.value) })}
            rows={4}
          />
        </label>
        <label className="field">
          <span>World flags</span>
          <textarea
            value={formatFlagsForInput(props.rpg.flags)}
            onChange={(event) => props.updateRpgState({ flags: parseFlags(event.target.value) })}
            rows={4}
            placeholder="gate_open=true"
          />
        </label>
      </div>
      <div className="pill-list">
        {props.rpg.quests.length === 0 ? <span>No quests configured</span> : null}
        {props.rpg.quests.map((quest) => (
          <span key={quest}>{quest}</span>
        ))}
      </div>
      <div className="flag-grid">
        {Object.keys(props.rpg.flags).length === 0 ? <span>No flags configured</span> : null}
        {Object.entries(props.rpg.flags).map(([flag, enabled]) => (
          <span className={enabled ? "flag-on" : "flag-off"} key={flag}>
            <CheckCircle2 size={14} />
            {flag}
          </span>
        ))}
      </div>
    </section>
  );
}
