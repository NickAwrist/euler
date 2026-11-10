import { describe, expect, test } from "bun:test";
import { create } from "@bufbuild/protobuf";
import {
  ActivationEnded_Outcome,
  type Event,
  EventSchema,
} from "../../src/gen/euler/v1/events_pb";
import { Step_Kind, Step_Status } from "../../src/gen/euler/v1/steps_pb";
import { nextAgentPhases } from "../../ui/hooks/run/agentPhases";

const at = { sequence: 1n, sessionId: "s", agentId: "a" };
const step = (kind: Step_Kind, status: Step_Status): Event =>
  create(EventSchema, {
    ...at,
    payload: {
      case: "step",
      value: { activationId: "x", position: 0, step: { kind, status } },
    },
  });
const delta = (contentDelta: string, thinkingDelta: string): Event =>
  create(EventSchema, {
    ...at,
    payload: {
      case: "delta",
      value: { activationId: "x", contentDelta, thinkingDelta },
    },
  });

describe("nextAgentPhases", () => {
  test("follows an agent through a turn", () => {
    let phases = nextAgentPhases(
      {},
      step(Step_Kind.LLM_CALL, Step_Status.RUNNING),
    );
    expect(phases).toEqual({ a: "thinking" });
    phases = nextAgentPhases(
      phases,
      step(Step_Kind.TOOL_CALL, Step_Status.RUNNING),
    );
    expect(phases).toEqual({ a: "tool" });
    phases = nextAgentPhases(phases, delta("", "hmm"));
    expect(phases).toEqual({ a: "thinking" });
    phases = nextAgentPhases(phases, delta("Hi", ""));
    expect(phases).toEqual({ a: "responding" });
    phases = nextAgentPhases(
      phases,
      create(EventSchema, {
        ...at,
        payload: {
          case: "activationEnded",
          value: { activationId: "x", outcome: ActivationEnded_Outcome.DONE },
        },
      }),
    );
    expect(phases).toEqual({});
  });

  test("keeps the same object when the phase is unchanged", () => {
    const phases = { a: "responding" as const };
    expect(nextAgentPhases(phases, delta("more", ""))).toBe(phases);
    expect(
      nextAgentPhases(phases, step(Step_Kind.TOOL_CALL, Step_Status.DONE)),
    ).toBe(phases);
    expect(
      nextAgentPhases(
        {},
        create(EventSchema, { ...at, payload: { case: "resync", value: {} } }),
      ),
    ).toEqual({});
  });
});
