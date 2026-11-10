import { useCallback, useEffect, useState } from "react";
import type { ApiKeyProvider } from "../../../src/gen/euler/v1/providers_pb";
import { providerClient } from "../../lib/rpc";

/** Reads and updates a server-held API key without exposing its value. */
export function useApiKeySetting(provider: ApiKeyProvider) {
  const [environmentManaged, setEnvironmentManaged] = useState<boolean>();
  const [hasKey, setHasKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void providerClient
      .getApiKey({ provider })
      .then(({ state }) => {
        if (!active) return;
        setHasKey(state?.hasKey ?? false);
        setEnvironmentManaged(state?.environmentManaged ?? false);
      })
      .catch(() => {
        if (active) setLoadError("Could not load API key settings.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [provider]);

  const save = useCallback(
    async (apiKey: string) => {
      const { state } = await providerClient.setApiKey({ provider, apiKey });
      setHasKey(state?.hasKey ?? false);
    },
    [provider],
  );

  return { environmentManaged, hasKey, loading, loadError, save };
}

export type ApiKeySetting = ReturnType<typeof useApiKeySetting>;
