import { useCallback, useEffect, useState } from "react";
import { modelSettingsRequest } from "../../lib/modelSettingsRequest";

/** Reads and updates a server-held API key without exposing its value. */
export function useApiKeySetting(path: string) {
  const [environmentManaged, setEnvironmentManaged] = useState<boolean>();
  const [hasKey, setHasKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void modelSettingsRequest<{ hasKey: boolean; environmentManaged: boolean }>(
      path,
    )
      .then((key) => {
        if (!active) return;
        setHasKey(key.hasKey);
        setEnvironmentManaged(key.environmentManaged);
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
  }, [path]);

  const save = useCallback(
    async (apiKey: string) => {
      const result = await modelSettingsRequest<{ hasKey: boolean }>(
        path,
        "PUT",
        { apiKey },
      );
      setHasKey(result.hasKey);
    },
    [path],
  );

  return { environmentManaged, hasKey, loading, loadError, save };
}

export type ApiKeySetting = ReturnType<typeof useApiKeySetting>;
