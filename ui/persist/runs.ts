import { apiJson, apiVoid } from "../lib/api";

export interface ActiveRunStatus {
  active?: boolean;
  requestId?: string;
}

export async function getActiveRun(
  sessionId: string,
  signal?: AbortSignal,
): Promise<ActiveRunStatus | null> {
  try {
    return await apiJson<ActiveRunStatus | null>(
      `/api/runs/active/${encodeURIComponent(sessionId)}`,
      {
        signal,
        notFound: "null",
      },
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error("Could not check the active run.");
  }
}

export function abortRun(requestId: string): Promise<void> {
  return apiVoid("/api/runs/abort", {
    method: "POST",
    json: { requestId },
    errorMessage: "Failed to abort run",
  });
}
