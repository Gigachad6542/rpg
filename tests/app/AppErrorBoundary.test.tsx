import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppErrorBoundary, buildCrashDiagnostics } from "../../src/app/AppErrorBoundary";

function CrashingView(): never {
  throw new Error("render failed with sk-super-secret-token");
}

describe("application error boundary", () => {
  it("replaces a render crash with a recovery screen", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      render(
        <AppErrorBoundary>
          <CrashingView />
        </AppErrorBoundary>,
      );
      expect(screen.getByRole("alert")).toHaveTextContent(/runtime UI crashed/i);
      expect(screen.getByRole("button", { name: /Download crash diagnostics/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Try rendering again/i })).toBeInTheDocument();
      expect(screen.queryByText(/sk-super-secret-token/i)).not.toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("redacts secret-like values from crash diagnostics", () => {
    const diagnostics = buildCrashDiagnostics(
      new Error("provider failed with sk-super-secret-token and Bearer abcdefghijklmnop"),
      "component at sk-another-secret-token",
      { now: () => "2026-07-12T00:00:00.000Z", userAgent: "test-agent" },
    );
    const serialized = JSON.stringify(diagnostics);

    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toContain("sk-super-secret-token");
    expect(serialized).not.toContain("sk-another-secret-token");
    expect(serialized).not.toContain("abcdefghijklmnop");
    expect(diagnostics.occurredAt).toBe("2026-07-12T00:00:00.000Z");
  });

  it("offers a local diagnostics download from the fallback", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const createObjectUrl = vi.fn(() => "blob:crash-diagnostics");
    const revokeObjectUrl = vi.fn();
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    Object.defineProperty(URL, "createObjectURL", { value: createObjectUrl, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectUrl, configurable: true });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    try {
      render(
        <AppErrorBoundary>
          <CrashingView />
        </AppErrorBoundary>,
      );
      fireEvent.click(screen.getByRole("button", { name: /Download crash diagnostics/i }));
      expect(createObjectUrl).toHaveBeenCalledTimes(1);
      expect(click).toHaveBeenCalledTimes(1);
      expect(revokeObjectUrl).toHaveBeenCalledWith("blob:crash-diagnostics");
    } finally {
      consoleError.mockRestore();
      click.mockRestore();
      Object.defineProperty(URL, "createObjectURL", { value: originalCreateObjectUrl, configurable: true });
      Object.defineProperty(URL, "revokeObjectURL", { value: originalRevokeObjectUrl, configurable: true });
    }
  });
});
