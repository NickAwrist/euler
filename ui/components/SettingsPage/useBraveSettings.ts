import { useCallback, useEffect, useRef, useState } from "react";
import {
  type BraveSettings,
  loadBraveSettings,
  saveBraveKey,
} from "../../persist/brave";

/** Brave key status and an unsaved key that lives only in component state. */
export function useBraveSettings() {
  const [settings, setSettings] = useState<BraveSettings | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRequest = useRef(0);
  const load = useCallback(async () => {
    const request = ++loadRequest.current;
    setError(null);
    try {
      const next = await loadBraveSettings();
      if (request === loadRequest.current) setSettings(next);
    } catch {
      if (request === loadRequest.current)
        setError("Could not load Brave settings.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  /** Saves `value` (empty removes the key); resolves false and shows the error on failure. */
  const save = async (value: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const { hasKey } = await saveBraveKey(value);
      setSettings((current) => current && { ...current, hasKey });
      setKey("");
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save Brave key.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  return {
    settings,
    key,
    setKey,
    busy,
    error,
    load,
    save,
    reset: () => {
      setKey("");
      if (settings) setError(null);
    },
  };
}

export type BraveSettingsState = ReturnType<typeof useBraveSettings>;
