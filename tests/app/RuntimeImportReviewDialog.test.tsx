import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  RuntimeImportReviewDialog,
  type RuntimeImportReviewView,
} from "../../src/app/RuntimeImportReviewDialog";

const review: RuntimeImportReviewView = {
  cards: 3,
  chats: 5,
  messages: 21,
  savedAt: "2026-07-12T00:00:00.000Z",
  providerChanges: [{
    label: "Text provider",
    before: "openrouter / old-model at https://openrouter.ai/api/v1",
    after: "local / local-model at http://127.0.0.1:1234/v1",
  }],
};

function ReviewHarness(props: { apply: () => void; cancel: () => void }) {
  const [pendingReview, setPendingReview] = useState<RuntimeImportReviewView | null>(null);

  return (
    <>
      <button type="button" onClick={() => setPendingReview(review)}>
        Review runtime import
      </button>
      {pendingReview ? (
        <RuntimeImportReviewDialog
          review={pendingReview}
          apply={() => {
            props.apply();
            setPendingReview(null);
          }}
          cancel={() => {
            props.cancel();
            setPendingReview(null);
          }}
        />
      ) : null}
    </>
  );
}

describe("RuntimeImportReviewDialog", () => {
  it("uses a modal alert, defaults to the safe action, traps focus, and cancels with Escape", () => {
    const apply = vi.fn();
    const cancel = vi.fn();
    render(<ReviewHarness apply={apply} cancel={cancel} />);

    const opener = screen.getByRole("button", { name: /Review runtime import/i });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole("alertdialog", { name: /Replace current runtime data/i });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveTextContent(/3 cards.*5 chats.*21 messages/i);
    expect(dialog).toHaveTextContent(/restore point.*before replacement/i);
    expect(dialog).toHaveTextContent(/Text provider.*openrouter.*local-model/i);
    expect(dialog).toHaveTextContent(/Session-only credentials are cleared/i);

    const cancelButton = screen.getByRole("button", { name: /Cancel import/i });
    const applyButton = screen.getByRole("button", { name: /Replace runtime data/i });
    expect(cancelButton).toHaveFocus();

    cancelButton.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(applyButton).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(cancelButton).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("applies only from the explicit destructive action and restores focus afterward", () => {
    const apply = vi.fn();
    const cancel = vi.fn();
    render(<ReviewHarness apply={apply} cancel={cancel} />);

    const opener = screen.getByRole("button", { name: /Review runtime import/i });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole("button", { name: /Replace runtime data/i }));

    expect(apply).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
