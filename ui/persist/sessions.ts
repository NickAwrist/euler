import {
  type StoredRunSession as SchemaStoredRunSession,
  type SessionSummary,
  SessionSummaryListSchema,
  type SessionWorkspace,
  StoredRunSessionSchema,
} from "../../src/schemas/sessions";
import { apiBlob, apiJson, apiVoid } from "../lib/api";
import type { Message, WorkspaceFile } from "../types";

export type StoredRunSession = Omit<
  SchemaStoredRunSession,
  "history" | "workspace"
> & {
  history: Message[];
  workspace?: SessionWorkspace;
};
export type { SessionSummary, SessionWorkspace };

export async function fetchSessionSummaries(): Promise<SessionSummary[]> {
  const data = await apiJson<unknown>("/api/sessions");
  const parsed = SessionSummaryListSchema.safeParse(data);
  if (!parsed.success) return [];
  return [...parsed.data.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
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
  const s = await apiJson<unknown>(`/api/sessions/${encodeURIComponent(id)}`, {
    notFound: "null",
  });
  if (!s) return null;
  const parsed = StoredRunSessionSchema.safeParse(s);
  if (parsed.success) return parsed.data as StoredRunSession;
  if (typeof s === "object" && s !== null) {
    const raw = s as Record<string, unknown>;
    return {
      id: String(raw.id ?? ""),
      createdAt: Number(raw.createdAt) || 0,
      updatedAt: Number(raw.updatedAt) || 0,
      customTitle: raw.customTitle == null ? null : String(raw.customTitle),
      history: Array.isArray(raw.history) ? (raw.history as Message[]) : [],
      modelMessages:
        raw.modelMessages === null || raw.modelMessages === undefined
          ? null
          : Array.isArray(raw.modelMessages)
            ? (raw.modelMessages as Array<Record<string, unknown>>)
            : null,
      model: raw.model == null ? null : String(raw.model),
      workspace:
        raw.workspace &&
        typeof raw.workspace === "object" &&
        (raw.workspace as { kind?: unknown }).kind === "local"
          ? {
              kind: "local",
              path: String((raw.workspace as { path?: unknown }).path ?? ""),
              label: String((raw.workspace as { label?: unknown }).label ?? ""),
            }
          : { kind: "sandbox" },
    };
  }
  return null;
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
