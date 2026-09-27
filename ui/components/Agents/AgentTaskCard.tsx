import { Bot } from "lucide-react";
import { useState } from "react";
import { type Agent, isFinalAgent } from "../../../src/schemas/agents";
import { Button } from "../Button";
import { useAgents } from "./AgentContext";
export const agentStatusLabel = (agent: Agent) =>
  agent.status === "waiting"
    ? "Waiting for Euler"
    : agent.status[0]!.toUpperCase() + agent.status.slice(1);
export function AgentTaskCard({ agent }: { agent: Agent }) {
  const { open, stop } = useAgents();
  const [error, setError] = useState("");
  const [stopping, setStopping] = useState(false);
  return (
    <div className="my-2 flex flex-wrap items-center gap-2 rounded-lg border border-border-subtle px-3 py-2 text-sm">
      <Bot size={16} />
      <span className="min-w-0 flex-1 truncate">{agent.title}</span>
      <span className="text-muted-foreground" aria-live="polite">
        {agentStatusLabel(agent)}
      </span>
      <Button variant="ghost" size="sm" onClick={() => open(agent.id)}>
        Details
      </Button>
      {!isFinalAgent(agent) && (
        <Button
          variant="ghost"
          size="sm"
          loading={stopping}
          onClick={() => {
            setStopping(true);
            void stop(agent.id)
              .catch((e) => setError(String(e)))
              .finally(() => setStopping(false));
          }}
        >
          Stop
        </Button>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
export function AgentRows({ position }: { position: number }) {
  const { agents } = useAgents();
  return agents
    .filter((a) => a.kind !== "main" && a.spawnPosition === position)
    .map((agent) => <AgentTaskCard key={agent.id} agent={agent} />);
}
