import { useEffect, useId, type ReactNode } from "react";
import { ShieldAlert } from "lucide-react";

import { useDialogFocusTrap } from "./useDialogFocusTrap";

export function DestructiveActionDialog(props: {
  eyebrow?: string;
  title: string;
  children: ReactNode;
  cancelLabel: string;
  confirmLabel: string;
  confirmDisabled?: boolean;
  cancel: () => void;
  confirm: () => void;
}) {
  const { cancel } = props;
  const dialogRef = useDialogFocusTrap<HTMLElement>();
  const titleId = useId();
  const descriptionId = useId();

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
    <div className="destructive-action-backdrop" role="presentation" onMouseDown={cancel}>
      <section
        ref={dialogRef}
        className="destructive-action-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="destructive-action-dialog-heading">
          <ShieldAlert size={20} aria-hidden="true" />
          <div>
            <p className="eyebrow">{props.eyebrow ?? "Final confirmation"}</p>
            <h3 id={titleId}>{props.title}</h3>
          </div>
        </div>
        <div id={descriptionId}>{props.children}</div>
        <div className="button-row">
          <button className="secondary-button compact-button" type="button" onClick={cancel}>
            {props.cancelLabel}
          </button>
          <button
            className="secondary-button danger-button compact-button"
            type="button"
            onClick={props.confirm}
            disabled={props.confirmDisabled}
          >
            {props.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
