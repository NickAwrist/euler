import { type ReactNode, useEffect, useState } from "react";
import { applyAppearance, loadAppearance } from "../persist/appearance";
import { initializeUserPreferences } from "../persist/userPreferences";
import { Button } from "./Button";

export function UserPreferencesGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    void initializeUserPreferences()
      .then(() => {
        if (cancelled) return;
        applyAppearance(loadAppearance());
        setReady(true);
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setError(
            error instanceof Error ? error.message : "Could not load settings",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);
  if (!ready)
    return (
      <output>
        {error ?? "Loading settings…"}
        {error && (
          <Button onClick={() => setAttempt((value) => value + 1)}>
            Retry
          </Button>
        )}
      </output>
    );
  return children;
}
