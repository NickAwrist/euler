import type { SessionSummary, SessionWorkspace } from "../types";
import { linkedWorkspace } from "./workspace";

/** The name a chat is listed under. */
export function sessionLabel(session: SessionSummary): string {
  return session.preview || "New chat";
}

/** The chat a linked sandbox is shown as; null when not linked. */
export function linkedChatLabel(
  workspace: SessionWorkspace,
  sessions: SessionSummary[],
): string | null {
  const linked = linkedWorkspace(workspace);
  if (!linked) return null;
  const { sessionId } = linked;
  const chat = sessions.find((session) => session.id === sessionId);
  return chat ? sessionLabel(chat) : "a deleted chat";
}
