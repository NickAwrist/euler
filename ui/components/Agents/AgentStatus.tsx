import { CircleAlert } from "lucide-react";
import { type Agent, Agent_Status } from "../../../src/gen/euler/v1/agent_pb";
import { isFinalAgent } from "../../lib/agentStatus";

const STATUS_LABELS: Record<Agent_Status, string> = {
  [Agent_Status.UNSPECIFIED]: "",
  [Agent_Status.QUEUED]: "Queued",
  [Agent_Status.RUNNING]: "Working",
  [Agent_Status.WAITING]: "Waiting for parent",
  [Agent_Status.IDLE]: "Ready",
  [Agent_Status.COMPLETED]: "Done",
  [Agent_Status.CANCELLED]: "Stopped",
};

export function AgentStatus({ agent }: { agent: Agent }) {
  const problem = agent.interruption;
  const label = problem
    ? "Interrupted"
    : agent.held && !isFinalAgent(agent)
      ? "Paused"
      : STATUS_LABELS[agent.status];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 text-muted-foreground"
      aria-live="polite"
    >
      {problem && (
        <span title={problem} role="img" aria-label={problem}>
          <CircleAlert size={13} className="text-amber-400/80" aria-hidden />
        </span>
      )}
      {label}
    </span>
  );
}
