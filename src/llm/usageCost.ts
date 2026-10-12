import type { LlmMetrics } from "../RunContext";
import { openRouterCatalog } from "../openRouterModels";
import { resolveModelSelection } from "./modelSelection";

/** Provider metrics are untrusted: negative or non-finite values are unknown. */
export const validMetric = (value: number | undefined): number | undefined =>
  value !== undefined && Number.isFinite(value) && value >= 0
    ? value
    : undefined;

/**
 * Caps the cached count at the prompt size, splits the billed cost across
 * cached input, uncached input and output by list price, and values the cache
 * hit against the uncached input price.
 */
export function priceLlmUsage(
  model: string,
  metrics: LlmMetrics,
): Pick<LlmMetrics, "cachedTokens" | "costBreakdown" | "cacheSavings"> {
  const input = validMetric(metrics.promptTokens);
  const output = validMetric(metrics.outputTokens);
  const cost = validMetric(metrics.cost);
  const reported = validMetric(metrics.cachedTokens);
  const cachedTokens =
    reported === undefined ? undefined : Math.min(reported, input ?? reported);
  const cached = cachedTokens ?? 0;
  const resolved = resolveModelSelection(model);
  const pricing =
    resolved.provider === "openrouter"
      ? openRouterCatalog
          .peek()
          .models?.find((item) => item.route === resolved.model)
      : undefined;
  const prompt = pricing?.promptPricePerMillion;
  const completion = pricing?.completionPricePerMillion;
  const cacheRead = cached ? pricing?.cacheReadPricePerMillion : 0;
  const priced: ReturnType<typeof priceLlmUsage> = {};

  if (cachedTokens !== undefined) {
    priced.cachedTokens = cachedTokens;
    if (cachedTokens === 0) priced.cacheSavings = 0;
    else if (prompt != null && cacheRead != null)
      priced.cacheSavings =
        (cached * Math.max(0, prompt - cacheRead)) / 1_000_000;
  }

  if (
    cost &&
    input !== undefined &&
    output !== undefined &&
    prompt != null &&
    completion != null &&
    cacheRead != null
  ) {
    const cachedInput = cached * cacheRead;
    const uncachedInput = (input - cached) * prompt;
    const outputCost = output * completion;
    const listed = cachedInput + uncachedInput + outputCost;
    // List prices omit surcharges such as cache writes, so the parts are
    // scaled to sum to the billed cost.
    const scale = listed > 0 ? cost / listed : 0;
    if (scale > 0)
      priced.costBreakdown = {
        cachedInput: cachedInput * scale,
        uncachedInput: uncachedInput * scale,
        output: outputCost * scale,
      };
  }

  return priced;
}
