import { Bot, ChevronRight, Square, X } from "lucide-react";
import { useState } from "react";
import {
  type Agent,
  isFinalAgent,
  isWorkingAgent,
} from "../../../src/schemas/agents";
import { cx } from "../../styles";
import { IconButton } from "../IconButton";
import { ModelLabel } from "../ModelLabel";
import { useAgents } from "./AgentContext";
import { AgentStatus } from "./AgentStatus";
/** Stops a working agent or dismisses a ready one. */
export function AgentStopButton({ agent }: { agent: Agent }) {
  const { stop } = useAgents();
  const [error, setError] = useState("");
  const [stopping, setStopping] = useState(false);
  const working = isWorkingAgent(agent);
  return (
    <>
      <IconButton
        icon={working ? Square : X}
        label={`${working ? "Stop" : "Dismiss"} ${agent.title}`}
        title={working ? "Stop agent" : "Dismiss agent"}
        variant={working ? "danger" : "ghost"}
        size="sm"
        iconSize={working ? 12 : 14}
        iconProps={{ strokeWidth: 2.25 }}
        loading={stopping}
        onClick={() => {
          setStopping(true);
          setError("");
          void stop(agent.id)
            .catch((e) => setError(String(e)))
            .finally(() => setStopping(false));
        }}
      />
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
    </>
  );
}
export function AgentTaskCard({
  agent,
  showActivity = false,
}: {
  agent: Agent;
  /** Show the agent's latest activity under its title. */
  showActivity?: boolean;
}) {
  const { open } = useAgents();
  return (
    <div
      className={cx(
        "my-2 flex items-center gap-1 rounded-lg border border-border-subtle pr-1.5 text-sm",
        isFinalAgent(agent) && "text-muted-foreground",
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-muted/50"
        onClick={() => open(agent.id)}
      >
        <Bot size={16} className="shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{agent.title}</span>
          <ModelLabel
            model={agent.model}
            className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground [&>img]:size-3 [&>span:first-child]:size-3"
          />
          {showActivity && agent.activity && (
            <span className="block truncate text-xs text-muted-foreground">
              {agent.activity}
            </span>
          )}
        </span>
        <AgentStatus agent={agent} />
        <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
      </button>
      {!isFinalAgent(agent) && <AgentStopButton agent={agent} />}
    </div>
  );
}
export function AgentRows({ position }: { position: number }) {
  const { agents } = useAgents();
  return agents
    .filter((a) => a.kind !== "main" && a.spawnPosition === position)
    .map((agent) => <AgentTaskCard key={agent.id} agent={agent} />);
}
