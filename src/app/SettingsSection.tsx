import { useState } from "react";
import { Check, Download, ExternalLink, History, Info, Layers3, Palette, RotateCcw, Settings2, ShieldCheck, Upload, X } from "lucide-react";
import type { HiddenContinuityMode } from "../runtime/hiddenContinuityPolicy";
import {
  THEME_TOKENS,
  accentDefault,
  countContrastFailures,
  evaluateThemeContrast,
  isHexColor,
  themeTokenDefault,
  type ThemeColorKey,
  type ThemeColorOverrides,
  type ThemeMode,
} from "./themeColors";
import { APP_HELP_URL, APP_NAME, APP_SUPPORT_URL, APP_UPDATES_URL, APP_VERSION } from "./productInfo";
import {
  RuntimeImportReviewDialog,
  type RuntimeImportReviewView,
} from "./RuntimeImportReviewDialog";
import { DestructiveActionDialog } from "./DestructiveActionDialog";

export type RuntimeSettingsView = {
  textStreaming: boolean;
  banEmojis: boolean;
  promptDebugLogs: boolean;
  diceRollsEnabled: boolean;
  hiddenContinuityMode?: HiddenContinuityMode;
  economicalModel?: string;
  onboardingCompleted: boolean;
  accentColor: string;
  themeColors?: ThemeColorOverrides;
};

