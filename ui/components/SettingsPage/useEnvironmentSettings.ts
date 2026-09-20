import { useEffect, useState } from "react";
import type { EnvironmentSettings } from "../../../src/env";
import { globalApiJson } from "../../lib/api";

export function useEnvironmentSettings() {
  const [settings, setSettings] = useState<EnvironmentSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void globalApiJson<EnvironmentSettings>("/api/settings/environment", {
      signal: controller.signal,
    })
      .then(setSettings)
      .catch(() => {
        if (!controller.signal.aborted) {
          setError(
            "Could not load environment settings. Reopen Settings to retry.",
          );
        }
      });
    return () => controller.abort();
  }, []);

  return { settings, error };
}
