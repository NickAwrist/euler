import { useEffect, useState } from "react";
import { fetchWorkspaceFiles } from "../persist/sessions";
import type { SessionWorkspace, WorkspaceFile } from "../types";

export function useWorkspaceFileSuggestions(
  sessionId: string | null,
  workspace: SessionWorkspace,
  query: string | undefined,
): { files: WorkspaceFile[]; status: "loading" | "error" | "ready" } {
  const workspaceKey = JSON.stringify(workspace);
  const key = JSON.stringify([sessionId, workspaceKey, query]);
  const [result, setResult] = useState<{
    key: string;
    files: WorkspaceFile[];
    error: boolean;
  } | null>(null);

  useEffect(() => {
    if (!sessionId || query === undefined) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetchWorkspaceFiles(sessionId, query, controller.signal)
        .then((files) => {
          if (!controller.signal.aborted) {
            setResult({ key, files: files.slice(0, 8), error: false });
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setResult({ key, files: [], error: true });
          }
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [sessionId, query, key]);

  return result?.key === key
    ? { files: result.files, status: result.error ? "error" : "ready" }
    : { files: [], status: "loading" };
}
