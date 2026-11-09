import type {
  CreateSessionResponse,
  Session,
  SessionSummary,
  SessionWorkspace,
} from "../../src/gen/euler/v1/sessions_pb";
import type { WorkspaceFile } from "../../src/gen/euler/v1/workspace_pb";
import { isNotFound, sessionClient, workspaceClient } from "../lib/rpc";

export type { Session, SessionSummary, SessionWorkspace };

/** The user's chats, most recently updated first. */
export async function fetchSessionSummaries(): Promise<SessionSummary[]> {
  return (await sessionClient.listSessions({})).sessions;
}

const inFlightSessionFetches = new Map<string, Promise<Session | null>>();

// Stream completion must bypass any navigation snapshot requested before the run finished.
export function fetchSession(
  id: string,
  options?: { fresh?: boolean },
): Promise<Session | null> {
  const pending = inFlightSessionFetches.get(id);
  if (pending && !options?.fresh) return pending;
  const request = fetchSessionData(id).finally(() => {
    if (inFlightSessionFetches.get(id) === request)
      inFlightSessionFetches.delete(id);
  });
  inFlightSessionFetches.set(id, request);
  return request;
}

async function fetchSessionData(id: string): Promise<Session | null> {
  try {
    return (await sessionClient.getSession({ id })).session ?? null;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function createSessionApi(opts: {
  model?: string | null;
  ephemeral?: boolean;
}): Promise<CreateSessionResponse> {
  return sessionClient.createSession({
    model: opts.model?.trim() || undefined,
    ephemeral: opts.ephemeral ?? false,
  });
}

/** Renames the chat or changes its model; an empty value clears it. */
export async function patchSessionApi(
  id: string,
  patch: { customTitle?: string | null; model?: string | null },
): Promise<void> {
  await sessionClient.updateSession({
    id,
    ...(patch.customTitle === undefined
      ? {}
      : { customTitle: patch.customTitle ?? "" }),
    ...(patch.model === undefined ? {} : { model: patch.model ?? "" }),
  });
}

export async function deleteSessionApi(id: string): Promise<void> {
  try {
    await sessionClient.deleteSession({ id });
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

export async function selectSessionDirectory(
  sessionId: string,
  path: string,
): Promise<SessionWorkspace> {
  return (await workspaceClient.selectDirectory({ sessionId, path }))
    .workspace!;
}

export async function linkSessionWorkspace(
  sessionId: string,
  sourceSessionId: string,
): Promise<SessionWorkspace> {
  return (await workspaceClient.linkWorkspace({ sessionId, sourceSessionId }))
    .workspace!;
}

export async function switchSessionToSandbox(
  sessionId: string,
): Promise<SessionWorkspace> {
  return (await workspaceClient.useSandbox({ sessionId })).workspace!;
}

export async function fetchWorkspaceFiles(
  sessionId: string,
  query?: string,
  signal?: AbortSignal,
): Promise<WorkspaceFile[]> {
  return (await workspaceClient.listFiles({ sessionId, query }, { signal }))
    .files;
}

/** Assembles a streamed workspace file into a Blob. */
export async function downloadWorkspaceFile(
  sessionId: string,
  path: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let type = "application/octet-stream";
  for await (const { part } of workspaceClient.downloadFile(
    { sessionId, path },
    { signal },
  )) {
    if (part.case === "info") type = part.value.mediaType || type;
    if (part.case === "chunk") parts.push(new Uint8Array(part.value));
  }
  return new Blob(parts, { type });
}

export async function revealWorkspaceFile(
  sessionId: string,
  path: string,
): Promise<void> {
  await workspaceClient.revealFile({ sessionId, path });
}
