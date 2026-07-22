import { DestructiveActionDialog } from "./DestructiveActionDialog";
import type { RuntimeProviderChangeReview } from "./runtimeImportReview";

export type RuntimeImportReviewView = {
  cards: number;
  chats: number;
  messages: number;
  savedAt: string;
  providerChanges: RuntimeProviderChangeReview[];
};

export function RuntimeImportReviewDialog(props: {
  review: RuntimeImportReviewView;
  applyDisabled?: boolean;
  apply: () => void;
  cancel: () => void;
}) {
  const { review, apply, cancel } = props;

  return (
    <DestructiveActionDialog
      title="Replace current runtime data?"
      cancelLabel="Cancel import"
      confirmLabel="Replace runtime data"
      confirmDisabled={props.applyDisabled}
      cancel={cancel}
      confirm={apply}
    >
      <p>
        This will replace the current runtime with {review.cards} cards, {review.chats} chats, and {review.messages}{" "}
        messages.
      </p>
      <p className="panel-hint">
        A local restore point is created immediately before replacement. Import saved at {review.savedAt}.
      </p>
      {review.providerChanges.length > 0 ? (
        <div className="panel-hint">
          <strong>Provider configuration changes</strong>
          <ul>
            {review.providerChanges.map((change) => (
              <li key={change.label}>
                {change.label}: {change.before} → {change.after}
              </li>
            ))}
          </ul>
          <span>Session-only credentials are cleared when a provider identity or endpoint changes.</span>
        </div>
      ) : null}
    </DestructiveActionDialog>
  );
}
