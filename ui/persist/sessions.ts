import {
  type CreateSessionBody,
  type CreatedSession,
  CreatedSessionSchema,
  type StoredRunSession as SchemaStoredRunSession,
  type SessionSummary,
  SessionSummaryListSchema,
  type SessionWorkspace,
  StoredRunSessionSchema,
  WorkspaceResponseSchema,
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
      expiresAt: typeof raw.expiresAt === "number" ? raw.expiresAt : null,
    };
  }
  return null;
}

export async function createSessionApi(opts: {
  model?: string | null;
  ephemeral?: boolean;
}): Promise<CreatedSession> {
  const body: CreateSessionBody = {};
  if (opts.model?.trim()) body.model = opts.model.trim();
  if (opts.ephemeral) body.ephemeral = true;
  return CreatedSessionSchema.parse(
    await apiJson<unknown>("/api/sessions", {
      method: "POST",
      json: body,
    }),
  );
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

const workspacePath = (id: string) =>
  `/api/sessions/${encodeURIComponent(id)}/workspace`;

export async function selectSessionDirectory(
  id: string,
  path: string,
): Promise<SessionWorkspace> {
  return WorkspaceResponseSchema.parse(
    await apiJson(`${workspacePath(id)}/select-directory`, {
      method: "POST",
      json: { path },
    }),
  ).workspace;
}

export async function linkSessionWorkspace(
  id: string,
  sourceSessionId: string,
): Promise<SessionWorkspace> {
  return WorkspaceResponseSchema.parse(
    await apiJson(`${workspacePath(id)}/link`, {
      method: "POST",
      json: { sessionId: sourceSessionId },
    }),
  ).workspace;
}

export async function useSessionSandbox(id: string): Promise<SessionWorkspace> {
  await apiVoid(`${workspacePath(id)}/use-sandbox`, {
    method: "POST",
  });
  return { kind: "sandbox" };
}

export async function fetchWorkspaceFiles(
  id: string,
): Promise<WorkspaceFile[]> {
  const data = await apiJson<{ files?: WorkspaceFile[] }>(
    `${workspacePath(id)}/files`,
  );
  return Array.isArray(data.files) ? data.files : [];
}

export async function downloadWorkspaceFile(
  sessionId: string,
  filePath: string,
): Promise<Blob> {
  return apiBlob(
    `${workspacePath(sessionId)}/file?path=${encodeURIComponent(filePath)}`,
  );
}

export function revealWorkspaceFile(
  sessionId: string,
  filePath: string,
): Promise<void> {
  return apiVoid(`${workspacePath(sessionId)}/reveal`, {
    method: "POST",
    json: { path: filePath },
  });
}
