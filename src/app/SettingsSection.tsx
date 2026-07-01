import { useState } from "react";
import { Download, Layers3, Settings2, ShieldCheck, Upload } from "lucide-react";

export type RuntimeSettingsView = {
  textStreaming: boolean;
  banEmojis: boolean;
  promptDebugLogs: boolean;
  impersonationPrompt: string;
};

export function SettingsSection(props: {
  runtimeSettings: RuntimeSettingsView;
  setRuntimeSettings: (settings: RuntimeSettingsView) => void;
  promptPreview: string;
  dataManagementStatus: string;
  exportRuntimeData: () => void;
  importRuntimeData: (rawJson: string) => void;
  downloadDiagnostics: () => void;
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
        <label className="field">
          <span>Impersonation prompt</span>
          <textarea
            value={props.runtimeSettings.impersonationPrompt}
            onChange={(event) =>
              props.setRuntimeSettings({
                ...props.runtimeSettings,
                impersonationPrompt: event.target.value,
              })
            }
            rows={8}
            placeholder="Describe the user's persona, point of view, boundaries, or roleplay voice the card should account for."
          />
        </label>
      </section>
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
            setRuntimeImportDraft("");
          }}
          disabled={!runtimeImportDraft.trim()}
        >
          <Upload size={16} />
          Import runtime data
        </button>
        <p className="status-line" role="status" aria-label="Data management status" aria-live="polite">
          {props.dataManagementStatus}
        </p>
      </section>
    </div>
  );
}
