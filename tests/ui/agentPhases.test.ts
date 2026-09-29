import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "../../src/schemas/events";
import { nextAgentPhases } from "../../ui/hooks/run/agentPhases";

const at = { sequence: 1, sessionId: "s", agentId: "a" };
const step = (kind: string, status: string): AgentEvent => ({
  ...at,
  type: "step",
  activationId: "x",
  position: 0,
  step: { kind, status },
});
const delta = (contentDelta: string, thinkingDelta: string): AgentEvent => ({
  ...at,
  type: "delta",
  activationId: "x",
  contentDelta,
  thinkingDelta,
});

describe("nextAgentPhases", () => {
  test("follows an agent through a turn", () => {
    let phases = nextAgentPhases({}, step("llm_call", "running"));
    expect(phases).toEqual({ a: "thinking" });
    phases = nextAgentPhases(phases, step("tool_call", "running"));
    expect(phases).toEqual({ a: "tool" });
    phases = nextAgentPhases(phases, delta("", "hmm"));
    expect(phases).toEqual({ a: "thinking" });
    phases = nextAgentPhases(phases, delta("Hi", ""));
    expect(phases).toEqual({ a: "responding" });
    phases = nextAgentPhases(phases, {
      ...at,
      type: "activation_ended",
      activationId: "x",
      outcome: "done",
    });
    expect(phases).toEqual({});
  });

  test("keeps the same object when the phase is unchanged", () => {
    const phases = { a: "responding" as const };
    expect(nextAgentPhases(phases, delta("more", ""))).toBe(phases);
    expect(nextAgentPhases(phases, step("tool_call", "done"))).toBe(phases);
    expect(nextAgentPhases({}, { ...at, type: "resync" })).toEqual({});
  });
});