export type RestorePointView = {
  id: string;
  label: string;
  timeLabel: string;
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
  theme?: ThemeMode;
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
  const [pendingRestorePoint, setPendingRestorePoint] = useState<RestorePointView | null>(null);
  const mode: ThemeMode = props.theme ?? "light";
  const themeColors = props.runtimeSettings.themeColors ?? {};
  const hasCustomColors =
    isHexColor(props.runtimeSettings.accentColor) || Object.keys(themeColors).length > 0;
  const contrastResults = evaluateThemeContrast(props.runtimeSettings.accentColor, themeColors, mode);
  const contrastFailures = countContrastFailures(contrastResults);

  const setAccent = (value: string) => {
    props.setRuntimeSettings({ ...props.runtimeSettings, accentColor: value });
  };
  const setThemeColor = (key: ThemeColorKey, value: string) => {
    const next: ThemeColorOverrides = {};
    for (const token of THEME_TOKENS) {
      const current = token.key === key ? value : themeColors[token.key];
      if (isHexColor(current)) {
        next[token.key] = current;
      }
    }
    props.setRuntimeSettings({ ...props.runtimeSettings, themeColors: next });
  };
  const resetAllColors = () => {
    props.setRuntimeSettings({ ...props.runtimeSettings, accentColor: "", themeColors: {} });
  };

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
        <details className="advanced-settings-disclosure">
          <summary>Advanced prompt diagnostics</summary>
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
            <span>Retain prompt debug logs</span>
          </label>
          <p className="field-help">Debug logs can contain card, persona, lore, memory, and chat context. Leave this off unless you are diagnosing a prompt.</p>
        </details>
      </section>
      <section className="panel" aria-label="Theme colors">
        <div className="section-title">
          <Palette size={17} />
          <h3>Theme Colors</h3>
        </div>
        <p className="panel-hint">
          Recolor every surface of the app. Swatches you leave untouched keep the built-in palette, so the
          default look is unchanged. Contrast is checked against WCAG AA so text and controls stay legible.
        </p>
        <div className="theme-color-list">
          <div className="theme-color-row">
            <div className="theme-color-label">
              <span className="theme-color-name">Accent</span>
              <span className="theme-color-desc">Links, highlights, and focus rings.</span>
            </div>
            <div className="theme-color-controls">
              <div className="accent-swatches">
                {ACCENT_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    className={`accent-swatch ${props.runtimeSettings.accentColor === preset.value ? "active" : ""}`}
                    style={{ background: preset.value }}
                    aria-label={`Use ${preset.label} accent`}
                    aria-pressed={props.runtimeSettings.accentColor === preset.value}
                    onClick={() => setAccent(preset.value)}
                  />
                ))}
              </div>
              <input
                type="color"
                aria-label="Accent color"
                value={isHexColor(props.runtimeSettings.accentColor) ? props.runtimeSettings.accentColor : accentDefault(mode)}
                onChange={(event) => setAccent(event.target.value)}
              />
              <button
                type="button"
                className="secondary-button compact-button"
                onClick={() => setAccent("")}
                disabled={!props.runtimeSettings.accentColor}
              >
                Reset
              </button>
            </div>
          </div>
          {THEME_TOKENS.map((token) => {
            const value = themeColors[token.key];
            const isSet = isHexColor(value);
            return (
              <div className="theme-color-row" key={token.key}>
                <div className="theme-color-label">
                  <span className="theme-color-name">{token.label}</span>
                  <span className="theme-color-desc">{token.description}</span>
                </div>
                <div className="theme-color-controls">
                  <input
                    type="color"
                    aria-label={`${token.label} color`}
                    value={isSet ? value : themeTokenDefault(token.key, mode)}
                    onChange={(event) => setThemeColor(token.key, event.target.value)}
                  />
                  <button
                    type="button"
                    className="secondary-button compact-button"
                    onClick={() => setThemeColor(token.key, "")}
                    disabled={!isSet}
                  >
                    Reset
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="button-row">
          <button
            type="button"
            className="secondary-button compact-button"
            onClick={resetAllColors}
            disabled={!hasCustomColors}
          >
            <RotateCcw size={15} />
            Reset all colors
          </button>
        </div>
        {contrastResults.length > 0 ? (
          <div className="contrast-report" role="group" aria-label="Color accessibility">
            <p
              className={`contrast-summary ${contrastFailures > 0 ? "has-issues" : "all-clear"}`}
              role="status"
              aria-live="polite"
            >
              {contrastFailures > 0
                ? `${contrastFailures} color pair${contrastFailures === 1 ? "" : "s"} below WCAG AA`
                : "All customized colors meet WCAG AA"}
            </p>
            <ul className="contrast-list">
              {contrastResults.map((result) => (
                <li key={result.id} className={`contrast-item ${result.passes ? "pass" : "fail"}`}>
                  {result.passes ? <Check size={14} aria-hidden /> : <X size={14} aria-hidden />}
                  <span className="contrast-item-label">{result.label}</span>
                  <span className="contrast-item-ratio">{result.ratio.toFixed(2)}:1</span>
                  <span className="contrast-item-target">needs {result.minRatio}:1</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
      <details className="panel advanced-settings-disclosure" role="region" aria-label="Settings prompt preview (advanced)">
        <summary className="section-title">
          <Layers3 size={17} />
          <h3>Advanced prompt preview</h3>
        </summary>
        <p className="field-help">This may contain private story, persona, lore, and memory text that would be sent to the configured model.</p>
        <pre>{props.promptPreview || "(no runtime settings enabled)"}</pre>
      </details>
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
          <RuntimeImportReviewDialog
            review={props.pendingImportReview}
            apply={() => {
              props.applyRuntimeImport();
              setRuntimeImportDraft("");
            }}
            cancel={props.cancelRuntimeImport}
          />
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
                  aria-label={`Restore ${point.label}`}
                  onClick={() => setPendingRestorePoint(point)}
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
        {pendingRestorePoint ? (
          <DestructiveActionDialog
            eyebrow="Restore runtime"
            title={`Restore ${pendingRestorePoint.label}?`}
            cancelLabel="Cancel restore"
            confirmLabel="Restore selected point"
            cancel={() => setPendingRestorePoint(null)}
            confirm={() => {
              props.restoreRuntimePoint(pendingRestorePoint.id);
              setPendingRestorePoint(null);
            }}
          >
            <p>This replaces the current runtime with the selected local snapshot from {pendingRestorePoint.timeLabel}.</p>
            <p className="panel-hint">
              The current runtime is captured as a new local restore point immediately before replacement.
            </p>
          </DestructiveActionDialog>
        ) : null}
      </section>
      <section className="panel" aria-label="About Local-First RPG">
        <div className="section-title">
          <Info size={17} />
          <h3>About {APP_NAME}</h3>
        </div>
        <dl className="compact-dl">
          <dt>Version</dt><dd>{APP_VERSION}</dd>
          <dt>Data</dt><dd>Local SQLite and OS keychain references</dd>
          <dt>Updates</dt><dd>Manual, signed releases; automatic updating is not enabled.</dd>
        </dl>
        <div className="button-row">
          <a className="secondary-button compact-button" href={APP_HELP_URL} target="_blank" rel="noreferrer">
            <ExternalLink size={15} /> Help
          </a>
          <a className="secondary-button compact-button" href={APP_SUPPORT_URL} target="_blank" rel="noreferrer">
            <ExternalLink size={15} /> Support
          </a>
          <a className="secondary-button compact-button" href={APP_UPDATES_URL} target="_blank" rel="noreferrer">
            <ExternalLink size={15} /> Check for updates
          </a>
        </div>
        <p className="field-help">External links open the project site. No update is downloaded or installed automatically.</p>
      </section>
    </div>
  );
}
