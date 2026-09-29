import type { AgentEvent } from "../../../src/schemas/events";
import type { AgentPhase } from "../../types";

export type AgentPhases = Readonly<Record<string, AgentPhase>>;

/** The phase an event moves its agent into; null ends it, undefined leaves it. */
function eventPhase(event: AgentEvent): AgentPhase | null | undefined {
  if (event.type === "delta") {
    if (event.contentDelta) return "responding";
    if (event.thinkingDelta) return "thinking";
  }
  if (event.type === "step" && event.step.status === "running")
    return event.step.kind === "tool_call" ? "tool" : "thinking";
  if (event.type === "activation_ended") return null;
  return undefined;
}

/** Returns the same object when nothing changes, so token deltas skip re-renders. */
export function nextAgentPhases(
  phases: AgentPhases,
  event: AgentEvent,
): AgentPhases {
  const phase = eventPhase(event);
  if (phase === undefined || phases[event.agentId] === phase) return phases;
  if (phase === null) {
    if (!(event.agentId in phases)) return phases;
    const { [event.agentId]: _ended, ...rest } = phases;
    return rest;
  }
  return { ...phases, [event.agentId]: phase };
}
