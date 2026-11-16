import { useEffect, useState } from "react";
import { type Feature, fetchFeatures } from "../persist/features";

/** The server's features, loaded on mount. Null until they arrive. */
export function useFeatures() {
  const [features, setFeatures] = useState<Feature[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchFeatures()
      .then((loaded) => {
        if (!cancelled) setFeatures(loaded);
      })
      .catch((loadError: unknown) => {
        if (!cancelled)
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load features",
          );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { features, setFeatures, error, setError };
}
