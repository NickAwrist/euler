import { describe, expect, test } from "bun:test";
import { type MessageInitShape, create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { StepSchema, Step_Kind } from "../../src/gen/euler/v1/steps_pb";
import {
  traceStepDurationMs,
  traceStepLabel,
  traceTimeline,
} from "../../ui/components/ExecutionTrace/traceDisplay";
import { replyThinking } from "../../ui/components/MessageItem/replyThinking";
import { formatDuration } from "../../ui/lib/formatDuration";

const at = (seconds: number) => timestampFromMs(seconds * 1000);
const step = (fields: MessageInitShape<typeof StepSchema>) =>
  create(StepSchema, fields);

describe("trace display", () => {
  test("labels step kinds for people", () => {
    expect(traceStepLabel(step({ kind: Step_Kind.LLM_CALL }))).toBe(
      "Model call",
    );
    expect(
      traceStepLabel(
        step({ kind: Step_Kind.TOOL_CALL, toolName: "spawn_agent" }),
      ),
    ).toBe("Tool: spawn_agent");
  });

  test("measures finished steps and places them on the run timeline", () => {
    const steps = [
      step({ kind: Step_Kind.LLM_CALL, startedAt: at(0), endedAt: at(2) }),
      step({ kind: Step_Kind.TOOL_CALL, startedAt: at(2), endedAt: at(8) }),
      step({ kind: Step_Kind.LLM_CALL, startedAt: at(8) }),
    ];

    expect(traceStepDurationMs(steps[1]!)).toBe(6000);
    expect(traceStepDurationMs(steps[2]!)).toBeUndefined();
    // The running step extends to now.
    expect(traceTimeline(steps, 10_000)).toEqual([
      { offset: 0, width: 0.2 },
      { offset: 0.2, width: 0.6 },
      { offset: 0.8, width: 0.2 },
    ]);
    expect(traceTimeline([step({ kind: Step_Kind.LLM_CALL })], 0)).toEqual([
      undefined,
    ]);
  });

  test("formats durations compactly", () => {
    expect(formatDuration(350)).toBe("350ms");
    expect(formatDuration(4000)).toBe("4s");
    expect(formatDuration(4230)).toBe("4.2s");
    expect(formatDuration(12_400)).toBe("12s");
    expect(formatDuration(65_000)).toBe("1m 5s");
  });

  test("combines the main agent's reasoning across a reply's model calls", () => {
    expect(replyThinking([step({ kind: Step_Kind.LLM_CALL })])).toBeNull();
    expect(
      replyThinking([
        step({
          kind: Step_Kind.LLM_CALL,
          thinking: "Plan the search.",
          metrics: { thinkingDurationMs: 3000 },
        }),
        step({ kind: Step_Kind.TOOL_CALL, thinking: "ignored" }),
        step({
          kind: Step_Kind.LLM_CALL,
          thinking: "Summarize.",
          metrics: { thinkingDurationMs: 1500 },
        }),
      ]),
    ).toEqual({ text: "Plan the search.\n\nSummarize.", durationMs: 4500 });
    expect(
      replyThinking([
        step({ kind: Step_Kind.LLM_CALL, thinking: "Older reply" }),
      ]),
    ).toEqual({ text: "Older reply", durationMs: undefined });
  });
});
