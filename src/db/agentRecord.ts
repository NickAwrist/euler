import type { AgentRecord } from "./agents";

/** What subagents see as the main agent's name, independent of the app name. */
export const MAIN_AGENT_TITLE = "Parent";

/** A new agent. Every field is listed so a new one needs a deliberate default. */
export function createAgentRecord(
  init: Pick<
    AgentRecord,
    | "ownerUuid"
    | "sessionId"
    | "parentId"
    | "kind"
    | "title"
    | "status"
    | "model"
    | "spawnPosition"
    | "activity"
    | "config"
  >,
): AgentRecord {
  return {
    ...init,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    endedAt: null,
    history: [],
    pendingOutputs: [],
    checkpoints: {},
    // Agents that ended before this agent existed need no summary.
    lastSummaryAt: Date.now(),
    lastSummary: "",
    automaticTurns: 0,
  };
}
