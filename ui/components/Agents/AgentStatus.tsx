import { CircleAlert } from "lucide-react";
import { type Agent, isFinalAgent } from "../../../src/schemas/agents";

const STATUS_LABELS: Record<Agent["status"], string> = {
  queued: "Queued",
  running: "Working",
  waiting: "Waiting for Euler",
  idle: "Ready",
  completed: "Done",
  failed: "Failed",
  cancelled: "Stopped",
};

export function AgentStatus({ agent }: { agent: Agent }) {
  const problem =
    agent.interruption ||
    (agent.status === "failed" ? agent.activity || "Agent failed" : undefined);
  const label = agent.interruption
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
