import { describe, expect, test } from "bun:test";
import {
  traceStepDurationMs,
  traceStepLabel,
  traceTimeline,
} from "../../ui/components/ExecutionTrace/traceDisplay";
import { replyThinking } from "../../ui/components/MessageItem/replyThinking";
import { formatDuration } from "../../ui/lib/formatDuration";

const at = (seconds: number) => new Date(seconds * 1000).toISOString();

describe("trace display", () => {
  test("labels step kinds for people", () => {
    expect(traceStepLabel({ kind: "llm_call" })).toBe("Model call");
    expect(
      traceStepLabel({ kind: "tool_call", toolName: "run_subagent" }),
    ).toBe("Tool: run_subagent");
  });

  test("measures finished steps and places them on the run timeline", () => {
    const steps = [
      { kind: "llm_call", startedAt: at(0), endedAt: at(2) },
      { kind: "tool_call", startedAt: at(2), endedAt: at(8) },
      { kind: "llm_call", startedAt: at(8) },
    ];

    expect(traceStepDurationMs(steps[1]!)).toBe(6000);
    expect(traceStepDurationMs(steps[2]!)).toBeUndefined();
    // The running step extends to now.
    expect(traceTimeline(steps, 10_000)).toEqual([
      { offset: 0, width: 0.2 },
      { offset: 0.2, width: 0.6 },
      { offset: 0.8, width: 0.2 },
    ]);
    expect(traceTimeline([{ kind: "llm_call" }], 0)).toEqual([undefined]);
  });

  test("formats durations compactly", () => {
    expect(formatDuration(350)).toBe("350ms");
    expect(formatDuration(4000)).toBe("4s");
    expect(formatDuration(4230)).toBe("4.2s");
    expect(formatDuration(12_400)).toBe("12s");
    expect(formatDuration(65_000)).toBe("1m 5s");
  });

  test("combines the main agent's reasoning across a reply's model calls", () => {
    expect(replyThinking([{ kind: "llm_call" }])).toBeNull();
    expect(
      replyThinking([
        {
          kind: "llm_call",
          thinking: "Plan the search.",
          metrics: { thinkingDurationMs: 3000 },
        },
        { kind: "tool_call", thinking: "ignored" },
        {
          kind: "llm_call",
          thinking: "Summarize.",
          metrics: { thinkingDurationMs: 1500 },
        },
      ]),
    ).toEqual({ text: "Plan the search.\n\nSummarize.", durationMs: 4500 });
    expect(
      replyThinking([{ kind: "llm_call", thinking: "Older reply" }]),
    ).toEqual({ text: "Older reply", durationMs: undefined });
  });
});
