import { cx, eyebrowText } from "../../styles";
import {
  type TraceMetricsSummary,
  formatCost,
  formatTokensPerSecond,
} from "./traceMetrics";

const cell = "border-t border-border-subtle py-1.5";
const totalCell = cx(cell, "border-border");

function percent(part: number, whole: number): string {
  return `${Math.round((part / whole) * 100)}%`;
}

/** Token and cost receipt for the LLM calls in a trace. */
export function TraceUsageTable({ metrics }: { metrics: TraceMetricsSummary }) {
  const { inputTokens, cachedTokens, outputTokens, costBreakdown } = metrics;
  // Free and local models report a zero cost, which says nothing useful.
  const cost = metrics.cost || undefined;
  const savings = metrics.cacheSavings || undefined;
  const showShare = !!inputTokens && cachedTokens !== undefined;
  const rows = [
    ...(showShare
      ? [
          {
            label: "Cached input",
            swatch: "bg-emerald-400/70",
            tokens: cachedTokens,
            share: percent(cachedTokens, inputTokens),
            cost: costBreakdown?.cachedInput,
          },
          {
            label: "Uncached input",
            swatch: "bg-amber-400/70",
            tokens: inputTokens - cachedTokens,
            share: percent(inputTokens - cachedTokens, inputTokens),
            cost: costBreakdown?.uncachedInput,
          },
        ]
      : [{ label: "Input", swatch: "bg-amber-400/70", tokens: inputTokens }]),
    {
      label: "Output",
      swatch: "bg-sky-400/70",
      tokens: outputTokens,
      cost: costBreakdown?.output,
    },
  ];

  return (
    <div
      className="mb-4 rounded-xl border border-border-subtle bg-muted/25 px-3.5 py-3"
      aria-label="Execution metrics"
    >
      <table className="w-full border-collapse text-right text-[0.8125rem] tabular-nums">
        <thead>
          <tr className={cx(eyebrowText, "[&>th]:pb-1.5 [&>th]:font-semibold")}>
            <th className="text-left">Usage</th>
            <th>Tokens</th>
            {showShare && <th>Share</th>}
            {cost && <th>Cost</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td className={cx(cell, "text-left")}>
                <span
                  aria-hidden
                  className={cx(
                    "mr-2 inline-block size-2 rounded-[2px]",
                    row.swatch,
                  )}
                />
                {row.label}
              </td>
              <td className={cell}>{row.tokens?.toLocaleString() ?? "—"}</td>
              {showShare && (
                <td className={cx(cell, "text-muted-foreground")}>
                  {"share" in row ? row.share : "—"}
                </td>
              )}
              {cost && (
                <td className={cell}>
                  {row.cost !== undefined ? formatCost(row.cost) : "—"}
                </td>
              )}
            </tr>
          ))}
          <tr className="font-semibold">
            <td className={cx(totalCell, "text-left")}>
              Total · {metrics.calls} {metrics.calls === 1 ? "call" : "calls"}
            </td>
            <td className={totalCell}>
              {((inputTokens ?? 0) + (outputTokens ?? 0)).toLocaleString()}
            </td>
            {showShare && <td className={totalCell} />}
            {cost && <td className={totalCell}>{formatCost(cost)}</td>}
          </tr>
        </tbody>
      </table>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[0.75rem] tabular-nums text-muted-foreground">
        {metrics.tokensPerSecond !== undefined && (
          <span>
            {formatTokensPerSecond(metrics.tokensPerSecond)} tok/s output
          </span>
        )}
        {cost && savings && (
          <span className="ml-auto text-emerald-400/90">
            Caching saved {formatCost(savings)} (
            {percent(savings, cost + savings)})
          </span>
        )}
      </div>
    </div>
  );
}
