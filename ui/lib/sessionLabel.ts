import type { SessionSummary, SessionWorkspace } from "../types";

/** The name a chat is listed under. */
export function sessionLabel(session: SessionSummary): string {
  return session.preview || "New chat";
}

/** The chat a linked sandbox is shown as; null when not linked. */
export function linkedChatLabel(
  workspace: SessionWorkspace,
  sessions: SessionSummary[],
): string | null {
  if (workspace.kind !== "sandbox" || !workspace.linked) return null;
  const { sessionId } = workspace.linked;
  const chat = sessions.find((session) => session.id === sessionId);
  return chat ? sessionLabel(chat) : "a deleted chat";
}
