import { Info } from "lucide-react";
import { type Agent, Agent_Kind } from "../../../src/gen/euler/v1/agent_pb";
import { isFinalAgent } from "../../lib/agentStatus";

/** Notes that live subagents keep their model when the composer's differs. */
export function SubagentModelNotice({
  agents,
  model,
}: {
  agents: Agent[];
  model: string;
}) {
  const differs = agents.some(
    (a) => a.kind !== Agent_Kind.MAIN && !isFinalAgent(a) && a.model !== model,
  );
  if (!differs) return null;
  return (
    <p className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
      <Info size={13} className="shrink-0" />
      Subagents already started keep the model they were started with.
    </p>
  );
}
