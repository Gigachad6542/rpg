import { useEffect } from "react";
import { ShieldAlert } from "lucide-react";

import { useDialogFocusTrap } from "./useDialogFocusTrap";

export type RuntimeImportReviewView = {
  cards: number;
  chats: number;
  messages: number;
  savedAt: string;
};

export function RuntimeImportReviewDialog(props: {
  review: RuntimeImportReviewView;
  apply: () => void;
  cancel: () => void;
}) {
  const { review, apply, cancel } = props;
  const dialogRef = useDialogFocusTrap<HTMLElement>();

  useEffect(() => {
    function cancelOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      }
    }

    document.addEventListener("keydown", cancelOnEscape);
    return () => document.removeEventListener("keydown", cancelOnEscape);
  }, [cancel]);

  return (
    <div className="runtime-import-backdrop" role="presentation" onMouseDown={cancel}>
      <section
        ref={dialogRef}
        className="runtime-import-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="runtime-import-review-title"
        aria-describedby="runtime-import-review-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="runtime-import-dialog-heading">
          <ShieldAlert size={20} aria-hidden="true" />
          <div>
            <p className="eyebrow">Final confirmation</p>
            <h3 id="runtime-import-review-title">Replace current runtime data?</h3>
          </div>
        </div>
        <div id="runtime-import-review-description">
          <p>
            This will replace the current runtime with {review.cards} cards, {review.chats} chats,
            and {review.messages} messages.
          </p>
          <p className="panel-hint">
            A local restore point is created immediately before replacement. Import saved at {review.savedAt}.
          </p>
        </div>
        <div className="button-row">
          <button className="secondary-button compact-button" type="button" onClick={cancel}>
            Cancel import
          </button>
          <button className="secondary-button danger-button compact-button" type="button" onClick={apply}>
            Replace runtime data
          </button>
        </div>
      </section>
    </div>
  );
}
