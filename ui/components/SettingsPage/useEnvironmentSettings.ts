import { useCallback, useEffect, useState } from "react";
import type { EnvironmentSettings } from "../../../src/env";
import { loadEnvironmentSettings } from "../../persist/services";

export function useEnvironmentSettings() {
  const [settings, setSettings] = useState<EnvironmentSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const controller = new AbortController();
    setError(null);
    void loadEnvironmentSettings(controller.signal)
      .then(setSettings)
      .catch(() => {
        if (!controller.signal.aborted) {
          setError(
            "Could not load environment settings. Reopen Settings to retry.",
          );
        }
      });
    return controller;
  }, []);

  useEffect(() => {
    const controller = load();
    return () => controller.abort();
  }, [load]);

  const reload = useCallback(() => void load(), [load]);

  return { settings, error, reload };
}
