import { ChevronRight } from "lucide-react";
import { useId, useState } from "react";
import {
  type Agent,
  isFinalAgent,
  isWorkingAgent,
} from "../../../src/schemas/agents";
import { cx, eyebrowText } from "../../styles";
import { useAgents } from "./AgentContext";
import { AgentTaskCard } from "./AgentTaskCard";

function SectionHeading({ label, count }: { label: string; count: number }) {
  return (
    <>
      <span>{label}</span>
      <span className="tabular-nums opacity-60">{count}</span>
      <span aria-hidden className="h-px flex-1 bg-border-subtle" />
    </>
  );
}

function AgentSection({
  label,
  agents,
  collapsible = false,
}: {
  label: string;
  agents: Agent[];
  collapsible?: boolean;
}) {
  const [expanded, setExpanded] = useState(!collapsible);
  const bodyId = useId();
  if (!agents.length) return null;
  const heading = cx(eyebrowText, "flex w-full items-center gap-2 py-1");
  return (
    <section aria-label={label} className="mt-3 first:mt-1">
      {collapsible ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setExpanded(!expanded)}
          className={cx(
            heading,
            "rounded-md text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring",
          )}
        >
          <SectionHeading label={label} count={agents.length} />
          <ChevronRight
            size={12}
            aria-hidden
            className={cx(
              "transition-transform duration-150",
              expanded && "rotate-90",
            )}
          />
        </button>
      ) : (
        <h3 className={heading}>
          <SectionHeading label={label} count={agents.length} />
        </h3>
      )}
      <div id={bodyId} hidden={!expanded}>
        {agents.map((agent) => (
          <AgentTaskCard key={agent.id} agent={agent} variant="list" />
        ))}
      </div>
    </section>
  );
}

/** The chat's subagents grouped by whether the parent can still reach them. */
export function AgentsList() {
  const { agents } = useAgents();
  const list = agents
    .filter((a) => a.kind !== "main")
    .sort((a, b) => b.createdAt - a.createdAt);
  return (
    <div className="min-h-0 flex-1 overflow-auto px-3 pb-3" aria-label="Agents">
      {list.length ? (
        <>
          <AgentSection label="Active" agents={list.filter(isWorkingAgent)} />
          <AgentSection
            label="Ready"
            agents={list.filter((a) => a.status === "idle")}
          />
          <AgentSection
            label="Ended"
            agents={list.filter(isFinalAgent)}
            collapsible
          />
        </>
      ) : (
        <p className="px-1 py-2 text-sm text-muted-foreground">
          No background agents in this chat.
        </p>
      )}
    </div>
  );
}
