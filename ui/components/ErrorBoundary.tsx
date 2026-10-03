import { Component, type ReactNode } from "react";
import { Button } from "./Button";

/**
 * Replaces a UI that failed to render. Request failures are handled by the
 * feature hooks that make them, not here.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="alert"
        className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center"
      >
        <p className="text-sm text-foreground">
          Euler could not display this page.
        </p>
        <Button variant="secondary" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    );
  }
}
