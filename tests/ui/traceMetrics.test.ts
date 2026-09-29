import { describe, expect, test } from "bun:test";
import {
  formatCost,
  summarizeTraceMetrics,
} from "../../ui/components/ExecutionTrace/traceMetrics";

describe("trace metrics", () => {
  test("aggregates LLM token, speed, and cost metrics", () => {
    const summary = summarizeTraceMetrics([
      {
        kind: "llm_call",
        metrics: {
          cost: 0.00042,
          promptTokens: 10,
          outputTokens: 5,
          outputDurationMs: 500,
        },
      },
      { kind: "tool_call" },
      {
        kind: "llm_call",
        metrics: {
          cost: 0.00084,
          promptTokens: 20,
          outputTokens: 15,
          outputDurationMs: 500,
        },
      },
    ]);

    expect(summary).toEqual({
      calls: 2,
      cost: 0.00126,
      inputTokens: 30,
      outputTokens: 20,
      tokensPerSecond: 20,
    });
  });

  test("formats free and small OpenRouter costs without rounding them away", () => {
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(0.00042)).toBe("$0.00042");
    expect(formatCost(0.00000042)).toBe("$0.00000042");
  });
});
