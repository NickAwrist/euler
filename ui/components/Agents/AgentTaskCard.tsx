import { ChevronRight, Square, X } from "lucide-react";
import { useState } from "react";
import {
  type Agent,
  isFinalAgent,
  isWorkingAgent,
} from "../../../src/schemas/agents";
import type { Diagnostic } from "../../../src/schemas/observability";
import { toDiagnostic } from "../../lib/apiError";
import { chipSurface, cx } from "../../styles";
import { ErrorNotice } from "../ErrorNotice";
import { IconButton } from "../IconButton";
import { ModelLabel } from "../ModelLabel";
import { AgentAvatar } from "./AgentAvatar";
import { useAgents } from "./AgentContext";
import { AgentStatus } from "./AgentStatus";
/** Stops a working agent or dismisses a ready one. */
export function AgentStopButton({ agent }: { agent: Agent }) {
  const { stop } = useAgents();
  const [error, setError] = useState<Diagnostic | null>(null);
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
          setError(null);
          void stop(agent.id)
            .catch((e) => setError(toDiagnostic(e)))
            .finally(() => setStopping(false));
        }}
      />
      {error && <ErrorNotice error={error} />}
    </>
  );
}
export function AgentTaskCard({
  agent,
  variant,
}: {
  agent: Agent;
  /** Inline chips fit their content; list cards fill the row and show the agent's latest activity. */
  variant: "inline" | "list";
}) {
  const { open } = useAgents();
  const inline = variant === "inline";
  return (
    <div
      className={cx(
        "my-2 flex items-center gap-1 pr-1.5",
        inline
          ? cx(chipSurface, "w-fit max-w-full")
          : "rounded-lg border border-border-subtle text-sm",
        isFinalAgent(agent) && "text-muted-foreground",
      )}
    >
      <button
        type="button"
        className={cx(
          "flex min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-left",
          !inline && "flex-1 hover:bg-muted/50",
        )}
        onClick={() => open(agent.id)}
      >
        <AgentAvatar agent={agent} />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{agent.title}</span>
          <ModelLabel
            model={agent.model}
            hideProvider
            className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground [&>img]:size-3 [&>span:first-child]:size-3"
          />
          {!inline && agent.activity && (
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
    .map((agent) => (
      <AgentTaskCard key={agent.id} agent={agent} variant="inline" />
    ));
}
