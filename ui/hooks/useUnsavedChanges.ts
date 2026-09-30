import { useEffect, useRef, useState } from "react";
import { addNavigationGuard } from "../lib/navigation";

// Approval lasts for one navigation attempt, even if another guard cancels it.
export function useUnsavedChanges(
  isDirty: boolean,
  internalPathPrefix?: string,
) {
  const [prompt, setPrompt] = useState<"leave" | "discard" | null>(null);
  const pendingLeave = useRef<((approved: boolean) => void) | null>(null);

  useEffect(() => {
    if (!isDirty) return;
    return addNavigationGuard(async (path) => {
      if (internalPathPrefix && path.startsWith(internalPathPrefix))
        return true;
      return new Promise<boolean>((resolve) => {
        pendingLeave.current = resolve;
        setPrompt("leave");
      });
    });
  }, [isDirty, internalPathPrefix]);

  const resolveLeave = (approved: boolean) => {
    pendingLeave.current?.(approved);
    pendingLeave.current = null;
    setPrompt(null);
  };

  return { prompt, setPrompt, resolveLeave };
}
