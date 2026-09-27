import { Info } from "lucide-react";
import { type Agent, isFinalAgent } from "../../../src/schemas/agents";

/** Notes that live subagents keep their model when the composer's differs. */
export function SubagentModelNotice({
  agents,
  model,
}: {
  agents: Agent[];
  model: string;
}) {
  const differs = agents.some(
    (a) => a.kind !== "main" && !isFinalAgent(a) && a.model !== model,
  );
  if (!differs) return null;
  return (
    <p className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
      <Info size={13} className="shrink-0" />
      Subagents already started keep the model they were started with.
    </p>
  );
}
