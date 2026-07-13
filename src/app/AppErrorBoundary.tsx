import { Component, type ErrorInfo, type ReactNode } from "react";

export interface CrashDiagnostics {
  schema: "rpg.runtime.crash-diagnostics";
  version: 1;
  occurredAt: string;
  app: { name: "Local-First RPG" };
  environment: { userAgent: string };
  error: {
    message: string;
    stack: string;
    componentStack: string;
  };
}

interface CrashDiagnosticOptions {
  now?: () => string;
  userAgent?: string;
}

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
  componentStack: string;
}

export function buildCrashDiagnostics(
  error: Error,
  componentStack = "",
  options: CrashDiagnosticOptions = {},
): CrashDiagnostics {
  return {
    schema: "rpg.runtime.crash-diagnostics",
    version: 1,
    occurredAt: options.now?.() ?? new Date().toISOString(),
    app: { name: "Local-First RPG" },
    environment: {
      userAgent: redactCrashText(options.userAgent ?? globalThis.navigator?.userAgent ?? "unknown"),
    },
    error: {
      message: redactCrashText(error.message),
      stack: redactCrashText(error.stack ?? ""),
      componentStack: redactCrashText(componentStack),
    },
  };
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null, componentStack: "" };

  static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(_error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? "" });
  }

  private retry = (): void => {
    this.setState({ error: null, componentStack: "" });
  };

  private downloadDiagnostics = (): void => {
    if (!this.state.error) {
      return;
    }
    const diagnostics = buildCrashDiagnostics(this.state.error, this.state.componentStack);
    const blob = new Blob([JSON.stringify(diagnostics, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `local-first-rpg-crash-diagnostics-${diagnostics.occurredAt.replace(/[:.]/g, "-")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <main className="crash-recovery" role="alert">
        <section className="crash-recovery-card">
          <p className="eyebrow">Recovery mode</p>
          <h1>Runtime UI crashed</h1>
          <p>
            Your local data has not been intentionally cleared. You can retry the render, reload the app, or save a
            redacted crash report for debugging.
          </p>
          <div className="button-row crash-recovery-actions">
            <button className="primary-button" type="button" onClick={this.retry}>
              Try rendering again
            </button>
            <button className="secondary-button" type="button" onClick={() => window.location.reload()}>
              Reload app
            </button>
            <button className="secondary-button" type="button" onClick={this.downloadDiagnostics}>
              Download crash diagnostics
            </button>
          </div>
        </section>
      </main>
    );
  }
}

function redactCrashText(value: string): string {
  return value
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/gi, "[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{8,}/gi, "Bearer [redacted]")
    .replace(/([?&](?:api[_-]?key|token|secret)=)[^&\s]+/gi, "$1[redacted]")
    .slice(0, 20_000);
}
