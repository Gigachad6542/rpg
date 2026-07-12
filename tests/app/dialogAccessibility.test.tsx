import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OnboardingOverlay } from "../../src/app/OnboardingOverlay";
import { MediaPreviewDialog } from "../../src/app/Overlays";

describe("modal accessibility", () => {
  it("explains hosted-provider data flow and traps onboarding focus", () => {
    render(<OnboardingOverlay onAddApiKey={vi.fn()} onOpenCards={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.queryByText(/Everything runs on your machine/i)).not.toBeInTheDocument();
    expect(screen.getByText(/chat.*persona.*memory.*lore.*provider/i)).toBeInTheDocument();
    const buttons = screen.getAllByRole("button");
    expect(document.activeElement).toBe(buttons[0]);
    buttons[buttons.length - 1]?.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("focuses and traps media-preview controls while preserving Escape", () => {
    const close = vi.fn();
    render(
      <MediaPreviewDialog
        preview={{
          label: "Map",
          artifact: {
            id: "map-1",
            imageKind: "map",
            cardId: "card-1",
            chatId: "chat-1",
            prompt: "map",
            negativePrompt: "",
            provider: "mock",
            model: "mock",
            status: "generated",
            createdAt: "2026-07-12T00:00:00.000Z",
            imageUrl: "data:image/png;base64,AA==",
          },
        }}
        close={close}
      />,
    );

    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Close media preview/i }));
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Close media preview/i }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);
  });
});
