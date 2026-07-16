import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppSidebar, AppTopbar } from "../../src/app/AppChrome";

describe("application chrome", () => {
  it("exposes current navigation, storage status, and theme controls", () => {
    const selectSection = vi.fn();
    const toggleTheme = vi.fn();

    render(
      <AppSidebar
        theme="dark"
        section="runtime"
        selectSection={selectSection}
        toggleTheme={toggleTheme}
        saveStatus="Saved locally."
        repositoryStatus="SQLite ready."
      />,
    );

    expect(screen.getByRole("button", { name: "Runtime" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Saved locally.")).toHaveAttribute("role", "status");
    expect(screen.getByText("SQLite ready.")).toHaveAttribute("role", "status");

    fireEvent.click(screen.getByRole("button", { name: "Cards" }));
    fireEvent.click(screen.getByRole("button", { name: "Light mode" }));

    expect(selectSection).toHaveBeenCalledWith("cards");
    expect(toggleTheme).toHaveBeenCalledOnce();
  });

  it("keeps active-card runtime actions explicit", () => {
    const editCard = vi.fn();
    const openMemory = vi.fn();
    const shutdownRuntime = vi.fn();

    render(
      <AppTopbar
        section="runtime"
        activeCard={{ name: "Field Notes", kind: "rpg", summary: "Private adventure" }}
        runtimeRunning
        editCard={editCard}
        openMemory={openMemory}
        shutdownRuntime={shutdownRuntime}
        startRuntime={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit card" }));
    fireEvent.click(screen.getByRole("button", { name: "Inspect memory" }));
    fireEvent.click(screen.getByRole("button", { name: "Shut down runtime" }));

    expect(editCard).toHaveBeenCalledOnce();
    expect(openMemory).toHaveBeenCalledOnce();
    expect(shutdownRuntime).toHaveBeenCalledOnce();
  });
});
