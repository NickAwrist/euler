import { apiJson, apiVoid } from "../lib/api";

export interface ActiveRunStatus {
  active?: boolean;
  requestId?: string;
}

export async function getActiveRun(
  sessionId: string,
  signal?: AbortSignal,
): Promise<ActiveRunStatus | null> {
  return apiJson<ActiveRunStatus | null>(
    `/api/runs/active/${encodeURIComponent(sessionId)}`,
    {
      signal,
      notFound: "null",
      errorMessage: "Failed to check active run status",
    },
  );
}

export function abortRun(requestId: string): Promise<void> {
  return apiVoid("/api/runs/abort", {
    method: "POST",
    json: { requestId },
    errorMessage: "Failed to abort run",
  });
}
