import { useEffect, useState } from "react";
import type { ArtifactSource } from "./api";

// Checks the workspace root once per workspace. Null means not yet known.
export function useWorkspaceHasFiles(
  source: ArtifactSource,
  workspaceKey: string,
  enabled: boolean,
): boolean | null {
  const [result, setResult] = useState<{
    workspaceKey: string;
    hasFiles: boolean;
  } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    source.list(".", controller.signal).then(
      (entries) => setResult({ workspaceKey, hasFiles: entries.length > 0 }),
      () => {
        // Keep the panel available so it can show the listing error.
        if (!controller.signal.aborted)
          setResult({ workspaceKey, hasFiles: true });
      },
    );
    return () => controller.abort();
  }, [source, workspaceKey, enabled]);
  return result?.workspaceKey === workspaceKey ? result.hasFiles : null;
}
