import { agentRuntime } from "../agents/runtime/AgentRuntime";
import { deleteSessionRow, listExpiredSessions } from "../db/sessions";
import type { SessionRow } from "../db/types";
import { envConfig } from "../env";
import { logEvent } from "../observability/logger";
import { workspaceService } from "../workspaces/WorkspaceService";

const HOUR_MS = 60 * 60 * 1000;
const EXPIRY_INTERVAL_MS = 60_000;

/** When an ephemeral chat created at `now` is deleted. */
export function ephemeralExpiry(now: number): number {
  return now + envConfig.ephemeralChatTtlHours * HOUR_MS;
}

/**
 * Settles the chat's agents, then removes its workspace and rows before
 * anything can start in it again. Ephemeral chats skip the trash, so nothing
 * of them remains.
 */
export function deleteSession(row: SessionRow): Promise<boolean | undefined> {
  return agentRuntime.deleteSession(row.owner_uuid, row.id, async () => {
    if (row.expires_at === null)
      await workspaceService.trashRetained(row.owner_uuid, row.id);
    else await workspaceService.deleteRetained(row.owner_uuid, row.id);
    return deleteSessionRow(row.owner_uuid, row.id);
  });
}

/** Deletes expired ephemeral chats, deferring those with work in progress. */
export async function deleteExpiredSessions(now = Date.now()): Promise<void> {
  for (const row of listExpiredSessions(now)) {
    if (agentRuntime.busy(row.owner_uuid, row.id)) continue;
    try {
      await deleteSession(row);
    } catch (error) {
      logEvent("error", "session.expiry_failed", { sessionId: row.id }, error);
    }
  }
}

/** Checks for expired ephemeral chats now and every minute. */
export function startSessionExpiry(): void {
  const sweep = () =>
    void deleteExpiredSessions().catch((error) =>
      logEvent("error", "session.expiry_failed", {}, error),
    );
  setInterval(sweep, EXPIRY_INTERVAL_MS).unref();
  sweep();
}
