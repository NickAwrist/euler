import { apiBlob, apiJson, apiVoid } from "../lib/api";
import type {
  Message,
  SessionSummary,
  SessionWorkspace,
  WorkspaceFile,
} from "../types";

export type StoredRunSession = {
  id: string;
  createdAt: number;
  updatedAt: number;
  customTitle?: string | null;
  history: Message[];
  modelMessages?: Array<Record<string, unknown>> | null;
  model?: string | null;
  workspace?: SessionWorkspace;
};

export async function fetchSessionSummaries(): Promise<SessionSummary[]> {
  const data = await apiJson<{ sessions?: unknown }>("/api/sessions");
  const raw = Array.isArray(data.sessions) ? data.sessions : [];
  return raw
    .filter(
      (s): s is Record<string, unknown> => s != null && typeof s === "object",
    )
    .map((s) => ({
      id: String(s.id ?? ""),
      createdAt: Number(s.createdAt) || 0,
      updatedAt: Number(s.updatedAt) || 0,
      preview: String(s.preview ?? "New chat"),
    }))
    .filter((s) => s.id.length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

const inFlightSessionFetches = new Map<
  string,
  Promise<StoredRunSession | null>
>();

// Stream completion must bypass any navigation snapshot requested before the run finished.
export function fetchSession(
  id: string,
  options?: { fresh?: boolean },
): Promise<StoredRunSession | null> {
  const pending = inFlightSessionFetches.get(id);
  if (pending && !options?.fresh) return pending;
  const request = fetchSessionData(id).finally(() => {
    if (inFlightSessionFetches.get(id) === request)
      inFlightSessionFetches.delete(id);
  });
  inFlightSessionFetches.set(id, request);
  return request;
}

async function fetchSessionData(id: string): Promise<StoredRunSession | null> {
  const s = await apiJson<Record<string, unknown> | null>(
    `/api/sessions/${encodeURIComponent(id)}`,
    { notFound: "null" },
  );
  if (!s) return null;
  return {
    id: String(s.id ?? ""),
    createdAt: Number(s.createdAt) || 0,
    updatedAt: Number(s.updatedAt) || 0,
    customTitle: s.customTitle == null ? null : String(s.customTitle),
    history: Array.isArray(s.history) ? (s.history as Message[]) : [],
    modelMessages:
      s.modelMessages === null || s.modelMessages === undefined
        ? null
        : Array.isArray(s.modelMessages)
          ? (s.modelMessages as Array<Record<string, unknown>>)
          : null,
    model: s.model == null ? null : String(s.model),
    workspace:
      s.workspace &&
      typeof s.workspace === "object" &&
      (s.workspace as { kind?: unknown }).kind === "local"
        ? {
            kind: "local",
            path: String((s.workspace as { path?: unknown }).path ?? ""),
            label: String((s.workspace as { label?: unknown }).label ?? ""),
          }
        : { kind: "sandbox" },
  };
}

export async function createSessionApi(opts?: {
  model?: string | null;
}): Promise<{
  id: string;
  createdAt: number;
  updatedAt: number;
}> {
  const body: Record<string, string> = {};
  if (opts?.model?.trim()) body.model = opts.model.trim();
  const j = await apiJson<Record<string, unknown>>("/api/sessions", {
    method: "POST",
    json: body,
  });
  return {
    id: String(j.id ?? ""),
    createdAt: Number(j.createdAt) || Date.now(),
    updatedAt: Number(j.updatedAt) || Date.now(),
  };
}

export function patchSessionApi(
  id: string,
  body: Record<string, unknown>,
): Promise<void> {
  return apiVoid(`/api/sessions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    json: body,
  });
}

export function deleteSessionApi(id: string): Promise<void> {
  return apiVoid(`/api/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
    notFound: "null",
  });
}

export async function selectSessionDirectory(
  id: string,
  path: string,
  temporary = false,
): Promise<SessionWorkspace> {
  const base = temporary ? "/api/temporary-sessions" : "/api/sessions";
  const data = await apiJson<{ workspace: SessionWorkspace }>(
    `${base}/${encodeURIComponent(id)}/workspace/select-directory`,
    {
      method: "POST",
      json: { path },
    },
  );
  return data.workspace;
}

export async function useSessionSandbox(
  id: string,
  temporary = false,
): Promise<SessionWorkspace> {
  const base = temporary ? "/api/temporary-sessions" : "/api/sessions";
  await apiVoid(`${base}/${encodeURIComponent(id)}/workspace/use-sandbox`, {
    method: "POST",
  });
  return { kind: "sandbox" };
}

export async function fetchWorkspaceFiles(
  id: string,
  temporary = false,
): Promise<WorkspaceFile[]> {
  const path = temporary
    ? `/api/temporary-sessions/${encodeURIComponent(id)}/files`
    : `/api/sessions/${encodeURIComponent(id)}/workspace/files`;
  const data = await apiJson<{ files?: WorkspaceFile[] }>(path);
  return Array.isArray(data.files) ? data.files : [];
}

export async function downloadWorkspaceFile(
  sessionId: string,
  filePath: string,
  temporary = false,
): Promise<Blob> {
  const path = temporary
    ? `/api/temporary-sessions/${encodeURIComponent(sessionId)}/file?path=${encodeURIComponent(filePath)}`
    : `/api/sessions/${encodeURIComponent(sessionId)}/workspace/file?path=${encodeURIComponent(filePath)}`;
  return apiBlob(path);
}

export function revealWorkspaceFile(
  sessionId: string,
  filePath: string,
  temporary = false,
): Promise<void> {
  const base = temporary
    ? `/api/temporary-sessions/${encodeURIComponent(sessionId)}`
    : `/api/sessions/${encodeURIComponent(sessionId)}/workspace`;
  return apiVoid(`${base}/reveal`, {
    method: "POST",
    json: { path: filePath },
  });
}

export async function createTemporarySessionApi(): Promise<{ id: string }> {
  const data = await apiJson<{ id?: unknown }>("/api/temporary-sessions", {
    method: "POST",
  });
  return { id: String(data.id ?? "") };
}

export function deleteTemporarySessionApi(id: string): Promise<void> {
  return apiVoid(`/api/temporary-sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
    keepalive: true,
    notFound: "null",
  });
}
