import { useState } from "react";
import { Download, History, Layers3, RotateCcw, Settings2, ShieldCheck, Upload } from "lucide-react";
import type { Persona } from "./runtimeTypes";
import type { HiddenContinuityMode } from "../runtime/hiddenContinuityPolicy";
import { PersonasPanel } from "./PersonasPanel";

export type RuntimeSettingsView = {
  textStreaming: boolean;
  banEmojis: boolean;
  promptDebugLogs: boolean;
  diceRollsEnabled: boolean;
  hiddenContinuityMode?: HiddenContinuityMode;
  economicalModel?: string;
  onboardingCompleted: boolean;
  accentColor: string;
};

export type RestorePointView = {
  id: string;
  label: string;
  timeLabel: string;
};

export type RuntimeImportReviewView = {
  cards: number;
  chats: number;
  messages: number;
  savedAt: string;
};

const ACCENT_PRESETS: Array<{ label: string; value: string }> = [
  { label: "Ember red", value: "#d83a2e" },
  { label: "Molten orange", value: "#e8722a" },
  { label: "Amber", value: "#e0a11f" },
  { label: "Crimson", value: "#b7263c" },
  { label: "Sunflare", value: "#f0b429" },
];

export function SettingsSection(props: {
  runtimeSettings: RuntimeSettingsView;
  setRuntimeSettings: (settings: RuntimeSettingsView) => void;
  personas: Persona[];
  activePersonaId: string;
  selectPersona: (personaId: string) => void;
  addPersona: (name: string) => void;
  editPersona: (personaId: string, changes: Partial<Persona>) => void;
  removePersona: (personaId: string) => void;
  makePersonaDefault: (personaId: string) => void;
  promptPreview: string;
  dataManagementStatus: string;
  exportRuntimeData: () => void;
  importRuntimeData: (rawJson: string) => void;
  pendingImportReview: RuntimeImportReviewView | null;
  applyRuntimeImport: () => void;
  cancelRuntimeImport: () => void;
  downloadDiagnostics: () => void;
  restorePoints: RestorePointView[];
  restoreStatus: string;
  restoreRuntimePoint: (id: string) => void;
}) {
  const [runtimeImportDraft, setRuntimeImportDraft] = useState("");

  return (
    <div className="workspace-grid settings-grid">
      <section className="panel" aria-label="Runtime settings">
        <div className="section-title">
          <Settings2 size={17} />
          <h3>Runtime Settings</h3>
        </div>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={props.runtimeSettings.textStreaming}
            onChange={(event) =>
              props.setRuntimeSettings({
                ...props.runtimeSettings,
                textStreaming: event.target.checked,
              })
            }
          />
          <span>Text streaming</span>
        </label>
        <p className="panel-hint">
          Streaming applies to session-key and local providers. Desktop keys stored in the OS keychain use
          request/response generation, so replies appear once complete.
        </p>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={props.runtimeSettings.banEmojis}
            onChange={(event) =>
              props.setRuntimeSettings({
                ...props.runtimeSettings,
                banEmojis: event.target.checked,
              })
            }
          />
          <span>Ban emojis in model replies</span>
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={props.runtimeSettings.diceRollsEnabled}
            onChange={(event) =>
              props.setRuntimeSettings({
                ...props.runtimeSettings,
                diceRollsEnabled: event.target.checked,
              })
            }
          />
          <span>Dice rolls (/roll in chat)</span>
        </label>
        <label className="field">
          <span>Hidden continuity mode</span>
          <select
            aria-label="Hidden continuity mode"
            value={props.runtimeSettings.hiddenContinuityMode ?? "full"}
            onChange={(event) =>
              props.setRuntimeSettings({
                ...props.runtimeSettings,
                hiddenContinuityMode: event.target.value as HiddenContinuityMode,
              })
            }
          >
            <option value="full">Full continuity (2 calls)</option>
            <option value="economical">Economical continuity (2 calls)</option>
            <option value="off">Off (1 call)</option>
          </select>
        </label>
        <p className="panel-hint">
          Full and economical modes make a hidden continuity call followed by the visible response. Off makes only the visible call.
        </p>
        <label className="field">
          <span>Economical continuity model</span>
          <input
            aria-label="Economical continuity model"
            value={props.runtimeSettings.economicalModel ?? ""}
            maxLength={200}
            placeholder="Small model id on the same provider"
            onChange={(event) =>
              props.setRuntimeSettings({
                ...props.runtimeSettings,
                economicalModel: event.target.value,
              })
            }
          />
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={props.runtimeSettings.promptDebugLogs}
            onChange={(event) =>
              props.setRuntimeSettings({
                ...props.runtimeSettings,
                promptDebugLogs: event.target.checked,
              })
            }
          />
          <span>Prompt debug logs</span>
        </label>
        <div className="field">
          <span>Accent color</span>
          <div className="accent-swatches">
            {ACCENT_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                className={`accent-swatch ${props.runtimeSettings.accentColor === preset.value ? "active" : ""}`}
                style={{ background: preset.value }}
                aria-label={`Use ${preset.label} accent`}
                aria-pressed={props.runtimeSettings.accentColor === preset.value}
                onClick={() =>
                  props.setRuntimeSettings({ ...props.runtimeSettings, accentColor: preset.value })
                }
              />
            ))}
          </div>
          <div className="accent-controls">
            <input
              type="color"
              aria-label="Custom accent color"
              value={props.runtimeSettings.accentColor || "#d83a2e"}
              onChange={(event) =>
                props.setRuntimeSettings({ ...props.runtimeSettings, accentColor: event.target.value })
              }
            />
            <button
              type="button"
              className="secondary-button compact-button"
              onClick={() => props.setRuntimeSettings({ ...props.runtimeSettings, accentColor: "" })}
              disabled={!props.runtimeSettings.accentColor}
            >
              Use theme default
            </button>
          </div>
        </div>
      </section>
      <PersonasPanel
        personas={props.personas}
        activePersonaId={props.activePersonaId}
        selectPersona={props.selectPersona}
        addPersona={props.addPersona}
        editPersona={props.editPersona}
        removePersona={props.removePersona}
        makePersonaDefault={props.makePersonaDefault}
      />
      <section className="panel" aria-label="Settings prompt preview">
        <div className="section-title">
          <Layers3 size={17} />
          <h3>Prompt Preview</h3>
        </div>
        <pre>{props.promptPreview || "(no runtime settings enabled)"}</pre>
      </section>
      <section className="panel" aria-label="Runtime data management">
        <div className="section-title">
          <Download size={17} />
          <h3>Runtime Data</h3>
        </div>
        <div className="button-row">
          <button className="secondary-button compact-button" type="button" onClick={props.exportRuntimeData}>
            <Download size={16} />
            Export runtime data
          </button>
          <button className="secondary-button compact-button" type="button" onClick={props.downloadDiagnostics}>
            <ShieldCheck size={16} />
            Download diagnostics
          </button>
        </div>
        <label className="field">
          <span>Runtime export JSON</span>
          <textarea
            value={runtimeImportDraft}
            onChange={(event) => setRuntimeImportDraft(event.target.value)}
            rows={8}
            placeholder='{"schema":"rpg.runtime.export","version":1,"snapshot":{...}}'
          />
        </label>
        <button
          className="primary-button compact-button"
          type="button"
          onClick={() => {
            props.importRuntimeData(runtimeImportDraft);
          }}
          disabled={!runtimeImportDraft.trim()}
        >
          <Upload size={16} />
          Review runtime import
        </button>
        {props.pendingImportReview ? (
          <div className="import-review" role="region" aria-label="Runtime import review">
            <p>
              This will replace the current runtime with {props.pendingImportReview.cards} cards, {props.pendingImportReview.chats} chats, and {props.pendingImportReview.messages} messages.
            </p>
            <p className="panel-hint">Export saved at {props.pendingImportReview.savedAt}.</p>
            <div className="button-row">
              <button
                className="primary-button compact-button"
                type="button"
                onClick={() => {
                  props.applyRuntimeImport();
                  setRuntimeImportDraft("");
                }}
              >
                Apply reviewed import
              </button>
              <button className="secondary-button compact-button" type="button" onClick={props.cancelRuntimeImport}>
                Cancel import
              </button>
            </div>
          </div>
        ) : null}
        <p className="status-line" role="status" aria-label="Data management status" aria-live="polite">
          {props.dataManagementStatus}
        </p>
      </section>
      <section className="panel" aria-label="Restore points">
        <div className="section-title">
          <History size={17} />
          <h3>Restore Points</h3>
        </div>
        <p className="panel-hint">
          Automatic snapshots persist on this device. Restore one to roll the runtime back to that state.
        </p>
        {props.restorePoints.length === 0 ? (
          <p className="empty-hint">No restore points yet — they appear as you play.</p>
        ) : (
          <ul className="restore-point-list">
            {props.restorePoints.map((point) => (
              <li key={point.id} className="restore-point-row">
                <span className="restore-point-body">
                  <span className="restore-point-label">{point.label}</span>
                  <span className="restore-point-time">{point.timeLabel}</span>
                </span>
                <button
                  type="button"
                  className="secondary-button compact-button"
                  onClick={() => props.restoreRuntimePoint(point.id)}
                >
                  <RotateCcw size={15} />
                  Restore
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="status-line" role="status" aria-label="Restore status" aria-live="polite">
          {props.restoreStatus}
        </p>
      </section>
    </div>
  );
}
