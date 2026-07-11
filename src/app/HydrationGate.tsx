import type { HydrationState } from "./startupPersistencePolicy";

type HydrationGateProps = {
  state: HydrationState;
  onRetry: () => void;
  onStartFresh: () => void;
};

/**
 * Full-screen gate shown while the persisted runtime is loading, or when a
 * desktop snapshot load failed. Blocks all interaction so user actions cannot
 * race (or overwrite) the authoritative SQLite state underneath.
 */
export function HydrationGate({ state, onRetry, onStartFresh }: HydrationGateProps) {
  if (state.phase === "ready") {
    return null;
  }

  if (state.phase === "loading") {
    return (
      <div className="hydration-gate" role="status" aria-live="polite">
        <div className="hydration-card">
          <p>Loading saved data…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="hydration-gate" role="alertdialog" aria-modal="true" aria-labelledby="hydration-failed-title">
      <div className="hydration-card">
        <h2 id="hydration-failed-title">Saved data could not be loaded</h2>
        <p className="hydration-error">{state.error}</p>
        <p>
          Autosave is paused so your existing data stays untouched. Retry loading, or archive the current
          database and start fresh — the archive is kept next to your data and can be restored later.
        </p>
        <div className="hydration-actions">
          <button type="button" className="primary" onClick={onRetry}>
            Retry loading
          </button>
          <button type="button" onClick={onStartFresh}>
            Archive and start fresh
          </button>
        </div>
      </div>
    </div>
  );
}
