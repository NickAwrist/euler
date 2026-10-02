import { type SetStateAction, useCallback, useEffect, useState } from "react";

/**
 * Local edits of a saved value. The draft follows `saved` until the user edits
 * it, so a refreshed saved value never overwrites unsaved input. `saved` must
 * keep a stable identity between renders.
 */
export function useSavedDraft<T>(saved: T) {
  const [value, setDraftValue] = useState(saved);
  const [edited, setEdited] = useState(false);

  useEffect(() => {
    if (!edited) setDraftValue(saved);
  }, [saved, edited]);

  const setValue = useCallback((next: SetStateAction<T>) => {
    setEdited(true);
    setDraftValue(next);
  }, []);
  /** Drops the draft and shows the saved value again. */
  const reset = useCallback(() => {
    setEdited(false);
    setDraftValue(saved);
  }, [saved]);
  /** Marks the draft as saved so it follows the next saved value. */
  const accept = useCallback(() => setEdited(false), []);

  return { value, setValue, reset, accept };
}
