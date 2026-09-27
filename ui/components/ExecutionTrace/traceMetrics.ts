import type { MessageStep } from "../../types";

export type TraceMetricsSummary = {
  calls: number;
  cost?: number;
  inputTokens?: number;
  outputTokens?: number;
  tokensPerSecond?: number;
};

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function collectLlmMetrics(
  steps: MessageStep[] | undefined,
  out: NonNullable<MessageStep["metrics"]>[] = [],
): NonNullable<MessageStep["metrics"]>[] {
  for (const step of steps ?? []) {
    if (step.kind === "llm_call" && step.metrics) out.push(step.metrics);
  }
  return out;
}

export function summarizeTraceMetrics(
  steps: MessageStep[] | undefined,
): TraceMetricsSummary | null {
  const metrics = collectLlmMetrics(steps);
  if (metrics.length === 0) return null;

  let cost = 0;
  let hasCost = false;
  let inputTokens = 0;
  let hasInputTokens = false;
  let outputTokens = 0;
  let hasOutputTokens = false;
  let outputDurationMs = 0;
  let lastTokensPerSecond: number | undefined;

  for (const metric of metrics) {
    const metricCost = finiteNumber(metric.cost);
    if (metricCost !== undefined) {
      cost += metricCost;
      hasCost = true;
    }
    const metricInputTokens = finiteNumber(metric.promptTokens);
    if (metricInputTokens !== undefined) {
      inputTokens += metricInputTokens;
      hasInputTokens = true;
    }
    const metricOutputTokens = finiteNumber(metric.outputTokens);
    if (metricOutputTokens !== undefined) {
      outputTokens += metricOutputTokens;
      hasOutputTokens = true;
    }
    outputDurationMs += finiteNumber(metric.outputDurationMs) ?? 0;
    lastTokensPerSecond =
      finiteNumber(metric.tokensPerSecond) ?? lastTokensPerSecond;
  }

  const tokensPerSecond =
    outputTokens > 0 && outputDurationMs > 0
      ? outputTokens / (outputDurationMs / 1000)
      : lastTokensPerSecond;

  return {
    calls: metrics.length,
    cost: hasCost ? cost : undefined,
    inputTokens: hasInputTokens ? inputTokens : undefined,
    outputTokens: hasOutputTokens ? outputTokens : undefined,
    tokensPerSecond,
  };
}

export function formatTokensPerSecond(value: number): string {
  if (value >= 100) return Math.round(value).toString();
  return value.toFixed(1);
}

export function formatCost(value: number): string {
  if (value === 0) return "$0.00";
  const digits = value >= 0.01 ? 4 : value >= 0.0001 ? 6 : 8;
  return `$${value.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "")}`;
}
