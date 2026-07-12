import { useEffect } from "react";
import { Layers3, X } from "lucide-react";
import type { MediaPreviewArtifact, MemoryEntry, RuntimeCard } from "./runtimeTypes";
import { toGeneratedImageSrc } from "./generatedImages";
import { useDialogFocusTrap } from "./useDialogFocusTrap";

export function MediaPreviewDialog(props: { preview: MediaPreviewArtifact; close: () => void }) {
  const dialogRef = useDialogFocusTrap<HTMLElement>();
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        props.close();
      }
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [props]);

  const previewName = `${props.preview.label} preview`;

  return (
    <div className="media-preview-backdrop" role="presentation" onMouseDown={props.close}>
      <section
        ref={dialogRef}
        className="media-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={previewName}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="media-preview-header">
          <div>
            <p className="eyebrow">Preview</p>
            <h3>{props.preview.label}</h3>
          </div>
          <button className="icon-button" type="button" onClick={props.close} aria-label="Close media preview">
            <X size={18} />
          </button>
        </div>
        <div className="media-preview-image-wrap">
          <img
            className="media-preview-image"
            src={toGeneratedImageSrc(props.preview.artifact)}
            alt={previewName}
          />
        </div>
        <div className={`map-status ${props.preview.artifact.status}`}>
          <strong>{props.preview.artifact.status}</strong>
          <span>{props.preview.artifact.provider} / {props.preview.artifact.model}</span>
        </div>
      </section>
    </div>
  );
}

export function MemoryDrawer(props: {
  card: RuntimeCard;
  close: () => void;
  consolidate: () => void;
  isConsolidating: boolean;
  status: string | null;
  review: {
    originalMemory: MemoryEntry[];
    proposedMemory: MemoryEntry[];
  } | null;
  applyConsolidation: () => void;
  cancelConsolidation: () => void;
}) {
  const dialogRef = useDialogFocusTrap<HTMLElement>();
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        props.close();
      }
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [props]);

  return (
    <aside ref={dialogRef} className="memory-drawer" role="dialog" aria-modal="true" aria-label="Memory inspector">
      <div className="drawer-header">
        <div>
          <p className="eyebrow">Hidden until opened</p>
          <h3>{props.card.name} Memory</h3>
        </div>
        <button className="icon-button" type="button" onClick={props.close} aria-label="Close memory inspector">
          <X size={18} />
        </button>
      </div>
      <div className="button-row">
        <button
          className="secondary-button compact-button"
          type="button"
          onClick={props.consolidate}
          disabled={props.isConsolidating || Boolean(props.review) || props.card.memory.length < 2}
        >
          <Layers3 size={15} />
          {props.isConsolidating ? "Consolidating..." : "Consolidate memory"}
        </button>
      </div>
      {props.status ? (
        <p className="field-help" role="status" aria-live="polite">
          {props.status}
        </p>
      ) : null}
      {props.review ? (
        <section className="memory-consolidation-review" role="region" aria-label="Memory consolidation review">
          <div className="memory-consolidation-summary">
            <strong>{props.review.originalMemory.length} current entries</strong>
            <span aria-hidden="true">→</span>
            <strong>
              {props.review.proposedMemory.length} proposed {props.review.proposedMemory.length === 1 ? "entry" : "entries"}
            </strong>
          </div>
          <p className="field-help">Review the proposed memory below. Current memory remains authoritative until you apply it.</p>
          <div className="memory-list proposed-memory-list">
            {props.review.proposedMemory.map((entry) => (
              <article className="memory-row" key={entry.id}>
                <strong>{entry.label}</strong>
                <p>{entry.detail}</p>
              </article>
            ))}
          </div>
          <div className="button-row">
            <button className="primary-button compact-button" type="button" onClick={props.applyConsolidation}>
              Apply consolidation
            </button>
            <button className="secondary-button compact-button" type="button" onClick={props.cancelConsolidation}>
              Cancel consolidation
            </button>
          </div>
        </section>
      ) : null}
      {props.card.memory.length === 0 ? <p>No saved memory for this card yet.</p> : null}
      <div className="memory-list">
        {props.card.memory.map((entry) => (
          <article className="memory-row" key={entry.id}>
            <strong>{entry.label}</strong>
            <p>{entry.detail}</p>
          </article>
        ))}
      </div>
    </aside>
  );
}
