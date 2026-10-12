import { describe, expect, test } from "bun:test";
import {
  formatCost,
  summarizeTraceMetrics,
} from "../../ui/components/ExecutionTrace/traceMetrics";
import type { MessageStep } from "../../ui/types";

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

  test("totals the cost split only when every billed call reports one", () => {
    const split = { cachedInput: 0.1, uncachedInput: 0.2, output: 0.3 };
    const step = (metrics: NonNullable<MessageStep["metrics"]>) => ({
      kind: "llm_call",
      metrics,
    });

    const complete = summarizeTraceMetrics([
      step({
        cost: 0.6,
        costBreakdown: split,
        promptTokens: 10,
        cachedTokens: 8,
      }),
      step({ cost: 0, promptTokens: 5, cachedTokens: 5, cacheSavings: 0.05 }),
    ]);
    expect(complete?.costBreakdown?.output).toBeCloseTo(0.3);
    expect(complete?.cachedTokens).toBe(13);
    expect(complete?.cacheSavings).toBe(0.05);

    const partial = summarizeTraceMetrics([
      step({ cost: 0.6, costBreakdown: split }),
      step({ cost: 0.4 }),
    ]);
    expect(partial?.cost).toBeCloseTo(1);
    expect(partial?.costBreakdown).toBeUndefined();
  });

  test("formats free and small OpenRouter costs without rounding them away", () => {
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(0.00042)).toBe("$0.00042");
    expect(formatCost(0.00000042)).toBe("$0.00000042");
  });
});
