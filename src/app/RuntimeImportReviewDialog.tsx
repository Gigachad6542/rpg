import { DestructiveActionDialog } from "./DestructiveActionDialog";

export type RuntimeImportReviewView = {
  cards: number;
  chats: number;
  messages: number;
  savedAt: string;
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
    </DestructiveActionDialog>
  );
}
