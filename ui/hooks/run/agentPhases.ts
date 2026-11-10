import type { Event } from "../../../src/gen/euler/v1/events_pb";
import { Step_Kind, Step_Status } from "../../../src/gen/euler/v1/steps_pb";
import type { AgentPhase } from "../../types";

export type AgentPhases = Readonly<Record<string, AgentPhase>>;

/** The phase an event moves its agent into; null ends it, undefined leaves it. */
function eventPhase({ payload }: Event): AgentPhase | null | undefined {
  if (payload.case === "delta") {
    if (payload.value.contentDelta) return "responding";
    if (payload.value.thinkingDelta) return "thinking";
  }
  if (
    payload.case === "step" &&
    payload.value.step?.status === Step_Status.RUNNING
  )
    return payload.value.step.kind === Step_Kind.TOOL_CALL
      ? "tool"
      : "thinking";
  if (payload.case === "activationEnded") return null;
  return undefined;
}

/** Returns the same object when nothing changes, so token deltas skip re-renders. */
export function nextAgentPhases(
  phases: AgentPhases,
  event: Event,
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
