import type { CostBreakdown, MessageStep } from "../../types";

export type TraceMetricsSummary = {
  calls: number;
  cost?: number;
  /** Present only when every billed call reports its split. */
  costBreakdown?: CostBreakdown;
  cacheSavings?: number;
  inputTokens?: number;
  cachedTokens?: number;
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
  let cachedTokens: number | undefined;
  let cacheSavings: number | undefined;
  let costBreakdown: CostBreakdown | undefined = {
    cachedInput: 0,
    uncachedInput: 0,
    output: 0,
  };
  let outputDurationMs = 0;
  let lastTokensPerSecond: number | undefined;

  for (const metric of metrics) {
    const metricCost = finiteNumber(metric.cost);
    if (metricCost !== undefined) {
      cost += metricCost;
      hasCost = true;
    }
    if (metricCost && costBreakdown) {
      const split = metric.costBreakdown;
      costBreakdown = split && {
        cachedInput: costBreakdown.cachedInput + split.cachedInput,
        uncachedInput: costBreakdown.uncachedInput + split.uncachedInput,
        output: costBreakdown.output + split.output,
      };
    }
    const metricCachedTokens = finiteNumber(metric.cachedTokens);
    if (metricCachedTokens !== undefined) {
      cachedTokens = (cachedTokens ?? 0) + metricCachedTokens;
    }
    const metricCacheSavings = finiteNumber(metric.cacheSavings);
    if (metricCacheSavings !== undefined) {
      cacheSavings = (cacheSavings ?? 0) + metricCacheSavings;
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
    costBreakdown: cost > 0 ? costBreakdown : undefined,
    cacheSavings,
    inputTokens: hasInputTokens ? inputTokens : undefined,
    cachedTokens,
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
